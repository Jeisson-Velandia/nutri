import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, shiftDate, type Profile } from '../lib/db'
import { weeklySummary, type WeeklySummary } from '../lib/gemini'
import { GOALS, targetsFromProfile } from '../lib/nutrition'
import { lastWeekStart, weeklyReview, type DayStat } from '../lib/progress'
import { AiSpinner, ErrorBox } from '../ui'

interface CheckinRecord { id: string; applied?: number; kept?: boolean; ai?: WeeklySummary; at?: number }

const fmtDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
}
const r = (n?: number) => (n == null ? '—' : Math.round(n).toLocaleString('es-CO'))

const STATUS: Record<string, { label: string; color: string }> = {
  insufficient: { label: 'Faltan datos', color: 'var(--color-muted)' },
  adherence: { label: 'Revisa la constancia', color: 'var(--color-carbs)' },
  on_track: { label: 'Vas bien', color: 'var(--color-accent)' },
  adjust: { label: 'Ajuste sugerido', color: 'var(--color-protein)' },
}

export default function WeeklyCard({ all, profile }: { all: DayStat[]; profile: Profile }) {
  const latest = lastWeekStart()
  const [start, setStart] = useState(latest)
  const health = useLiveQuery(() => db.health.toArray(), []) ?? []
  const rec = useLiveQuery(() => db.coach.get(`checkin:${start}`), [start]) as CheckinRecord | undefined
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setError(null), [start])

  const w = weeklyReview(all, profile, start, health)
  const st = STATUS[w.rec.status]
  const done = all.filter((d) => d.date >= start && d.date <= w.end)
  const firstData = all.find((d) => d.logged || d.weightKg != null)?.date
  const canGoBack = firstData != null && shiftDate(start, -7) >= shiftDate(firstData, -6)

  async function apply() {
    const calibrationKcal = (profile.calibrationKcal ?? 0) + w.rec.deltaKcal
    const next = { ...profile, calibrationKcal }
    await db.profile.put({ ...next, targets: targetsFromProfile(next) })
    await db.coach.put({ ...(rec ?? {}), id: `checkin:${start}`, applied: w.rec.deltaKcal, at: Date.now() })
  }

  async function summarize() {
    setBusy(true); setError(null)
    try {
      const sessionsDone = (await db.coach.where('id').startsWith('done:').toArray())
        .filter((x) => x.id.slice(5) >= start && x.id.slice(5) <= w.end).map((x) => `${x.id.slice(5)} ${x.title ?? ''}`)
      const ai = await weeklySummary({
        objetivo: GOALS[profile.goal].label,
        semana: `${start} a ${w.end}`,
        metas: { kcal_promedio: Math.round(w.avgTarget ?? profile.targets.kcal), proteina_g: profile.targets.protein_g, pasos: profile.targets.steps, sueno_h: profile.targets.sleepH },
        dias: done.map((d) => ({
          fecha: d.date, registrado: d.logged, kcal: Math.round(d.kcal), meta_kcal: d.targetKcal, proteina_g: Math.round(d.protein_g),
          carbos_g: Math.round(d.carbs_g), grasa_g: Math.round(d.fat_g), pasos: d.steps ?? null, sueno_h: d.sleepH ?? null,
          kcal_activas: d.activeKcal ?? null, peso_kg: d.weightKg ?? null, dia_entreno: d.training,
        })),
        sesiones_del_coach_hechas: sessionsDone,
        cambio_peso_tendencia_kg: w.weekChangeKg ?? null,
        ritmo_real_kg_sem: w.actualRate ?? null,
        ritmo_plan_kg_sem: w.plannedRate,
        recomendacion_app: { estado: w.rec.status, cambio_kcal: w.rec.deltaKcal, motivo: w.rec.reason },
      })
      await db.coach.put({ ...(rec ?? {}), id: `checkin:${start}`, ai, at: Date.now() })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mx-5 mt-4 rounded-2xl border border-line bg-card p-4">
      <div className="flex items-center justify-between">
        <button disabled={!canGoBack} onClick={() => setStart(shiftDate(start, -7))} className="h-8 w-8 rounded-full text-muted disabled:opacity-20">‹</button>
        <div className="text-center">
          <h2 className="font-semibold">Revisión semanal</h2>
          <div className="text-xs text-muted">{fmtDay(start)} – {fmtDay(w.end)}</div>
        </div>
        <button disabled={start >= latest} onClick={() => setStart(shiftDate(start, 7))} className="h-8 w-8 rounded-full text-muted disabled:opacity-20">›</button>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Box label="Peso (tendencia)" value={w.weekChangeKg != null ? `${w.weekChangeKg > 0 ? '+' : ''}${w.weekChangeKg.toLocaleString('es-CO')} kg` : '—'} />
        <Box label="Kcal promedio" value={r(w.avgKcal)} sub={w.avgTarget ? `meta ${r(w.avgTarget)}` : undefined} />
        <Box label="Días registrados" value={`${w.loggedDays}/7`} />
        <Box label="Proteína" value={w.avgProtein ? `${r(w.avgProtein)} g` : '—'} sub={`meta ${w.proteinTarget} g`} />
        <Box label="Pasos" value={r(w.avgSteps)} sub={profile.targets.steps ? `meta ${r(profile.targets.steps)}` : undefined} />
        <Box label="Entreno" value={w.exerciseMin ? `${r(w.exerciseMin)} min` : `${w.trainingDays} días`} />
      </div>

      <div className="mt-3 rounded-xl bg-bg p-3 text-sm">
        <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ color: st.color, border: `1px solid ${st.color}` }}>{st.label}</span>
        <p className="mt-2">{w.rec.reason}</p>
        {w.rec.status === 'adjust' && (
          rec?.applied != null ? (
            <p className="mt-2 text-xs text-accent">Aplicado: {rec.applied > 0 ? '+' : ''}{rec.applied} kcal/día. Tu meta promedio ahora es {profile.targets.kcal.toLocaleString('es-CO')} kcal.</p>
          ) : rec?.kept ? (
            <p className="mt-2 text-xs text-muted">Decidiste mantener la meta esta semana.</p>
          ) : (
            <div className="mt-3 flex gap-2">
              <button onClick={apply} className="btn-primary flex-1 py-2.5">{w.rec.deltaKcal > 0 ? 'Subir' : 'Bajar'} {Math.abs(w.rec.deltaKcal)} kcal</button>
              <button onClick={() => db.coach.put({ ...(rec ?? {}), id: `checkin:${start}`, kept: true })} className="btn-ghost py-2.5">Mantener</button>
            </div>
          )
        )}
      </div>

      <div className="mt-3">
        {busy ? <AiSpinner label="Analizando tu semana…" /> : rec?.ai ? (
          <div className="space-y-2 text-sm">
            <p className="font-semibold">{rec.ai.headline}</p>
            <List title="Lo que hiciste bien" items={rec.ai.wins} color="var(--color-accent)" />
            <List title="Por mejorar" items={rec.ai.issues} color="var(--color-carbs)" />
            <List title="Para esta semana" items={rec.ai.actions} color="var(--color-protein)" numbered />
            {rec.ai.note && <p className="text-xs text-muted">{rec.ai.note}</p>}
            <button onClick={summarize} className="text-xs text-muted underline">Volver a generar</button>
          </div>
        ) : (
          <>
            {error && <div className="mb-2"><ErrorBox message={error} /></div>}
            <button onClick={summarize} disabled={w.loggedDays === 0} className="btn-ghost w-full py-2.5">Resumen de la semana con IA</button>
          </>
        )}
      </div>
    </section>
  )
}

function Box({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-bg px-1 py-2">
      <div className="text-[10px] text-muted">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-muted tabular-nums">{sub}</div>}
    </div>
  )
}

function List({ title, items, color, numbered }: { title: string; items: string[]; color: string; numbered?: boolean }) {
  if (!items.length) return null
  return (
    <div>
      <div className="text-xs font-medium" style={{ color }}>{title}</div>
      <ul className="mt-1 space-y-1">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2 text-muted">
            <span className="shrink-0 tabular-nums" style={{ color }}>{numbered ? `${i + 1}.` : '•'}</span>
            <span className="text-white/90">{it}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
