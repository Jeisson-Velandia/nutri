import { db, shiftDate, todayISO, type Profile } from './db'
import { dayTargets } from './nutrition'

export interface DayStat {
  date: string
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
  logged: boolean
  targetKcal: number
  steps?: number
  sleepH?: number
  activeKcal?: number
  weightKg?: number
  trendKg?: number
  training: boolean
}

/** Días entre dos fechas ISO (b − a). */
export function daysBetween(a: string, b: string) {
  const [y1, m1, d1] = a.split('-').map(Number)
  const [y2, m2, d2] = b.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000)
}

/** Estadísticas por día desde `from` hasta hoy, con la tendencia de peso suavizada. */
export async function loadDays(profile: Profile, from: string): Promise<DayStat[]> {
  const to = todayISO()
  const [entries, health, daily] = await Promise.all([
    db.entries.where('date').between(from, to, true, true).toArray(),
    db.health.toArray(),
    db.daily.toArray(),
  ])
  const hBy = new Map(health.map((h) => [h.date, h]))
  const dBy = new Map(daily.map((d) => [d.date, d]))

  // Tendencia de peso (media móvil exponencial ponderada por días), calculada con todo el historial.
  const weights = health.filter((h) => h.weightKg).sort((a, b) => a.date.localeCompare(b.date))
  const trendBy = new Map<string, number>()
  let trend: number | undefined
  let last: string | undefined
  for (const w of weights) {
    if (trend == null || !last) trend = w.weightKg!
    else {
      const gap = Math.max(1, daysBetween(last, w.date))
      const alpha = 1 - Math.pow(0.9, gap)
      trend = trend + alpha * (w.weightKg! - trend)
    }
    last = w.date
    trendBy.set(w.date, +trend.toFixed(2))
  }

  const out: DayStat[] = []
  let lastTrend: number | undefined = weights.filter((w) => w.date < from).length ? [...trendBy.entries()].filter(([d]) => d < from).pop()?.[1] : undefined
  for (let d = from; d <= to; d = shiftDate(d, 1)) {
    const es = entries.filter((e) => e.date === d)
    const h = hBy.get(d)
    const [y, m, dd] = d.split('-').map(Number)
    const exercised = (h?.exerciseMin ?? 0) >= 20 || !!h?.runKm || !!h?.bikeKm || !!h?.swimM
    const training = dBy.get(d)?.training ?? ((h?.workouts?.length ?? 0) > 0 || exercised || (profile.trainingDays ?? []).includes(new Date(y, m - 1, dd).getDay()))
    if (trendBy.has(d)) lastTrend = trendBy.get(d)
    out.push({
      date: d,
      kcal: es.reduce((a, e) => a + e.kcal, 0),
      protein_g: es.reduce((a, e) => a + e.protein_g, 0),
      carbs_g: es.reduce((a, e) => a + e.carbs_g, 0),
      fat_g: es.reduce((a, e) => a + e.fat_g, 0),
      logged: es.length > 0,
      targetKcal: dayTargets(profile.targets, training, { useActive: profile.useActiveKcal ?? true, activeKcal: h?.activeKcal }).kcal,
      steps: h?.steps,
      sleepH: h?.sleepH,
      activeKcal: h?.activeKcal,
      weightKg: h?.weightKg,
      trendKg: lastTrend,
      training,
    })
  }
  return out
}

export interface Projection {
  currentKg?: number
  targetKg?: number
  /** kg por semana según tus pesajes (negativo = bajando). */
  actualRate?: number
  actualDate?: string
  /** kg por semana según tu plan. */
  plannedRate?: number
  plannedDate?: string
  enoughData: boolean
}

function addDays(iso: string, n: number) { return shiftDate(iso, Math.round(n)) }

/** Proyección hacia el peso objetivo con la pendiente de los últimos 28 días de tendencia. */
export function project(days: DayStat[], profile: Profile): Projection {
  const pts = days.filter((d) => d.weightKg != null)
  const current = days.slice().reverse().find((d) => d.trendKg != null)?.trendKg ?? profile.weightKg
  const target = profile.targetWeightKg
  const plannedRate = profile.targets.kgWeek ?? 0
  const today = todayISO()
  const res: Projection = { currentKg: current, targetKg: target, plannedRate, enoughData: false }

  const recent = days.filter((d) => d.trendKg != null && daysBetween(d.date, today) <= 28)
  const weighIns = pts.filter((d) => daysBetween(d.date, today) <= 28)
  if (weighIns.length >= 4 && recent.length >= 2 && daysBetween(recent[0].date, recent[recent.length - 1].date) >= 10) {
    // Regresión lineal sobre la tendencia.
    const xs = recent.map((d) => daysBetween(recent[0].date, d.date))
    const ys = recent.map((d) => d.trendKg!)
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length
    const my = ys.reduce((a, b) => a + b, 0) / ys.length
    const num = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0)
    const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0)
    if (den > 0) {
      res.actualRate = +((num / den) * 7).toFixed(2)
      res.enoughData = true
    }
  }

  if (target != null && current != null) {
    const diff = target - current
    if (Math.abs(diff) < 0.2) {
      res.actualDate = res.plannedDate = today
    } else {
      if (plannedRate && Math.sign(plannedRate) === Math.sign(diff)) res.plannedDate = addDays(today, (diff / plannedRate) * 7)
      if (res.actualRate && Math.sign(res.actualRate) === Math.sign(diff) && Math.abs(res.actualRate) >= 0.05) {
        res.actualDate = addDays(today, (diff / res.actualRate) * 7)
      }
    }
  }
  return res
}

/**
 * Gasto real estimado: lo que comiste en promedio menos (o más) la energía que explica el cambio de peso.
 * Requiere al menos 14 días registrados en las últimas 4 semanas y pesajes al inicio y al final.
 */
export function estimateTdee(days: DayStat[]): { tdee: number; days: number } | null {
  const window = days.slice(-28)
  const logged = window.filter((d) => d.logged && d.kcal > 600)
  const trends = window.filter((d) => d.trendKg != null)
  if (logged.length < 14 || trends.length < 2) return null
  const span = daysBetween(trends[0].date, trends[trends.length - 1].date)
  if (span < 14) return null
  const avgIntake = logged.reduce((a, d) => a + d.kcal, 0) / logged.length
  const deltaKg = trends[trends.length - 1].trendKg! - trends[0].trendKg!
  const tdee = avgIntake - (deltaKg * 7700) / span
  return { tdee: Math.round(tdee / 10) * 10, days: logged.length }
}

export function avg(nums: (number | undefined)[]) {
  const v = nums.filter((n): n is number => n != null && isFinite(n))
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined
}

// ---------- Revisión semanal ----------

export interface WeeklyReview {
  start: string // lunes
  end: string   // domingo
  loggedDays: number
  avgKcal?: number
  avgTarget?: number
  avgProtein?: number
  proteinTarget: number
  avgSteps?: number
  avgActive?: number
  exerciseMin: number
  trainingDays: number
  weighIns: number
  weekChangeKg?: number   // cambio de la tendencia en la semana
  actualRate?: number     // kg/semana (últimas 2 semanas de tendencia)
  plannedRate: number
  tdeeEst?: number
  rec: {
    status: 'insufficient' | 'adherence' | 'on_track' | 'adjust'
    deltaKcal: number
    reason: string
  }
  days: DayStat[]
}

/** Lunes de la semana pasada completa (o de la semana que terminó ayer si hoy es lunes). */
export function lastWeekStart(today = todayISO()) {
  const [y, m, d] = today.split('-').map(Number)
  const wd = new Date(y, m - 1, d).getDay() // 0 = domingo
  const thisMonday = shiftDate(today, -((wd + 6) % 7))
  return shiftDate(thisMonday, -7)
}

const MAX_STEP = 150 // kcal por semana, para ajustar con calma

export function weeklyReview(all: DayStat[], profile: Profile, start: string, health: { date: string; exerciseMin?: number }[]): WeeklyReview {
  const end = shiftDate(start, 6)
  const week = all.filter((d) => d.date >= start && d.date <= end)
  const logged = week.filter((d) => d.logged && d.kcal > 600)
  const avgKcal = avg(logged.map((d) => d.kcal))
  const avgTarget = avg(logged.map((d) => d.targetKcal))
  const trendAt = (iso: string) => all.filter((d) => d.date <= iso && d.trendKg != null).pop()?.trendKg
  const t0 = trendAt(shiftDate(start, -1)), t1 = trendAt(end)
  const t14 = trendAt(shiftDate(end, -14))
  const weighIns14 = all.filter((d) => d.weightKg != null && d.date > shiftDate(end, -14) && d.date <= end).length
  const actualRate = t1 != null && t14 != null ? +(((t1 - t14) / 14) * 7).toFixed(2) : undefined
  const plannedRate = profile.goal === 'cut' || profile.goal === 'bulk' ? (profile.targets.kgWeek ?? 0) : 0
  const tdee = estimateTdee(all.filter((d) => d.date <= end))
  const exerciseMin = week.reduce((a, d) => a + (health.find((h) => h.date === d.date)?.exerciseMin ?? 0), 0)

  const base: Omit<WeeklyReview, 'rec'> = {
    start, end, loggedDays: logged.length, avgKcal, avgTarget,
    avgProtein: avg(logged.map((d) => d.protein_g)), proteinTarget: profile.targets.protein_g,
    avgSteps: avg(week.map((d) => d.steps)), avgActive: avg(week.map((d) => d.activeKcal)),
    exerciseMin, trainingDays: week.filter((d) => d.training).length,
    weighIns: week.filter((d) => d.weightKg != null).length,
    weekChangeKg: t0 != null && t1 != null ? +(t1 - t0).toFixed(2) : undefined,
    actualRate, plannedRate, tdeeEst: tdee?.tdee, days: week,
  }

  // 1) ¿Hay datos suficientes?
  if (logged.length < 5 || weighIns14 < 3 || actualRate == null) {
    return { ...base, rec: { status: 'insufficient', deltaKcal: 0,
      reason: `Para ajustar con confianza necesito al menos 5 días registrados (llevas ${logged.length}) y 3 pesajes en 2 semanas (llevas ${weighIns14}).` } }
  }
  // 2) Si no se cumplió la meta, el problema no es la meta.
  if (avgKcal != null && avgTarget != null && Math.abs(avgKcal - avgTarget) > 150) {
    const over = avgKcal > avgTarget
    return { ...base, rec: { status: 'adherence', deltaKcal: 0,
      reason: `Comiste en promedio ${Math.round(Math.abs(avgKcal - avgTarget))} kcal ${over ? 'por encima' : 'por debajo'} de tu meta. Antes de cambiarla, intenta cumplirla una semana más; así sabremos si funciona.` } }
  }
  // 3) Ajuste según el gasto real (si se puede) o según la diferencia de ritmo.
  let delta: number
  if (tdee) {
    const ideal = tdee.tdee + (plannedRate * 7700) / 7
    delta = ideal - profile.targets.kcal
  } else {
    delta = (-(actualRate - plannedRate) * 7700) / 7
  }
  delta = Math.max(-MAX_STEP, Math.min(MAX_STEP, Math.round(delta / 10) * 10))
  const diff = actualRate - plannedRate
  if (Math.abs(delta) < 50 || Math.abs(diff) < 0.1) {
    return { ...base, rec: { status: 'on_track', deltaKcal: 0,
      reason: `Vas a ${fmtRate(actualRate)} y tu plan es ${fmtRate(plannedRate)}. Vas bien: mantenemos la meta.` } }
  }
  const why = profile.goal === 'cut'
    ? diff > 0 ? `Estás bajando más lento que el plan (${fmtRate(actualRate)} vs ${fmtRate(plannedRate)}).` : `Estás bajando más rápido que el plan (${fmtRate(actualRate)} vs ${fmtRate(plannedRate)}); eso pone en riesgo el músculo y el rendimiento.`
    : `Tu ritmo real es ${fmtRate(actualRate)} y el plan es ${fmtRate(plannedRate)}.`
  return { ...base, rec: { status: 'adjust', deltaKcal: delta,
    reason: `${why} Propongo ${delta > 0 ? 'subir' : 'bajar'} ${Math.abs(delta)} kcal/día${tdee ? `, con tu gasto real estimado de ${tdee.tdee.toLocaleString('es-CO')} kcal` : ''}.` } }
}

const fmtRate = (r: number) => `${r > 0 ? '+' : ''}${r.toLocaleString('es-CO', { maximumFractionDigits: 2 })} kg/sem`
