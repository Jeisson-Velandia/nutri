import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Nav } from '../App'
import { db, shiftDate, todayISO, type Profile } from '../lib/db'
import { avg, estimateTdee, loadDays, project, type DayStat } from '../lib/progress'

type Range = 7 | 30 | 90
const RANGES: { id: Range; label: string }[] = [
  { id: 7, label: 'Semana' },
  { id: 30, label: 'Mes' },
  { id: 90, label: '3 meses' },
]

const fmtDate = (iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-CO', opts)
}
const fmt1 = (n?: number) => (n == null ? '—' : n.toLocaleString('es-CO', { maximumFractionDigits: 1 }))

export default function Progress({ nav, profile }: { nav: Nav; profile: Profile }) {
  const [range, setRange] = useState<Range>(7)
  const [days, setDays] = useState<DayStat[] | null>(null)
  const [all, setAll] = useState<DayStat[] | null>(null)
  // Recalcula cuando cambian registros, salud o el perfil.
  const version = useLiveQuery(async () => `${await db.entries.count()}-${await db.health.count()}-${(await db.health.toArray()).map((h) => h.weightKg ?? '').join()}`, [])

  useEffect(() => {
    let alive = true
    const today = todayISO()
    loadDays(profile, shiftDate(today, -119)).then((d) => {
      if (!alive) return
      setAll(d)
      setDays(d.slice(-range))
    })
    return () => { alive = false }
  }, [profile, range, version])

  const proj = useMemo(() => (all ? project(all, profile) : null), [all, profile])
  const tdee = useMemo(() => (all ? estimateTdee(all) : null), [all])
  if (!days || !proj) return null

  const logged = days.filter((d) => d.logged)
  const avgKcal = avg(logged.map((d) => d.kcal))
  const avgTarget = avg(logged.map((d) => d.targetKcal))
  const onTarget = logged.filter((d) => Math.abs(d.kcal - d.targetKcal) <= d.targetKcal * 0.1).length
  const avgProtein = avg(logged.map((d) => d.protein_g))
  const avgSteps = avg(days.map((d) => d.steps))
  const avgSleep = avg(days.map((d) => d.sleepH))
  const avgActive = avg(days.map((d) => d.activeKcal))
  const t = profile.targets

  return (
    <div className="pb-6">
      <div className="pt-safe px-5">
        <h1 className="pt-2 text-2xl font-bold tracking-tight">Progreso</h1>
        <div className="mt-3 flex gap-1">
          {RANGES.map((r) => (
            <button key={r.id} onClick={() => setRange(r.id)} className={`flex-1 rounded-xl py-2 text-sm font-medium ${range === r.id ? 'bg-accent text-black' : 'bg-card text-muted'}`}>{r.label}</button>
          ))}
        </div>
      </div>

      {/* Proyección */}
      <section className="mx-5 mt-4 rounded-2xl border border-line bg-card p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">Proyección</h2>
          <button onClick={() => nav.go({ name: 'profile' })} className="text-xs text-accent">Editar meta</button>
        </div>
        {proj.targetKg == null ? (
          <p className="mt-2 text-sm text-muted">Define tu <b className="text-white">peso objetivo</b> en tu plan para ver cuándo llegarías.</p>
        ) : (
          <>
            <div className="mt-2 flex items-end gap-3">
              <div>
                <div className="text-3xl font-bold tabular-nums">{fmt1(proj.currentKg)}<span className="ml-1 text-base text-muted">kg</span></div>
                <div className="text-xs text-muted">tendencia actual</div>
              </div>
              <div className="pb-1 text-muted">→</div>
              <div>
                <div className="text-3xl font-bold tabular-nums text-accent">{fmt1(proj.targetKg)}<span className="ml-1 text-base text-muted">kg</span></div>
                <div className="text-xs text-muted">objetivo · faltan {fmt1(Math.abs(proj.targetKg - (proj.currentKg ?? 0)))} kg</div>
              </div>
            </div>
            <div className="mt-3 space-y-1.5 text-sm">
              <Row label="Según tus pesajes" rate={proj.actualRate} date={proj.actualDate}
                empty={proj.enoughData ? 'vas en dirección contraria a la meta' : 'pésate 4+ veces en 2 semanas para calcularla'} />
              <Row label="Según tu plan" rate={proj.plannedRate} date={proj.plannedDate} empty="sin ritmo definido" />
            </div>
          </>
        )}
      </section>

      {/* Peso */}
      <section className="mx-5 mt-3 rounded-2xl border border-line bg-card p-4">
        <h2 className="font-semibold">Peso</h2>
        <WeightChart days={days} target={proj.targetKg} />
        <p className="mt-1 text-xs text-muted">Puntos: pesajes · línea: tendencia (suaviza el agua y la sal del día a día).</p>
      </section>

      {/* Calorías */}
      <section className="mx-5 mt-3 rounded-2xl border border-line bg-card p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">Calorías</h2>
          <span className="text-xs text-muted tabular-nums">{onTarget}/{logged.length} días en meta (±10 %)</span>
        </div>
        <KcalChart days={days} />
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <Stat label="Promedio comido" value={avgKcal ? `${Math.round(avgKcal)} kcal` : '—'} sub={avgTarget ? `meta ${Math.round(avgTarget)}` : undefined} />
          <Stat label="Proteína promedio" value={avgProtein ? `${Math.round(avgProtein)} g` : '—'} sub={`meta ${t.protein_g} g`} />
          <Stat label="Pasos promedio" value={avgSteps ? Math.round(avgSteps).toLocaleString('es-CO') : '—'} sub={t.steps ? `meta ${t.steps.toLocaleString('es-CO')}` : undefined} />
          <Stat label="Sueño promedio" value={avgSleep ? `${fmt1(avgSleep)} h` : '—'} sub={t.sleepH ? `meta ${t.sleepH} h` : undefined} />
          <Stat label="Calorías activas" value={avgActive ? `${Math.round(avgActive)} kcal` : '—'} sub="promedio diario" />
          <Stat label="Días registrados" value={`${logged.length} / ${days.length}`} />
        </div>
      </section>

      {/* Gasto real */}
      <section className="mx-5 mt-3 rounded-2xl border border-line bg-card p-4 text-sm">
        <h2 className="font-semibold">Tu gasto real estimado</h2>
        {tdee ? (
          <>
            <p className="mt-1">
              <b className="text-lg tabular-nums text-accent">{tdee.tdee.toLocaleString('es-CO')} kcal/día</b>
              <span className="text-muted"> · calculado con {tdee.days} días de registro y tu tendencia de peso.</span>
            </p>
            <p className="mt-1 text-muted">
              La fórmula estimaba {t.tdee.toLocaleString('es-CO')} kcal.
              {Math.abs(tdee.tdee - t.tdee) >= 150 && ' La diferencia es grande: considera ajustar tu nivel de actividad en tu plan.'}
            </p>
          </>
        ) : (
          <p className="mt-1 text-muted">Registra tus comidas al menos 14 días y pésate varias veces: con eso calculo cuánto gastas de verdad y ajusto tus metas con datos reales.</p>
        )}
      </section>
    </div>
  )
}

function Row({ label, rate, date, empty }: { label: string; rate?: number; date?: string; empty: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted">{label}</span>
      {rate != null && date ? (
        <span className="text-right tabular-nums">
          {rate > 0 ? '+' : ''}{fmt1(rate)} kg/sem · <b>{fmtDate(date, { day: 'numeric', month: 'short', year: 'numeric' })}</b>
        </span>
      ) : (
        <span className="text-right text-xs text-muted">{rate != null ? `${rate > 0 ? '+' : ''}${fmt1(rate)} kg/sem · ` : ''}{empty}</span>
      )}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-bg p-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted tabular-nums">{sub}</div>}
    </div>
  )
}

// ---------- Gráficas (SVG propio, sin librerías) ----------

const W = 320
const H = 150
const PAD = { l: 30, r: 8, t: 10, b: 20 }

function WeightChart({ days, target }: { days: DayStat[]; target?: number }) {
  const pts = days.filter((d) => d.weightKg != null)
  const trend = days.filter((d) => d.trendKg != null)
  if (pts.length === 0 && trend.length === 0) {
    return <p className="mt-3 text-sm text-muted">Aún no hay pesajes en este periodo. Anota tu peso en la tarjeta "Peso" de Hoy (o llega solo desde Salud).</p>
  }
  const vals = [...pts.map((d) => d.weightKg!), ...trend.map((d) => d.trendKg!), ...(target ? [target] : [])]
  let lo = Math.min(...vals), hi = Math.max(...vals)
  if (hi - lo < 2) { const c = (hi + lo) / 2; lo = c - 1; hi = c + 1 }
  lo = Math.floor(lo - 0.3); hi = Math.ceil(hi + 0.3)
  const x = (i: number) => PAD.l + (i / Math.max(1, days.length - 1)) * (W - PAD.l - PAD.r)
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b)
  const idx = new Map(days.map((d, i) => [d.date, i]))
  const path = trend.map((d, i) => `${i ? 'L' : 'M'}${x(idx.get(d.date)!).toFixed(1)},${y(d.trendKg!).toFixed(1)}`).join(' ')
  const ticks = [lo, (lo + hi) / 2, hi]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth="1" />
          <text x={PAD.l - 4} y={y(v) + 3} textAnchor="end" fontSize="9" fill="var(--color-muted)">{v.toFixed(0)}</text>
        </g>
      ))}
      {target != null && target >= lo && target <= hi && (
        <g>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(target)} y2={y(target)} stroke="var(--color-accent)" strokeDasharray="4 4" strokeWidth="1.2" />
          <text x={W - PAD.r} y={y(target) - 4} textAnchor="end" fontSize="9" fill="var(--color-accent)">meta {target}</text>
        </g>
      )}
      <path d={path} fill="none" stroke="var(--color-protein)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((d) => <circle key={d.date} cx={x(idx.get(d.date)!)} cy={y(d.weightKg!)} r="2.6" fill="var(--color-card)" stroke="var(--color-protein)" strokeWidth="1.4" />)}
      <AxisDates days={days} x={x} />
    </svg>
  )
}

function KcalChart({ days }: { days: DayStat[] }) {
  // Con 90 días se agrupa por semana para que se lea.
  const weekly = days.length > 45
  const groups: { label: string; date: string; kcal?: number; target: number }[] = []
  if (weekly) {
    for (let i = 0; i < days.length; i += 7) {
      const chunk = days.slice(i, i + 7)
      const l = chunk.filter((d) => d.logged)
      groups.push({ label: fmtDate(chunk[0].date), date: chunk[0].date, kcal: l.length ? avg(l.map((d) => d.kcal)) : undefined, target: avg(chunk.map((d) => d.targetKcal))! })
    }
  } else {
    for (const d of days) groups.push({ label: fmtDate(d.date), date: d.date, kcal: d.logged ? d.kcal : undefined, target: d.targetKcal })
  }
  const max = Math.max(...groups.map((g) => Math.max(g.kcal ?? 0, g.target))) * 1.1
  const bw = (W - PAD.l - PAD.r) / groups.length
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b)
  const ticks = [0, Math.round(max / 2 / 500) * 500, Math.round((max * 0.9) / 500) * 500]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth="1" />
          <text x={PAD.l - 4} y={y(v) + 3} textAnchor="end" fontSize="9" fill="var(--color-muted)">{v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}</text>
        </g>
      ))}
      {groups.map((g, i) => {
        const x0 = PAD.l + i * bw
        const within = g.kcal != null && Math.abs(g.kcal - g.target) <= g.target * 0.1
        const over = g.kcal != null && g.kcal > g.target * 1.1
        const color = within ? 'var(--color-accent)' : over ? 'var(--color-fat)' : 'var(--color-carbs)'
        return (
          <g key={g.date}>
            {g.kcal != null && (
              <rect x={x0 + bw * 0.18} width={bw * 0.64} y={y(g.kcal)} height={Math.max(0, y(0) - y(g.kcal))} rx={Math.min(3, bw * 0.2)} fill={color} opacity="0.9" />
            )}
            <line x1={x0 + bw * 0.08} x2={x0 + bw * 0.92} y1={y(g.target)} y2={y(g.target)} stroke="#fff" strokeOpacity="0.55" strokeWidth="1.5" />
          </g>
        )
      })}
      <AxisDates days={days} x={(i) => PAD.l + (i + 0.5) * ((W - PAD.l - PAD.r) / days.length)} />
    </svg>
  )
}

function AxisDates({ days, x }: { days: DayStat[]; x: (i: number) => number }) {
  const n = days.length
  const marks = n <= 7 ? days.map((_, i) => i) : [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1]
  return (
    <>
      {marks.map((i) => (
        <text key={i} x={x(i)} y={H - 5} textAnchor="middle" fontSize="9" fill="var(--color-muted)">
          {n <= 7 ? fmtDate(days[i].date, { weekday: 'narrow' }) : fmtDate(days[i].date)}
        </text>
      ))}
    </>
  )
}
