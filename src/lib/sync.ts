import { initializeApp } from 'firebase/app'
import {
  createUserWithEmailAndPassword, getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, type User,
} from 'firebase/auth'
import {
  collection, deleteDoc, doc, getDocsFromServer, initializeFirestore, limit, orderBy, query, serverTimestamp, Timestamp, where, writeBatch,
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
      await pullHealthInbox(userId)
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

// ---------- Salud de Apple (vía Atajos de iOS) ----------

/**
 * El Atajo escribe en users/{uid}/inbox/{fecha} un campo "data" con un JSON de texto:
 * { "date": "2026-11-12", "steps": 8123, "sleepH": 7.2, "activeKcal": 610, "weightKg": 79.4 }.
 * Aquí se pasa a la tabla health y se borra del buzón.
 */
async function pullHealthInbox(userId: string) {
  const snap = await getDocsFromServer(collection(fs!, 'users', userId, 'inbox'))
  for (const d of snap.docs) {
    try {
      const raw = d.data()
      const data = typeof raw.data === 'string' ? JSON.parse(raw.data) : raw
      const date = String(data.date ?? d.id).slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { await deleteDoc(d.ref); continue }
      const num = (v: unknown, decimals: number) => {
        const n = typeof v === 'number' ? v : parseLocaleNumber(String(v ?? ''))
        return isFinite(n) && n > 0 ? +n.toFixed(decimals) : undefined
      }
      const incoming = {
        steps: num(data.steps, 0),
        sleepH: data.sleep != null ? sleepFromSegments(String(data.sleep), date) : num(data.sleepH, 2),
        activeKcal: num(data.activeKcal, 0),
        weightKg: num(data.weightKg, 1),
        exerciseMin: num(data.exerciseMin, 0),
        runKm: num(data.runKm, 2),
        bikeKm: num(data.bikeKm, 1),
        // Natación: Salud la da en metros; si llega un número pequeño, venía en km.
        swimM: (() => { const v = num(data.swimM, 2); return v == null ? undefined : v < 20 ? Math.round(v * 1000) : Math.round(v) })(),
      }
      const current = await db.health.get(date)
      const merged: any = { ...(current ?? {}), date, source: 'shortcut' }
      for (const [k, v] of Object.entries(incoming)) if (v != null) merged[k] = v
      if (data.workouts != null) merged.workouts = parseWorkouts(String(data.workouts))

      // Sueño con dos sumas (en segundos) que Atajos sí calcula bien:
      //   hoySec  = sueño que empezó hoy desde las 00:00
      //   ayerSec = sueño que empezó desde ayer a las 00:00 (incluye hoySec)
      // La parte de anoche antes de medianoche = (ayerSec − hoySec) − lo que ayer ya había empezado
      // (guardado en la última corrida de ayer). Noche = hoySec + esa parte.
      const hoy = num(data.sleepTodaySec, 0)
      const desdeAyer = num(data.sleepSinceYesterdaySec, 0)
      if (hoy != null || desdeAyer != null) {
        const h = Math.max(hoy ?? 0, current?.sleepTodaySec ?? 0)
        const y = Math.max(desdeAyer ?? 0, h)
        merged.sleepTodaySec = h
        const [yy, mm, dd] = date.split('-').map(Number)
        const prevDate = new Date(yy, mm - 1, dd - 1)
        const prevIso = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}-${String(prevDate.getDate()).padStart(2, '0')}`
        const prevH = (await db.health.get(prevIso))?.sleepTodaySec
        const antesMedianoche = prevH != null ? Math.min(6 * 3600, Math.max(0, y - h - prevH)) : 0
        const total = h + antesMedianoche
        if (total > 0) merged.sleepH = +(total / 3600).toFixed(2)
      }
      await db.health.put(merged)
      await deleteDoc(d.ref)
    } catch {
      // Un registro mal formado no debe frenar la sincronización.
    }
  }
}

/**
 * El Atajo envía los tramos de sueño (ya sin "En cama" ni "Despierto") como líneas "inicio|fin" (o "inicio|segundos"),
 * con el inicio en formato ISO 8601. Se suma solo la noche que termina el día indicado:
 * tramos que empiezan entre las 18:00 del día anterior y las 14:00 de ese día.
 */
function sleepFromSegments(text: string, date: string): number | undefined {
  const [y, m, d] = date.split('-').map(Number)
  const from = new Date(y, m - 1, d - 1, 18, 0).getTime()
  const to = new Date(y, m - 1, d, 14, 0).getTime()
  let secs = 0
  for (const line of text.split(/\r?\n/)) {
    const [startRaw, durRaw] = line.split('|').map((x) => x?.trim())
    if (!startRaw || !durRaw) continue
    const start = Date.parse(startRaw)
    // Segunda parte: fecha de fin (ISO) o duración en segundos.
    const endMs = Date.parse(durRaw)
    const dur = isFinite(endMs) && /\d{4}-\d{2}-\d{2}/.test(durRaw)
      ? (endMs - start) / 1000
      : parseFloat(durRaw.replace(',', '.').replace(/[^\d.]/g, ''))
    if (!isFinite(start) || !isFinite(dur)) continue
    if (start >= from && start < to) secs += dur
  }
  return secs > 0 ? +(secs / 3600).toFixed(2) : undefined
}

/**
 * Entrenamientos como "tipo|duración|kcal|distancia", separados por ";;" (las tres últimas opcionales).
 * La duración puede venir como segundos, "1:02:03", "62:03" o "1 h 2 min".
 */
export function parseWorkouts(text: string) {
  const out: { type: string; minutes?: number; kcal?: number; km?: number }[] = []
  // Separador entre entrenamientos: ";;" (un salto de línea rompería el JSON del Atajo) o nueva línea.
  for (const line of text.split(/;;|\r?\n/)) {
    const [typeRaw, durRaw, kcalRaw, distRaw] = line.split('|').map((x) => (x ?? '').trim())
    if (!typeRaw) continue
    const minutes = durationToMinutes(durRaw)
    const kcal = parseLocaleNumber(kcalRaw ?? '')
    let km = parseLocaleNumber(distRaw ?? '')
    if (/\bm\b/i.test(distRaw ?? '') && !/km/i.test(distRaw ?? '')) km = km / 1000 // vino en metros
    out.push({
      type: typeRaw,
      minutes: minutes && minutes > 0 ? Math.round(minutes) : undefined,
      kcal: isFinite(kcal) && kcal > 0 ? Math.round(kcal) : undefined,
      km: isFinite(km) && km > 0 ? +km.toFixed(2) : undefined,
    })
  }
  return out
}

function durationToMinutes(raw?: string): number | undefined {
  if (!raw) return undefined
  const t = raw.trim()
  const hms = t.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/)
  if (hms) {
    const [a, b, c] = [hms[1], hms[2], hms[3]].map((x) => (x ? +x : 0))
    return hms[3] != null ? a * 60 + b + c / 60 : a + b / 60 // h:mm:ss o mm:ss
  }
  const h = t.match(/(\d+[.,]?\d*)\s*h/i)
  const m = t.match(/(\d+[.,]?\d*)\s*min/i)
  const sec = t.match(/(\d+[.,]?\d*)\s*s(?:eg)?\b/i)
  if (h || m) return (h ? parseLocaleNumber(h[1]) * 60 : 0) + (m ? parseLocaleNumber(m[1]) : 0) + (sec ? parseLocaleNumber(sec[1]) / 60 : 0)
  const n = parseLocaleNumber(t)
  if (!isFinite(n)) return undefined
  return n > 600 ? n / 60 : n // número suelto: segundos si es grande, si no minutos
}

/** Lee números escritos como "8123", "8.123", "8 123", "612,5", "1.612,45" o "1,612.45". */
export function parseLocaleNumber(raw: string): number {
  let t = raw.replace(/[^\d.,-]/g, '')
  if (!t) return NaN
  const lastDot = t.lastIndexOf('.')
  const lastComma = t.lastIndexOf(',')
  if (lastDot >= 0 && lastComma >= 0) {
    // El separador que aparece de último es el decimal.
    const dec = lastDot > lastComma ? '.' : ','
    const thou = dec === '.' ? ',' : '.'
    t = t.split(thou).join('').replace(dec, '.')
  } else {
    const sep = lastDot >= 0 ? '.' : lastComma >= 0 ? ',' : null
    if (sep) {
      const parts = t.split(sep)
      // "8.123" o "1.234.567" → miles; "612,5" o "79.4" → decimal.
      const isThousands = parts.length > 2 || (parts[parts.length - 1].length === 3 && parts[0].length <= 3 && parts[0] !== '0')
      t = isThousands ? parts.join('') : parts.join('.')
    }
  }
  return parseFloat(t)
}

/** Código que se pega una vez en el Atajo: permite escribir en tu buzón sin guardar tu contraseña. */
export async function healthConnectionCode(): Promise<string | null> {
  await authReady
  const u = auth?.currentUser
  if (!u) return null
  return JSON.stringify({ k: firebaseConfig.apiKey, p: firebaseConfig.projectId, u: u.uid, r: u.refreshToken })
}

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
