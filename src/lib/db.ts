import Dexie, { type Table } from 'dexie'
import { computeTargets } from './nutrition'

export type Sex = 'male' | 'female'
export type Activity = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active'
export type Goal = 'cut' | 'recomp' | 'maintain' | 'bulk'
export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack'
export type EntrySource = 'photo' | 'barcode' | 'label' | 'search' | 'text' | 'manual'

export interface Per100 { kcal: number; protein_g: number; carbs_g: number; fat_g: number }

export interface Targets {
  kcal: number; protein_g: number; carbs_g: number; fat_g: number; water_ml: number; bmr: number; tdee: number
  kcalTrain?: number; carbsTrain?: number; kcalRest?: number; carbsRest?: number
  steps?: number; sleepH?: number; kgWeek?: number
}

export interface Profile extends SyncMeta {
  id: 'me'
  sex: Sex
  birthYear: number
  heightCm: number
  weightKg: number
  activity: Activity
  goal: Goal
  ratePctWeek: number // % del peso por semana; negativo = déficit
  trainingDays: number[] // 0 = domingo
  carbCycling: boolean
  stepsTarget: number
  sleepTarget: number
  /** Sumar a la meta del día las calorías activas del reloj (en vez del factor de actividad fijo). */
  useActiveKcal?: boolean
  /** Ajuste acumulado de las revisiones semanales (kcal/día, negativo = menos). */
  calibrationKcal?: number
  /** Peso al que quieres llegar (para la proyección). */
  targetWeightKg?: number
  targets: Targets
}

/** Datos del día que llegan de Salud (vía Atajo) o se escriben a mano. Clave = fecha. */
export interface Health extends SyncMeta {
  date: string
  steps?: number
  sleepH?: number
  activeKcal?: number
  weightKg?: number
  /** Totales de actividad del día (desde Salud): minutos de ejercicio y distancias por deporte. */
  exerciseMin?: number
  runKm?: number
  bikeKm?: number
  swimM?: number
  /** Entrenamientos del día que llegan del Atajo (Apple Watch, Strava, etc. vía Salud). */
  workouts?: Workout[]
  /** Segundos de sueño que empezaron este día (calendario), según la última lectura del Atajo. */
  sleepTodaySec?: number
  source?: 'shortcut' | 'manual'
}

/** Registros del Coach: preferencias ('prefs'), plan generado ('plan') y sesiones hechas ('done:YYYY-MM-DD'). */
export interface CoachRecord extends SyncMeta { id: string; [k: string]: unknown }

export interface Workout { type: string; minutes?: number; kcal?: number; km?: number; start?: string }

/** Resumen del día que la app publica para que el Atajo lo registre en Salud. Clave = fecha. */
export interface Daily extends SyncMeta {
  date: string
  kcal: number; protein_g: number; carbs_g: number; fat_g: number; water_ml: number
  training?: boolean // anula el día de entreno/descanso por defecto
}

/** Campos de sincronización que agregan los hooks (no se escriben a mano). */
export interface SyncMeta { updatedAt?: number; _dirty?: 0 | 1 }

export interface Food extends SyncMeta {
  id?: string
  name: string
  brand?: string
  barcode?: string
  source: 'off' | 'ai' | 'label' | 'manual' | 'usda'
  /** Descripción original en USDA, para mostrar de dónde salen los valores. */
  sourceName?: string
  per100: Per100
  servingG?: number
  servingLabel?: string
  uses: number
  lastUsed: number
}

export interface Entry extends SyncMeta {
  id?: string
  date: string // YYYY-MM-DD
  meal: Meal
  name: string
  grams: number
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
  source: EntrySource
  foodId?: string
  scanId?: string
  /** Opción del plan del Coach: se cuenta en porciones (grams/100) en vez de gramos. */
  portion?: boolean
  createdAt: number
}

export interface Water extends SyncMeta { id?: string; date: string; ml: number; createdAt: number }

export interface Scan extends SyncMeta {
  id?: string
  createdAt: number
  mode: 'plate' | 'label' | 'text'
  model: string
  latencyMs: number
  raw: unknown
  status: 'ok' | 'saved' | 'discarded' | 'error'
  /** Lo que propuso la IA vs. lo que guardó el usuario, para medir precisión. */
  diff?: { name: string; estG: number; finalG: number | null }[]
}

export interface Setting extends SyncMeta { key: string; value: unknown }

export interface Tombstone { key: string; tbl: string; id: string; at: number }

export const SYNC_TABLES = ['profile', 'foods', 'entries', 'water', 'scans', 'settings', 'health', 'daily', 'coach'] as const
export type SyncTable = (typeof SYNC_TABLES)[number]

class NutriDB extends Dexie {
  profile!: Table<Profile, string>
  foods!: Table<Food, string>
  entries!: Table<Entry, string>
  water!: Table<Water, string>
  scans!: Table<Scan, string>
  settings!: Table<Setting, string>
  tombstones!: Table<Tombstone, string>
  health!: Table<Health, string>
  daily!: Table<Daily, string>
  coach!: Table<CoachRecord, string>

  constructor() {
    // Base nueva con ids de texto (UUID) para poder sincronizar entre dispositivos.
    super('nutri-v2')
    this.version(1).stores({
      profile: 'id, _dirty',
      foods: 'id, name, barcode, lastUsed, uses, _dirty',
      entries: 'id, date, meal, createdAt, _dirty',
      water: 'id, date, _dirty',
      scans: 'id, createdAt, _dirty',
      settings: 'key, _dirty',
      tombstones: 'key',
    })
    this.version(2).stores({
      health: 'date, _dirty',
      daily: 'date, _dirty',
    }).upgrade(async (tx) => {
      // Perfil anterior: objetivo lose/gain y ritmo en kg → nuevos modos y % por semana.
      await tx.table('profile').toCollection().modify((p: any) => { normalizeProfile(p) })
    })
    this.version(3).stores({ coach: 'id, _dirty' })
  }
}

/** Lleva un perfil de la v0.1 (objetivo lose/gain, ritmo en kg) al formato actual. */
export function normalizeProfile(p: any) {
  if (p.goal === 'lose') p.goal = 'cut'
  if (p.goal === 'gain') p.goal = 'bulk'
  if (p.ratePctWeek == null) p.ratePctWeek = p.rateKgWeek && p.weightKg ? +((p.rateKgWeek / p.weightKg) * 100).toFixed(2) : 0
  delete p.rateKgWeek
  p.trainingDays ??= [1, 2, 3, 4, 5]
  p.carbCycling ??= true
  p.stepsTarget ??= 10000
  p.sleepTarget ??= 7.5
  if (p.targets?.steps == null) {
    p.targets = computeTargets({
      sex: p.sex, age: new Date().getFullYear() - p.birthYear, heightCm: p.heightCm, weightKg: p.weightKg, activity: p.activity,
      goal: p.goal, ratePctWeek: p.ratePctWeek, trainingDays: p.trainingDays, carbCycling: p.carbCycling,
      stepsTarget: p.stepsTarget, sleepTarget: p.sleepTarget,
    })
  }
  return p
}

export const db = new NutriDB()

// ---------- Hooks: cada escritura local queda marcada para sincronizar ----------

/** Ajustes que nunca salen del dispositivo. */
const LOCAL_ONLY_SETTINGS = new Set<string>([])
let onLocalChange: () => void = () => {}
export const setLocalChangeListener = (fn: () => void) => { onLocalChange = fn }

/** Claves que se están borrando por orden del servidor (no generan lápida). */
export const remoteDeletes = new Set<string>()

for (const name of SYNC_TABLES) {
  const table = db.table(name)
  const pk = table.schema.primKey.keyPath as string
  table.hook('creating', function (_k, obj: any) {
    if (obj[pk] == null) obj[pk] = crypto.randomUUID()
    if (obj._remote) { delete obj._remote; obj._dirty = 0 }
    else {
      obj.updatedAt = Date.now()
      obj._dirty = name === 'settings' && LOCAL_ONLY_SETTINGS.has(obj.key) ? 0 : 1
      this.onsuccess = () => onLocalChange()
    }
    return obj[pk]
  })
  table.hook('updating', function (mods: any) {
    if (mods._remote) return { _remote: undefined, _dirty: 0 }
    this.onsuccess = () => onLocalChange()
    return { updatedAt: Date.now(), _dirty: 1 }
  })
  table.hook('deleting', function (key, _obj, trans) {
    const k = `${name}:${key}`
    if (remoteDeletes.has(k)) return
    trans.on('complete', () => {
      db.tombstones.put({ key: k, tbl: name, id: String(key), at: Date.now() }).then(() => onLocalChange())
    })
  })
}

/** Copia los datos de la versión anterior (ids numéricos) a la base nueva, una sola vez. */
export async function migrateFromV1() {
  if (!(await Dexie.exists('nutri'))) return
  const old = new Dexie('nutri')
  old.version(1).stores({ profile: 'id', foods: '++id', entries: '++id', water: '++id', scans: '++id', settings: 'key' })
  try {
    const [profile, foods, entries, water, scans, settings] = await Promise.all(
      ['profile', 'foods', 'entries', 'water', 'scans', 'settings'].map((t) => old.table(t).toArray()),
    )
    const foodMap = new Map<number, string>()
    const scanMap = new Map<number, string>()
    const uid = () => crypto.randomUUID()
    await db.transaction('rw', [db.profile, db.foods, db.entries, db.water, db.scans, db.settings], async () => {
      await db.profile.bulkPut(profile.map(normalizeProfile))
      await db.settings.bulkPut(settings)
      await db.foods.bulkAdd(foods.map((f: any) => { const id = uid(); foodMap.set(f.id, id); return { ...f, id } }))
      await db.scans.bulkAdd(scans.map((s: any) => { const id = uid(); scanMap.set(s.id, id); return { ...s, id } }))
      await db.entries.bulkAdd(entries.map((e: any) => ({ ...e, id: uid(), foodId: foodMap.get(e.foodId), scanId: scanMap.get(e.scanId) })))
      await db.water.bulkAdd(water.map((w: any) => ({ ...w, id: uid() })))
    })
  } finally {
    old.close()
    await Dexie.delete('nutri')
  }
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const s = await db.settings.get(key)
  return (s?.value as T) ?? fallback
}
export const setSetting = (key: string, value: unknown) => db.settings.put({ key, value })

export function todayISO(d = new Date()) {
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10)
}

export function shiftDate(iso: string, days: number) {
  const [y, m, d] = iso.split('-').map(Number)
  return todayISO(new Date(y, m - 1, d + days))
}

export function mealForNow(d = new Date()): Meal {
  const h = d.getHours()
  if (h < 11) return 'breakfast'
  if (h < 16) return 'lunch'
  if (h >= 19) return 'dinner'
  return 'snack'
}

export const MEAL_LABEL: Record<Meal, string> = {
  breakfast: 'Desayuno',
  lunch: 'Almuerzo',
  dinner: 'Cena',
  snack: 'Snacks',
}

export function macrosFor(per100: Per100, grams: number) {
  const f = grams / 100
  const r = (n: number) => Math.round(n * f * 10) / 10
  return { kcal: Math.round(per100.kcal * f), protein_g: r(per100.protein_g), carbs_g: r(per100.carbs_g), fat_g: r(per100.fat_g) }
}

/** Guarda o actualiza un alimento para que aparezca en "recientes". */
export async function rememberFood(f: Omit<Food, 'uses' | 'lastUsed' | 'id'>): Promise<string> {
  const existing = f.barcode
    ? await db.foods.where('barcode').equals(f.barcode).first()
    : await db.foods.where('name').equals(f.name).first()
  if (existing?.id) {
    await db.foods.update(existing.id, { ...f, uses: existing.uses + 1, lastUsed: Date.now() })
    return existing.id
  }
  return db.foods.add({ ...f, uses: 1, lastUsed: Date.now() }) as Promise<string>
}

export async function exportAll() {
  const [profile, foods, entries, water, scans, settings] = await Promise.all([
    db.profile.toArray(), db.foods.toArray(), db.entries.toArray(), db.water.toArray(), db.scans.toArray(),
    db.settings.filter((s) => s.key !== 'apiKey').toArray(),
  ])
  return { app: 'nutri', version: 1, exportedAt: new Date().toISOString(), profile, foods, entries, water, scans, settings }
}

export async function importAll(data: any) {
  if (data?.app !== 'nutri') throw new Error('El archivo no es un respaldo de Nutri')
  await db.transaction('rw', [db.profile, db.foods, db.entries, db.water, db.scans, db.settings], async () => {
    // Al importar se reemplaza el contenido; los registros nuevos quedan marcados para subir.
    const clean = (rows: any[] = []) => rows.map(({ _dirty, ...r }) => ({ ...r, id: r.id != null ? String(r.id) : undefined }))
    await db.profile.bulkPut(clean(data.profile))
    await db.foods.bulkPut(clean(data.foods))
    await db.entries.bulkPut(clean(data.entries).map((e: any) => ({ ...e, foodId: e.foodId != null ? String(e.foodId) : undefined, scanId: e.scanId != null ? String(e.scanId) : undefined })))
    await db.water.bulkPut(clean(data.water))
    await db.scans.bulkPut(clean(data.scans))
    await db.settings.bulkPut((data.settings ?? []).map(({ _dirty, ...r }: any) => r))
  })
}
