import type { Activity, Goal, Sex, Targets } from './db'

export const ACTIVITY: Record<Activity, { label: string; hint: string; factor: number }> = {
  sedentary: { label: 'Sedentario', hint: 'Trabajo de escritorio, casi sin ejercicio', factor: 1.2 },
  light: { label: 'Ligero', hint: 'Ejercicio 1–3 días por semana', factor: 1.375 },
  moderate: { label: 'Moderado', hint: 'Ejercicio 3–5 días por semana', factor: 1.55 },
  active: { label: 'Activo', hint: 'Entrenas 6–7 días por semana', factor: 1.725 },
  very_active: { label: 'Muy activo', hint: 'Doble sesión o trabajo físico + entrenamiento', factor: 1.9 },
}

export const GOAL: Record<Goal, string> = {
  lose: 'Bajar grasa',
  maintain: 'Mantener',
  gain: 'Ganar masa',
}

export interface BodyInput {
  sex: Sex
  age: number
  heightCm: number
  weightKg: number
  activity: Activity
  goal: Goal
  rateKgWeek: number
}

/** Mifflin-St Jeor → TDEE → ajuste por objetivo (7.700 kcal ≈ 1 kg). */
export function computeTargets(b: BodyInput): Targets {
  const bmr = 10 * b.weightKg + 6.25 * b.heightCm - 5 * b.age + (b.sex === 'male' ? 5 : -161)
  const tdee = bmr * ACTIVITY[b.activity].factor
  const rate = b.goal === 'maintain' ? 0 : b.goal === 'lose' ? -Math.abs(b.rateKgWeek) : Math.abs(b.rateKgWeek)
  const floor = b.sex === 'male' ? 1500 : 1200
  const kcal = Math.max(floor, Math.round((tdee + (rate * 7700) / 7) / 10) * 10)

  // Proteína alta en déficit, moderada en volumen; grasa ~25 %; el resto carbohidratos.
  const proteinPerKg = b.goal === 'lose' ? 2.0 : 1.8
  const protein_g = Math.round(b.weightKg * proteinPerKg)
  const fat_g = Math.round((kcal * 0.25) / 9)
  const carbs_g = Math.max(0, Math.round((kcal - protein_g * 4 - fat_g * 9) / 4))
  const water_ml = Math.round((b.weightKg * 35) / 250) * 250

  return { kcal, protein_g, carbs_g, fat_g, water_ml, bmr: Math.round(bmr), tdee: Math.round(tdee) }
}
