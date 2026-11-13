import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Nav } from '../App'
import { db, MEAL_LABEL, shiftDate, todayISO, type Entry, type Health, type Meal, type Profile } from '../lib/db'
import { dayTargets } from '../lib/nutrition'
import { Icon, MacroBar, Ring } from '../ui'

const MEALS: Meal[] = ['breakfast', 'lunch', 'dinner', 'snack']

function dateLabel(iso: string) {
  const t = todayISO()
  if (iso === t) return 'Hoy'
  if (iso === shiftDate(t, -1)) return 'Ayer'
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'short' })
}

export default function Today({ nav, profile }: { nav: Nav; profile: Profile }) {
  const { date, setDate } = nav
  const entries = useLiveQuery(() => db.entries.where('date').equals(date).sortBy('createdAt'), [date]) ?? []
  const water = useLiveQuery(() => db.water.where('date').equals(date).toArray(), [date]) ?? []
  const health = useLiveQuery(() => db.health.get(date), [date])
  const daily = useLiveQuery(() => db.daily.get(date), [date])
  const [editing, setEditing] = useState<Entry | null>(null)
  const [editHealth, setEditHealth] = useState(false)

  const [y, mo, d] = date.split('-').map(Number)
  const weekday = new Date(y, mo - 1, d).getDay()
  const workouts = health?.workouts ?? []
  // Si hubo entreno registrado en Salud, el día cuenta como de entreno (salvo que lo cambies a mano).
  const exercised = (health?.exerciseMin ?? 0) >= 20 || !!health?.runKm || !!health?.bikeKm || !!health?.swimM
  const training = daily?.training ?? (workouts.length > 0 || exercised || (profile.trainingDays ?? []).includes(weekday))
  const dt = dayTargets(profile.targets, training, { useActive: profile.useActiveKcal ?? true, activeKcal: health?.activeKcal })
  const t = { ...profile.targets, kcal: dt.kcal, carbs_g: dt.carbs_g }
  const sum = entries.reduce(
    (a, e) => ({ kcal: a.kcal + e.kcal, p: a.p + e.protein_g, c: a.c + e.carbs_g, f: a.f + e.fat_g }),
    { kcal: 0, p: 0, c: 0, f: 0 },
  )
  const waterMl = water.reduce((a, w) => a + w.ml, 0)
  const remaining = t.kcal - sum.kcal

  // Publica el resumen del día (lo lee el Atajo para registrarlo en Salud). Solo escribe si cambió.
  useEffect(() => {
    if (daily === undefined && entries.length === 0 && waterMl === 0) return
    const next = { kcal: Math.round(sum.kcal), protein_g: Math.round(sum.p), carbs_g: Math.round(sum.c), fat_g: Math.round(sum.f), water_ml: waterMl }
    const same = daily && (Object.keys(next) as (keyof typeof next)[]).every((k) => daily[k] === next[k])
    if (!same) db.daily.put({ ...(daily ?? {}), date, ...next })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, sum.kcal, sum.p, sum.c, sum.f, waterMl])

  return (
    <div className="pb-6">
      <div className="pt-safe px-5">
        <div className="flex items-center justify-between pt-2">
          <button onClick={() => setDate(shiftDate(date, -1))} className="h-9 w-9 rounded-full grid place-items-center text-muted active:bg-card">‹</button>
          <button onClick={() => setDate(todayISO())} className="text-lg font-semibold capitalize">{dateLabel(date)}</button>
          <div className="flex items-center">
            <button onClick={() => setDate(shiftDate(date, 1))} disabled={date >= todayISO()} className="h-9 w-9 rounded-full grid place-items-center text-muted active:bg-card disabled:opacity-20">›</button>
            <button onClick={() => nav.go({ name: 'settings' })} className="h-9 w-9 rounded-full grid place-items-center text-muted active:bg-card" aria-label="Ajustes">{Icon.gear}</button>
          </div>
        </div>
      </div>

      <div className="mt-4 flex justify-center">
        <Ring value={sum.kcal} max={t.kcal} size={200}>
          <div className={`text-4xl font-bold tabular-nums ${remaining < 0 ? 'text-fat' : ''}`}>{Math.abs(Math.round(remaining))}</div>
          <div className="text-xs text-muted">{remaining < 0 ? 'kcal de más' : 'kcal restantes'}</div>
          <div className="mt-1 text-[11px] text-muted tabular-nums">{Math.round(sum.kcal)} / {t.kcal}</div>
          {dt.dynamic && dt.fromActivity > 0 && <div className="text-[10px] text-accent tabular-nums">+{dt.fromActivity} por actividad</div>}
        </Ring>
      </div>

      <div className="mt-3 flex justify-center">
        <button
          onClick={() => db.daily.put({ ...(daily ?? { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, water_ml: 0 }), date, training: !training })}
          className={training ? 'chip-on text-xs' : 'chip text-xs text-muted'}
        >{training ? 'Día de entreno' : 'Día de descanso'} · toca para cambiar</button>
      </div>

      <div className="mx-5 mt-5 flex gap-4">
        <MacroBar label="Proteína" value={sum.p} max={t.protein_g} color="var(--color-protein)" />
        <MacroBar label="Carbos" value={sum.c} max={t.carbs_g} color="var(--color-carbs)" />
        <MacroBar label="Grasa" value={sum.f} max={t.fat_g} color="var(--color-fat)" />
      </div>

      <button onClick={() => setEditHealth(true)} className="mx-5 mt-5 grid w-[calc(100%-2.5rem)] grid-cols-2 gap-2 text-left">
        <HealthStat label="Pasos" value={health?.steps != null ? health.steps.toLocaleString('es-CO') : '—'} goal={t.steps ? `/ ${(t.steps / 1000).toFixed(t.steps % 1000 ? 1 : 0)}k` : ''} pct={health?.steps != null && t.steps ? health.steps / t.steps : 0} color="var(--color-accent)" />
        <HealthStat label="Sueño" value={health?.sleepH != null ? `${Math.floor(health.sleepH)}h ${String(Math.round((health.sleepH % 1) * 60)).padStart(2, '0')}` : '—'} goal={t.sleepH ? `/ ${t.sleepH} h` : ''} pct={health?.sleepH != null && t.sleepH ? health.sleepH / t.sleepH : 0} color="var(--color-protein)" />
        <HealthStat label="Calorías activas" value={health?.activeKcal != null ? `${Math.round(health.activeKcal)} kcal` : '—'} goal="" pct={0} color="var(--color-fat)" />
        <HealthStat label="Peso" value={health?.weightKg != null ? `${health.weightKg} kg` : '—'} goal="" pct={0} color="var(--color-carbs)" />
      </button>
      {(health?.exerciseMin || health?.runKm || health?.bikeKm || health?.swimM) ? (
        <div className="mx-5 mt-3 grid grid-cols-4 gap-2 text-center">
          <Mini label="Ejercicio" value={health?.exerciseMin ? `${health.exerciseMin} min` : '—'} />
          <Mini label="Correr" value={health?.runKm ? `${health.runKm.toLocaleString('es-CO')} km` : '—'} />
          <Mini label="Bici" value={health?.bikeKm ? `${health.bikeKm.toLocaleString('es-CO')} km` : '—'} />
          <Mini label="Natación" value={health?.swimM ? `${health.swimM.toLocaleString('es-CO')} m` : '—'} />
        </div>
      ) : null}
      {workouts.length > 0 && (
        <div className="mx-5 mt-3 rounded-2xl border border-line bg-card p-4">
          <div className="text-sm text-muted">Entrenamientos</div>
          <ul className="mt-2 space-y-2">
            {workouts.map((w, i) => (
              <li key={i} className="flex items-center justify-between text-sm">
                <span className="font-medium">{w.type}</span>
                <span className="text-muted tabular-nums">
                  {[w.minutes ? `${w.minutes} min` : null, w.km ? `${w.km} km` : null, w.kcal ? `${w.kcal} kcal` : null].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mx-5 mt-2 flex items-center justify-between text-[11px] text-muted">
        <span>{health?.updatedAt ? `Salud: ${new Date(health.updatedAt).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })}` : 'Sin datos de Salud hoy'}</span>
        <button
          onClick={() => { window.location.href = `shortcuts://run-shortcut?name=${encodeURIComponent(localStorage.getItem('nutri-shortcut-name') || 'Nutrí')}` }}
          className="chip px-2.5 py-1 text-[11px]"
        >Actualizar desde Salud</button>
      </div>
      {health?.sleepH != null && t.sleepH && health.sleepH < t.sleepH - 1 && (
        <p className="mx-5 mt-2 rounded-xl bg-carbs/10 px-3 py-2 text-xs text-carbs">Dormiste poco: es normal tener más hambre hoy. Prioriza proteína y verduras para llenarte sin pasarte.</p>
      )}

      <div className="mx-5 mt-3 rounded-2xl border border-line bg-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-muted">Agua</div>
            <div className="text-xl font-semibold tabular-nums">{(waterMl / 1000).toFixed(2)} <span className="text-sm text-muted">/ {t.water_ml / 1000} L</span></div>
          </div>
          <div className="flex gap-2">
            {waterMl > 0 && (
              <button
                onClick={async () => { const last = water[water.length - 1]; if (last?.id) await db.water.delete(last.id) }}
                className="chip"
              >−</button>
            )}
            <button onClick={() => db.water.add({ date, ml: 250, createdAt: Date.now() })} className="chip">+250 ml</button>
            <button onClick={() => db.water.add({ date, ml: 500, createdAt: Date.now() })} className="chip">+500</button>
          </div>
        </div>
        <div className="mt-3 h-1.5 rounded-full bg-line overflow-hidden">
          <div className="h-full bg-protein" style={{ width: `${Math.min(100, (waterMl / t.water_ml) * 100)}%`, transition: 'width 500ms' }} />
        </div>
      </div>

      <div className="mt-5 space-y-3 px-5">
        {MEALS.map((m) => {
          const list = entries.filter((e) => e.meal === m)
          const kcal = list.reduce((a, e) => a + e.kcal, 0)
          return (
            <div key={m} className="rounded-2xl border border-line bg-card">
              <div className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="font-semibold">{MEAL_LABEL[m]}</div>
                  <div className="text-xs text-muted tabular-nums">{Math.round(kcal)} kcal</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { nav.setMeal(m); nav.go({ name: 'add' }) }} className="h-9 w-9 rounded-full grid place-items-center bg-bg text-muted active:scale-95" aria-label="Buscar alimento">{Icon.search}</button>
                  <button onClick={() => { nav.setMeal(m); nav.go({ name: 'scan', mode: 'plate' }) }} className="h-9 w-9 rounded-full grid place-items-center bg-accent/15 text-accent active:scale-95" aria-label="Escanear">{Icon.plus}</button>
                </div>
              </div>
              {list.length > 0 && (
                <ul className="border-t border-line">
                  {list.map((e) => (
                    <li key={e.id}>
                      <button onClick={() => setEditing(e)} className="flex w-full items-center justify-between px-4 py-2.5 text-left active:bg-bg">
                        <div className="min-w-0">
                          <div className="truncate text-sm">{e.name}</div>
                          <div className="text-xs text-muted tabular-nums">{e.portion ? `${(e.grams / 100).toLocaleString('es-CO')} porción` : `${Math.round(e.grams)} g`} · P {Math.round(e.protein_g)} · C {Math.round(e.carbs_g)} · G {Math.round(e.fat_g)}</div>
                        </div>
                        <div className="ml-3 shrink-0 text-sm tabular-nums">{Math.round(e.kcal)}</div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>

      {editing && <EditEntry entry={editing} onClose={() => setEditing(null)} />}
      {editHealth && <EditHealth date={date} health={health} onClose={() => setEditHealth(false)} />}
    </div>
  )
}

function EditEntry({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const [grams, setGrams] = useState(entry.grams)
  const [meal, setMeal] = useState<Meal>(entry.meal)
  const f = entry.grams > 0 ? grams / entry.grams : 1
  const scaled = {
    kcal: Math.round(entry.kcal * f),
    protein_g: +(entry.protein_g * f).toFixed(1),
    carbs_g: +(entry.carbs_g * f).toFixed(1),
    fat_g: +(entry.fat_g * f).toFixed(1),
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose}>
      <div className="pb-safe mx-auto w-full max-w-md rounded-t-3xl border-t border-line bg-card p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />
        <h3 className="text-lg font-semibold">{entry.name}</h3>
        <p className="text-sm text-muted tabular-nums">{scaled.kcal} kcal · P {scaled.protein_g} · C {scaled.carbs_g} · G {scaled.fat_g}</p>
        <div className="mt-4 flex items-center gap-3">
          {entry.portion ? (
            <>
              <button onClick={() => setGrams((g) => Math.max(25, g - 25))} className="chip">−¼</button>
              <div className="field text-center tabular-nums">{(grams / 100).toLocaleString('es-CO')} porción</div>
              <button onClick={() => setGrams((g) => g + 25)} className="chip">+¼</button>
            </>
          ) : (
            <>
              <button onClick={() => setGrams((g) => Math.max(1, g - 10))} className="chip">−10</button>
              <input type="number" inputMode="decimal" value={grams} onChange={(e) => setGrams(+e.target.value)} className="field text-center tabular-nums" />
              <span className="text-muted">g</span>
              <button onClick={() => setGrams((g) => g + 10)} className="chip">+10</button>
            </>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {(Object.keys(MEAL_LABEL) as Meal[]).map((m) => (
            <button key={m} onClick={() => setMeal(m)} className={meal === m ? 'chip-on' : 'chip'}>{MEAL_LABEL[m]}</button>
          ))}
        </div>
        <div className="mt-5 flex gap-2">
          <button onClick={async () => { await db.entries.delete(entry.id!); onClose() }} className="btn-ghost text-fat">{Icon.trash}</button>
          <button onClick={async () => { await db.entries.update(entry.id!, { grams, meal, ...scaled }); onClose() }} className="btn-primary flex-1">Guardar</button>
        </div>
      </div>
    </div>
  )
}

function HealthStat({ label, value, goal, pct, color }: { label: string; value: string; goal: string; pct: number; color: string }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 truncate text-base font-semibold tabular-nums">{value}<span className="ml-1 text-[11px] font-normal text-muted">{goal}</span></div>
      <div className="mt-2 h-1 rounded-full bg-line overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct * 100)}%`, background: color }} />
      </div>
    </div>
  )
}

function EditHealth({ date, health, onClose }: { date: string; health?: Health; onClose: () => void }) {
  const [steps, setSteps] = useState<string>(health?.steps?.toString() ?? '')
  const [sleep, setSleep] = useState<string>(health?.sleepH?.toString() ?? '')
  const [weight, setWeight] = useState<string>(health?.weightKg?.toString() ?? '')
  const num = (v: string) => (v.trim() === '' ? undefined : +v.replace(',', '.'))
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose}>
      <div className="pb-safe mx-auto w-full max-w-md rounded-t-3xl border-t border-line bg-card p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" />
        <h3 className="text-lg font-semibold">Datos del día</h3>
        <p className="text-sm text-muted">Llegan solos desde Salud con el Atajo; aquí puedes corregirlos.</p>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <label className="text-xs text-muted">Pasos<input type="number" inputMode="numeric" value={steps} onChange={(e) => setSteps(e.target.value)} className="field mt-1" /></label>
          <label className="text-xs text-muted">Sueño (h)<input type="number" inputMode="decimal" step={0.25} value={sleep} onChange={(e) => setSleep(e.target.value)} className="field mt-1" /></label>
          <label className="text-xs text-muted">Peso (kg)<input type="number" inputMode="decimal" step={0.1} value={weight} onChange={(e) => setWeight(e.target.value)} className="field mt-1" /></label>
        </div>
        <button
          onClick={async () => {
            await db.health.put({ ...(health ?? {}), date, steps: num(steps), sleepH: num(sleep), weightKg: num(weight), source: 'manual' })
            onClose()
          }}
          className="btn-primary mt-5 w-full"
        >Guardar</button>
      </div>
    </div>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-card px-1 py-2">
      <div className="text-[10px] text-muted">{label}</div>
      <div className="truncate text-xs font-semibold tabular-nums">{value}</div>
    </div>
  )
}
