import { useMemo, useState } from 'react'
import { db, type Activity, type Goal, type Profile, type Sex } from '../lib/db'
import { ACTIVITY, GOALS, computeTargets } from '../lib/nutrition'

const DAYS = ['D', 'L', 'M', 'X', 'J', 'V', 'S']

export default function Onboarding({ existing, onDone }: { existing?: Profile; onDone: () => void }) {
  const [sex, setSex] = useState<Sex>(existing?.sex ?? 'male')
  const [birthYear, setBirthYear] = useState(existing?.birthYear ?? 1999)
  const [heightCm, setHeight] = useState(existing?.heightCm ?? 175)
  const [weightKg, setWeight] = useState(existing?.weightKg ?? 75)
  const [activity, setActivity] = useState<Activity>(existing?.activity ?? 'active')
  const [goal, setGoal] = useState<Goal>(existing?.goal ?? 'cut')
  const [rate, setRate] = useState(existing?.ratePctWeek ?? GOALS[existing?.goal ?? 'cut'].rate?.def ?? 0)
  const [trainingDays, setTrainingDays] = useState<number[]>(existing?.trainingDays ?? [1, 2, 3, 4, 5])
  const [carbCycling, setCarbCycling] = useState(existing?.carbCycling ?? true)
  const [stepsTarget, setSteps] = useState(existing?.stepsTarget ?? GOALS[existing?.goal ?? 'cut'].steps)
  const [sleepTarget, setSleep] = useState(existing?.sleepTarget ?? 7.5)
  const [targetWeight, setTargetWeight] = useState<number>(existing?.targetWeightKg ?? 0)

  const g = GOALS[goal]
  const age = new Date().getFullYear() - birthYear
  const targets = useMemo(
    () => computeTargets({ sex, age, heightCm, weightKg, activity, goal, ratePctWeek: rate, trainingDays, carbCycling, stepsTarget, sleepTarget }),
    [sex, age, heightCm, weightKg, activity, goal, rate, trainingDays, carbCycling, stepsTarget, sleepTarget],
  )

  function pickGoal(x: Goal) {
    setGoal(x)
    setRate(GOALS[x].rate?.def ?? 0)
    setSteps(GOALS[x].steps)
  }

  async function save() {
    await db.profile.put({
      id: 'me', sex, birthYear, heightCm, weightKg, activity, goal,
      ratePctWeek: g.rate ? rate : 0, trainingDays, carbCycling, stepsTarget, sleepTarget, targets,
      targetWeightKg: targetWeight > 0 ? targetWeight : undefined,
    })
    // El peso del perfil también queda en el historial de hoy (para Progreso).
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
    const h = await db.health.get(today)
    if (h?.weightKg !== weightKg) await db.health.put({ ...(h ?? {}), date: today, weightKg, source: h?.source ?? 'manual' })
    onDone()
  }

  return (
    <div className="mx-auto max-w-md px-5 pt-safe pb-safe">
      <h1 className="mt-6 text-3xl font-bold tracking-tight">{existing ? 'Tu plan' : 'Hola'}</h1>
      <p className="mt-1 text-muted">{existing ? 'Ajusta tus datos y se recalculan tus metas.' : 'Unos datos para calcular tus calorías y macros.'}</p>

      <Section title="Sexo">
        <div className="flex gap-2">
          {(['male', 'female'] as Sex[]).map((s) => (
            <button key={s} onClick={() => setSex(s)} className={sex === s ? 'chip-on' : 'chip'}>{s === 'male' ? 'Hombre' : 'Mujer'}</button>
          ))}
        </div>
      </Section>

      <div className="grid grid-cols-3 gap-3">
        <NumField label="Año nac." value={birthYear} onChange={setBirthYear} />
        <NumField label="Estatura (cm)" value={heightCm} onChange={setHeight} />
        <NumField label="Peso (kg)" value={weightKg} onChange={setWeight} step={0.1} />
      </div>

      <Section title="Objetivo">
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(GOALS) as Goal[]).map((x) => (
            <button key={x} onClick={() => pickGoal(x)} className={`rounded-xl border p-3 text-left ${goal === x ? 'border-accent bg-accent/10' : 'border-line bg-card'}`}>
              <div className="font-medium">{GOALS[x].label}</div>
              <div className="text-xs text-muted">{GOALS[x].hint}</div>
            </button>
          ))}
        </div>
        {g.rate && (
          <div className="mt-4">
            <div className="flex justify-between text-sm">
              <span className="text-muted">Ritmo</span>
              <b className="tabular-nums">{rate > 0 ? '+' : ''}{rate.toFixed(2)} % / semana · {targets.kgWeek! > 0 ? '+' : ''}{targets.kgWeek} kg</b>
            </div>
            <input type="range" min={g.rate.min} max={g.rate.max} step={0.05} value={rate} onChange={(e) => setRate(+e.target.value)} className="mt-2 w-full" />
            <p className="mt-1 text-xs text-muted">
              {goal === 'cut' ? 'Entre 0,5 % y 0,75 % por semana protege mejor el músculo.' : 'Entre 0,25 % y 0,5 % por semana limita la ganancia de grasa.'}
            </p>
          </div>
        )}
      </Section>

      <Section title="Actividad (sin contar los pasos)">
        <div className="space-y-2">
          {(Object.keys(ACTIVITY) as Activity[]).map((a) => (
            <button key={a} onClick={() => setActivity(a)} className={`w-full rounded-xl border p-3 text-left ${activity === a ? 'border-accent bg-accent/10' : 'border-line bg-card'}`}>
              <div className="font-medium">{ACTIVITY[a].label}</div>
              <div className="text-xs text-muted">{ACTIVITY[a].hint}</div>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Días de entreno">
        <div className="flex justify-between">
          {DAYS.map((d, i) => {
            const on = trainingDays.includes(i)
            return (
              <button key={i} onClick={() => setTrainingDays(on ? trainingDays.filter((x) => x !== i) : [...trainingDays, i].sort())}
                className={`h-10 w-10 rounded-full text-sm font-medium ${on ? 'bg-accent text-black' : 'bg-card text-muted border border-line'}`}>{d}</button>
            )
          })}
        </div>
        <label className="mt-3 flex items-center justify-between rounded-xl border border-line bg-card p-3">
          <span>
            <span className="block font-medium">Ciclar carbohidratos</span>
            <span className="block text-xs text-muted">Más carbos los días de entreno, menos en descanso; mismo total semanal.</span>
          </span>
          <input type="checkbox" checked={carbCycling} onChange={(e) => setCarbCycling(e.target.checked)} className="h-5 w-5 accent-[var(--color-accent)]" />
        </label>
      </Section>

      {goal !== 'maintain' && goal !== 'recomp' && (
        <NumField label="Peso objetivo (kg) — para la proyección" value={targetWeight} onChange={setTargetWeight} step={0.5} />
      )}
      <div className="grid grid-cols-2 gap-3">
        <NumField label="Pasos diarios" value={stepsTarget} onChange={setSteps} step={500} />
        <NumField label="Sueño (horas)" value={sleepTarget} onChange={setSleep} step={0.5} />
      </div>

      <div className="mt-6 rounded-2xl border border-line bg-card p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-muted text-sm">Meta diaria promedio</span>
          <span className="text-3xl font-bold tabular-nums text-accent">{targets.kcal} <span className="text-base text-muted">kcal</span></span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
          <Stat label="Proteína" value={`${targets.protein_g} g`} color="var(--color-protein)" />
          <Stat label="Carbos" value={`${targets.carbs_g} g`} color="var(--color-carbs)" />
          <Stat label="Grasa" value={`${targets.fat_g} g`} color="var(--color-fat)" />
        </div>
        {carbCycling && targets.kcalTrain !== targets.kcalRest && (
          <p className="mt-3 text-xs text-muted tabular-nums">Entreno: {targets.kcalTrain} kcal · {targets.carbsTrain} g carbos — Descanso: {targets.kcalRest} kcal · {targets.carbsRest} g carbos</p>
        )}
        <p className="mt-2 text-xs text-muted">TMB {targets.bmr} kcal · Gasto total {targets.tdee} kcal · Agua {targets.water_ml / 1000} L</p>
      </div>

      <button onClick={save} className="btn-primary mt-6 w-full">{existing ? 'Guardar' : 'Empezar'}</button>
      {existing && <button onClick={onDone} className="btn-ghost mt-2 w-full">Cancelar</button>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <h2 className="mb-2 text-sm font-medium text-muted">{title}</h2>
      {children}
    </div>
  )
}

function NumField({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (n: number) => void; step?: number }) {
  return (
    <label className="mt-6 block">
      <span className="mb-2 block text-sm text-muted">{label}</span>
      <input type="number" inputMode="decimal" step={step} value={value || ''} onChange={(e) => onChange(+e.target.value)} className="field tabular-nums" />
    </label>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl bg-bg py-2">
      <div className="font-semibold" style={{ color }}>{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  )
}
