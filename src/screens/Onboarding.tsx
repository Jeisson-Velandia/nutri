import { useMemo, useState } from 'react'
import { db, type Activity, type Goal, type Profile, type Sex } from '../lib/db'
import { ACTIVITY, GOAL, computeTargets } from '../lib/nutrition'

export default function Onboarding({ existing, onDone }: { existing?: Profile; onDone: () => void }) {
  const [sex, setSex] = useState<Sex>(existing?.sex ?? 'male')
  const [birthYear, setBirthYear] = useState(existing?.birthYear ?? 1999)
  const [heightCm, setHeight] = useState(existing?.heightCm ?? 175)
  const [weightKg, setWeight] = useState(existing?.weightKg ?? 75)
  const [activity, setActivity] = useState<Activity>(existing?.activity ?? 'active')
  const [goal, setGoal] = useState<Goal>(existing?.goal ?? 'maintain')
  const [rate, setRate] = useState(Math.abs(existing?.rateKgWeek ?? 0.5))

  const age = new Date().getFullYear() - birthYear
  const targets = useMemo(
    () => computeTargets({ sex, age, heightCm, weightKg, activity, goal, rateKgWeek: rate }),
    [sex, age, heightCm, weightKg, activity, goal, rate],
  )

  async function save() {
    await db.profile.put({
      id: 'me', sex, birthYear, heightCm, weightKg, activity, goal,
      rateKgWeek: goal === 'lose' ? -rate : goal === 'gain' ? rate : 0,
      targets,
    })
    onDone()
  }

  return (
    <div className="mx-auto max-w-md px-5 pt-safe pb-safe">
      <h1 className="mt-6 text-3xl font-bold tracking-tight">{existing ? 'Tu perfil' : 'Hola 👋'}</h1>
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

      <Section title="Actividad">
        <div className="space-y-2">
          {(Object.keys(ACTIVITY) as Activity[]).map((a) => (
            <button key={a} onClick={() => setActivity(a)} className={`w-full rounded-xl border p-3 text-left ${activity === a ? 'border-accent bg-accent/10' : 'border-line bg-card'}`}>
              <div className="font-medium">{ACTIVITY[a].label}</div>
              <div className="text-xs text-muted">{ACTIVITY[a].hint}</div>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Objetivo">
        <div className="flex gap-2">
          {(Object.keys(GOAL) as Goal[]).map((g) => (
            <button key={g} onClick={() => setGoal(g)} className={goal === g ? 'chip-on' : 'chip'}>{GOAL[g]}</button>
          ))}
        </div>
        {goal !== 'maintain' && (
          <div className="mt-4">
            <div className="flex justify-between text-sm"><span className="text-muted">Ritmo</span><b>{rate.toFixed(2)} kg/semana</b></div>
            <input type="range" min={0.1} max={1} step={0.05} value={rate} onChange={(e) => setRate(+e.target.value)} className="mt-2 w-full" />
          </div>
        )}
      </Section>

      <div className="mt-6 rounded-2xl border border-line bg-card p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-muted text-sm">Meta diaria</span>
          <span className="text-3xl font-bold tabular-nums text-accent">{targets.kcal} <span className="text-base text-muted">kcal</span></span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
          <Stat label="Proteína" value={`${targets.protein_g} g`} color="var(--color-protein)" />
          <Stat label="Carbos" value={`${targets.carbs_g} g`} color="var(--color-carbs)" />
          <Stat label="Grasa" value={`${targets.fat_g} g`} color="var(--color-fat)" />
        </div>
        <p className="mt-3 text-xs text-muted">TMB {targets.bmr} kcal · Gasto total {targets.tdee} kcal · Agua {targets.water_ml / 1000} L</p>
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
