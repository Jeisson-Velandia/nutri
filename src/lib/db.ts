import Dexie, { type Table } from 'dexie'

export type Sex = 'male' | 'female'
export type Activity = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active'
export type Goal = 'lose' | 'maintain' | 'gain'
export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack'
export type EntrySource = 'photo' | 'barcode' | 'label' | 'search' | 'text' | 'manual'

export interface Per100 { kcal: number; protein_g: number; carbs_g: number; fat_g: number }

export interface Targets { kcal: number; protein_g: number; carbs_g: number; fat_g: number; water_ml: number; bmr: number; tdee: number }

export interface Profile {
  id: 'me'
  sex: Sex
  birthYear: number
  heightCm: number
  weightKg: number
  activity: Activity
  goal: Goal
  rateKgWeek: number // negativo = déficit
  targets: Targets
}

export interface Food {
  id?: number
  name: string
  brand?: string
  barcode?: string
  source: 'off' | 'ai' | 'label' | 'manual'
  per100: Per100
  servingG?: number
  servingLabel?: string
  uses: number
  lastUsed: number
}

export interface Entry {
  id?: number
  date: string // YYYY-MM-DD
  meal: Meal
  name: string
  grams: number
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
  source: EntrySource
  foodId?: number
  scanId?: number
  createdAt: number
}

export interface Water { id?: number; date: string; ml: number; createdAt: number }

export interface Scan {
  id?: number
  createdAt: number
  mode: 'plate' | 'label' | 'text'
  model: string
  latencyMs: number
  raw: unknown
  status: 'ok' | 'saved' | 'discarded' | 'error'
  /** Lo que propuso la IA vs. lo que guardó el usuario, para medir precisión. */
  diff?: { name: string; estG: number; finalG: number | null }[]
}

export interface Setting { key: string; value: unknown }

class NutriDB extends Dexie {
  profile!: Table<Profile, string>
  foods!: Table<Food, number>
  entries!: Table<Entry, number>
  water!: Table<Water, number>
  scans!: Table<Scan, number>
  settings!: Table<Setting, string>

  constructor() {
    super('nutri')
    this.version(1).stores({
      profile: 'id',
      foods: '++id, name, barcode, lastUsed, uses',
      entries: '++id, date, meal, createdAt',
      water: '++id, date',
      scans: '++id, createdAt',
      settings: 'key',
    })
  }
}

export const db = new NutriDB()

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
export async function rememberFood(f: Omit<Food, 'uses' | 'lastUsed' | 'id'>): Promise<number> {
  const existing = f.barcode
    ? await db.foods.where('barcode').equals(f.barcode).first()
    : await db.foods.where('name').equals(f.name).first()
  if (existing?.id) {
    await db.foods.update(existing.id, { ...f, uses: existing.uses + 1, lastUsed: Date.now() })
    return existing.id
  }
  return db.foods.add({ ...f, uses: 1, lastUsed: Date.now() })
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
    await Promise.all([db.profile.clear(), db.foods.clear(), db.entries.clear(), db.water.clear(), db.scans.clear()])
    await db.profile.bulkPut(data.profile ?? [])
    await db.foods.bulkPut(data.foods ?? [])
    await db.entries.bulkPut(data.entries ?? [])
    await db.water.bulkPut(data.water ?? [])
    await db.scans.bulkPut(data.scans ?? [])
    await db.settings.bulkPut(data.settings ?? [])
  })
}
