import type { Activity, Goal, Sex, Targets } from './db'

export const ACTIVITY: Record<Activity, { label: string; hint: string; factor: number }> = {
  sedentary: { label: 'Sedentario', hint: 'Trabajo de escritorio, casi sin ejercicio', factor: 1.2 },
  light: { label: 'Ligero', hint: 'Ejercicio 1–3 días por semana', factor: 1.375 },
  moderate: { label: 'Moderado', hint: 'Ejercicio 3–5 días por semana', factor: 1.55 },
  active: { label: 'Activo', hint: 'Entrenas 6–7 días por semana', factor: 1.725 },
  very_active: { label: 'Muy activo', hint: 'Doble sesión o trabajo físico + entrenamiento', factor: 1.9 },
}

/**
 * Modos de objetivo. rate = % del peso corporal por semana (negativo = bajar).
 * Proteína en g/kg; pasos diarios sugeridos.
 */
export const GOALS: Record<Goal, {
  label: string; hint: string
  rate: { min: number; max: number; def: number } | null
  kcalAdj?: number // ajuste fijo sobre el TDEE (recomposición)
  proteinPerKg: number; fatPct: number; steps: number
}> = {
  cut: {
    label: 'Definición', hint: 'Bajar grasa conservando músculo',
    rate: { min: -1, max: -0.25, def: -0.5 }, proteinPerKg: 2.2, fatPct: 0.25, steps: 10000,
  },
  recomp: {
    label: 'Recomposición', hint: 'Peso estable: menos grasa, más músculo',
    rate: null, kcalAdj: -0.1, proteinPerKg: 2.2, fatPct: 0.25, steps: 9000,
  },
  maintain: {
    label: 'Mantenimiento', hint: 'Sostener peso y rendimiento',
    rate: null, proteinPerKg: 1.8, fatPct: 0.28, steps: 8000,
  },
  bulk: {
    label: 'Volumen', hint: 'Ganar músculo con superávit controlado',
    rate: { min: 0.1, max: 0.5, def: 0.25 }, proteinPerKg: 1.8, fatPct: 0.25, steps: 7000,
  },
}

export interface BodyInput {
  sex: Sex
  age: number
  heightCm: number
  weightKg: number
  activity: Activity
  goal: Goal
  ratePctWeek: number
  trainingDays: number[] // 0 = domingo
  carbCycling: boolean
  stepsTarget: number
  sleepTarget: number
  /** Ajuste acumulado de las revisiones semanales (kcal/día). */
  calibrationKcal?: number
}

/** Mifflin-St Jeor → TDEE → ajuste por objetivo (7.700 kcal ≈ 1 kg) → macros y ciclado de carbohidratos. */
export function computeTargets(b: BodyInput): Targets {
  const g = GOALS[b.goal]
  const bmr = 10 * b.weightKg + 6.25 * b.heightCm - 5 * b.age + (b.sex === 'male' ? 5 : -161)
  const tdee = bmr * ACTIVITY[b.activity].factor
  const kgWeek = g.rate ? (b.ratePctWeek / 100) * b.weightKg : 0
  const adj = g.rate ? (kgWeek * 7700) / 7 : (g.kcalAdj ?? 0) * tdee
  const floor = Math.max(b.sex === 'male' ? 1500 : 1200, Math.round(bmr))
  const kcal = Math.max(floor, Math.round((tdee + adj + (b.calibrationKcal ?? 0)) / 10) * 10)

  const protein_g = Math.round(b.weightKg * g.proteinPerKg)
  const fat_g = Math.max(Math.round(b.weightKg * 0.6), Math.round((kcal * g.fatPct) / 9))
  const carbs_g = Math.max(0, Math.round((kcal - protein_g * 4 - fat_g * 9) / 4))
  const water_ml = Math.round((b.weightKg * 35) / 250) * 250

  // Ciclado: más carbohidratos los días de entreno, menos en descanso, mismo promedio semanal.
  const nT = b.trainingDays.length
  const nR = 7 - nT
  let carbsTrain = carbs_g
  let carbsRest = carbs_g
  if (b.carbCycling && nT > 0 && nR > 0) {
    const delta = Math.round(carbs_g * 0.2)
    carbsTrain = carbs_g + delta
    carbsRest = Math.max(0, Math.round(carbs_g - (delta * nT) / nR))
  }

  return {
    kcal, protein_g, carbs_g, fat_g, water_ml, bmr: Math.round(bmr), tdee: Math.round(tdee),
    kcalTrain: kcal + (carbsTrain - carbs_g) * 4, carbsTrain,
    kcalRest: kcal + (carbsRest - carbs_g) * 4, carbsRest,
    steps: b.stepsTarget, sleepH: b.sleepTarget, kgWeek: +kgWeek.toFixed(2),
  }
}

/** Metas del día según si es de entreno o descanso. */
export function targetsForDay(t: Targets, training: boolean) {
  if (t.kcalTrain == null) return { kcal: t.kcal, carbs_g: t.carbs_g }
  return training ? { kcal: t.kcalTrain, carbs_g: t.carbsTrain! } : { kcal: t.kcalRest!, carbs_g: t.carbsRest! }
}

/**
 * Meta del día ajustada con las calorías activas del reloj (si está activado en el plan):
 *   meta = basal × 1,1 (digestión) + 85 % de las calorías activas + ajuste del objetivo,
 *   nunca por debajo de la meta de un día tranquilo (basal × 1,2 + ajuste).
 * Las calorías extra van a carbohidratos; proteína y grasa no cambian.
 */
export function dayTargets(
  t: Targets,
  training: boolean,
  opts: { useActive: boolean; activeKcal?: number },
): { kcal: number; carbs_g: number; base: number; fromActivity: number; dynamic: boolean } {
  const fixed = targetsForDay(t, training)
  if (!opts.useActive || opts.activeKcal == null) return { ...fixed, base: fixed.kcal, fromActivity: 0, dynamic: false }
  const adj = t.kcal - t.tdee // déficit o superávit del objetivo
  const calmDay = Math.round((t.bmr * 1.2 + adj) / 10) * 10
  const withActivity = Math.round((t.bmr * 1.1 + opts.activeKcal * 0.85 + adj) / 10) * 10
  const kcal = Math.max(calmDay, withActivity)
  const carbs_g = Math.max(0, Math.round((kcal - t.protein_g * 4 - t.fat_g * 9) / 4))
  return { kcal, carbs_g, base: calmDay, fromActivity: kcal - calmDay, dynamic: true }
}

/** Recalcula las metas de un perfil guardado (por ejemplo, tras aplicar una revisión semanal). */
export function targetsFromProfile(p: {
  sex: Sex; birthYear: number; heightCm: number; weightKg: number; activity: Activity; goal: Goal
  ratePctWeek: number; trainingDays: number[]; carbCycling: boolean; stepsTarget: number; sleepTarget: number; calibrationKcal?: number
}) {
  return computeTargets({
    sex: p.sex, age: new Date().getFullYear() - p.birthYear, heightCm: p.heightCm, weightKg: p.weightKg, activity: p.activity,
    goal: p.goal, ratePctWeek: p.ratePctWeek, trainingDays: p.trainingDays, carbCycling: p.carbCycling,
    stepsTarget: p.stepsTarget, sleepTarget: p.sleepTarget, calibrationKcal: p.calibrationKcal,
  })
}
