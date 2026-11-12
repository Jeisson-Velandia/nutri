import { initializeApp } from 'firebase/app'
import {
  createUserWithEmailAndPassword, getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, type User,
} from 'firebase/auth'
import {
  collection, doc, getDocsFromServer, initializeFirestore, limit, orderBy, query, serverTimestamp, Timestamp, where, writeBatch,
} from 'firebase/firestore'
import { firebaseConfig, syncEnabled } from '../config'
import { db, remoteDeletes, setLocalChangeListener, SYNC_TABLES, type SyncTable } from './db'

const app = syncEnabled ? initializeApp(firebaseConfig) : null
const auth = app ? getAuth(app) : null
const fs = app ? initializeFirestore(app, { ignoreUndefinedProperties: true }) : null

/** Firebase tarda un instante en restaurar la sesión guardada: esta promesa espera ese primer aviso. */
const authReady: Promise<User | null> = auth
  ? new Promise((res) => { const off = onAuthStateChanged(auth, (u) => { off(); res(u) }) })
  : Promise.resolve(null)

// ---------- Estado observable (para la UI) ----------

export type SyncStatus = { state: 'off' | 'idle' | 'syncing' | 'error' | 'offline'; lastSync: number | null; error?: string }
let status: SyncStatus = { state: syncEnabled ? 'idle' : 'off', lastSync: Number(localStorage.getItem('nutri-last-sync')) || null }
const listeners = new Set<(s: SyncStatus) => void>()
const setStatus = (s: Partial<SyncStatus>) => { status = { ...status, ...s }; listeners.forEach((l) => l(status)) }
export const getStatus = () => status
export const onStatus = (fn: (s: SyncStatus) => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }

// ---------- Sincronización ----------

const CURSOR = 'nutri-pull-cursor'
const pkOf = (t: SyncTable) => db.table(t).schema.primKey.keyPath as string

async function currentUserId() {
  await authReady
  return auth?.currentUser?.uid ?? null
}

const recordsCol = (uid: string) => collection(fs!, 'users', uid, 'records')
// El contenido va como texto JSON: Firestore no admite listas dentro de listas ni algunos valores.
const recordDoc = (uid: string, tbl: string, id: string, data: unknown, deleted: boolean, clientUpdatedAt: number) => ({
  ref: doc(recordsCol(uid), `${tbl}__${id}`),
  value: { tbl, id, json: data == null ? null : JSON.stringify(data), deleted, clientUpdatedAt, updatedAt: serverTimestamp() },
})

async function commit(uid: string, items: ReturnType<typeof recordDoc>[]) {
  for (let i = 0; i < items.length; i += 400) {
    const batch = writeBatch(fs!)
    for (const it of items.slice(i, i + 400)) batch.set(it.ref, it.value)
    await batch.commit()
  }
}

async function push(userId: string) {
  for (const t of SYNC_TABLES) {
    const pk = pkOf(t)
    const rows = await db.table(t).where('_dirty').equals(1).toArray()
    if (!rows.length) continue
    await commit(userId, rows.map(({ _dirty, ...data }: any) => recordDoc(userId, t, String(data[pk]), data, false, data.updatedAt ?? 0)))
    // Marca como subido solo si no cambió mientras se subía.
    await db.transaction('rw', db.table(t), async () => {
      for (const r of rows) {
        const cur: any = await db.table(t).get(r[pk])
        if (cur && cur.updatedAt === r.updatedAt) await db.table(t).update(r[pk], { _remote: true } as any)
      }
    })
  }
  const tombs = await db.tombstones.toArray()
  if (tombs.length) {
    await commit(userId, tombs.map((x) => recordDoc(userId, x.tbl, x.id, null, true, x.at)))
    await db.tombstones.bulkDelete(tombs.map((x) => x.key))
  }
}

async function pull(userId: string) {
  const saved = localStorage.getItem(CURSOR)
  let cursor = saved ? Timestamp.fromMillis(Number(saved)) : Timestamp.fromMillis(0)
  for (;;) {
    const snap = await getDocsFromServer(query(recordsCol(userId), where('updatedAt', '>', cursor), orderBy('updatedAt'), limit(500)))
    if (snap.empty) break
    for (const d of snap.docs) {
      const rec = d.data() as { tbl: string; id: string; json: string | null; deleted: boolean; clientUpdatedAt: number; updatedAt: Timestamp }
      cursor = rec.updatedAt
      const t = rec.tbl as SyncTable
      if (!SYNC_TABLES.includes(t)) continue
      const table = db.table(t)
      const local: any = await table.get(rec.id)
      // Gana el cambio más reciente; un cambio local pendiente más nuevo no se pisa.
      const localWins = local && local._dirty === 1 && (local.updatedAt ?? 0) > Number(rec.clientUpdatedAt)
      if (localWins) continue
      if (rec.deleted) {
        if (local) {
          const k = `${t}:${rec.id}`
          remoteDeletes.add(k)
          try { await table.delete(rec.id) } finally { remoteDeletes.delete(k) }
        }
      } else if (rec.json) {
        await table.put({ ...JSON.parse(rec.json), _remote: true })
      }
    }
    localStorage.setItem(CURSOR, String(cursor.toMillis()))
    if (snap.size < 500) break
  }
}

let running: Promise<void> | null = null
let again = false

export function syncNow(): Promise<void> {
  if (!fs) return Promise.resolve()
  if (running) { again = true; return running }
  running = (async () => {
    try {
      const userId = await currentUserId()
      if (!userId) { setStatus({ state: 'idle' }); return }
      if (!navigator.onLine) { setStatus({ state: 'offline' }); return }
      setStatus({ state: 'syncing', error: undefined })
      await push(userId)
      await pull(userId)
      const now = Date.now()
      localStorage.setItem('nutri-last-sync', String(now))
      setStatus({ state: 'idle', lastSync: now })
    } catch (e: any) {
      setStatus({ state: navigator.onLine ? 'error' : 'offline', error: e?.message ?? String(e) })
    } finally {
      running = null
      if (again) { again = false; setTimeout(syncNow, 500) }
    }
  })()
  return running
}

let timer: ReturnType<typeof setTimeout> | undefined
const scheduleSync = () => { clearTimeout(timer); timer = setTimeout(syncNow, 1500) }

export function startAutoSync() {
  if (!fs) return
  setLocalChangeListener(scheduleSync)
  window.addEventListener('online', () => syncNow())
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow() })
  setInterval(() => { if (document.visibilityState === 'visible') syncNow() }, 60_000)
}

// ---------- Cuenta ----------

export async function getSession(): Promise<{ user: { email: string | null; uid: string } } | null> {
  const u = await authReady
  const cur = auth?.currentUser ?? u
  return cur ? { user: { email: cur.email, uid: cur.uid } } : null
}

export async function signIn(email: string, password: string) {
  try { await signInWithEmailAndPassword(auth!, email, password) } catch (e: any) { throw new Error(traducir(e?.code)) }
}

export async function signUp(email: string, password: string) {
  try { await createUserWithEmailAndPassword(auth!, email, password) } catch (e: any) { throw new Error(traducir(e?.code)) }
}

/** Sube lo pendiente, cierra sesión y borra los datos de este dispositivo (quedan en la nube). */
export async function signOutAndClear() {
  await syncNow()
  await signOut(auth!)
  await db.transaction('rw', [...SYNC_TABLES.map((t) => db.table(t)), db.tombstones], async () => {
    for (const t of SYNC_TABLES) {
      const keys = await db.table(t).toCollection().primaryKeys()
      keys.forEach((k) => remoteDeletes.add(`${t}:${k}`))
      await db.table(t).clear()
    }
    await db.tombstones.clear()
  })
  remoteDeletes.clear()
  localStorage.removeItem(CURSOR)
  localStorage.removeItem('nutri-last-sync')
}

function traducir(code: string) {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found': return 'Correo o contraseña incorrectos.'
    case 'auth/email-already-in-use': return 'Ese correo ya tiene cuenta. Inicia sesión.'
    case 'auth/weak-password': return 'La contraseña debe tener al menos 6 caracteres.'
    case 'auth/invalid-email': return 'El correo no es válido.'
    case 'auth/too-many-requests': return 'Demasiados intentos. Espera un momento.'
    case 'auth/network-request-failed': return 'Sin conexión. Revisa tu internet.'
    default: return `No se pudo iniciar sesión (${code ?? 'error'}).`
  }
}
