import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Nav } from '../App'
import { db, MEAL_LABEL, mealForNow, shiftDate, todayISO, type Meal, type Profile } from '../lib/db'
import { generateCoachPlan, type CoachMeal, type CoachPlan, type CoachPrefs, type CoachSession } from '../lib/gemini'
import { GOALS, targetsForDay } from '../lib/nutrition'
import { daysBetween } from '../lib/progress'
import { AiSpinner, ErrorBox } from '../ui'

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const DAY_SHORT = ['D', 'L', 'M', 'X', 'J', 'V', 'S']
const ORDER = [1, 2, 3, 4, 5, 6, 0] // la semana empieza el lunes
const SPORTS = ['Gimnasio (fuerza)', 'Correr', 'Bicicleta', 'Natación', 'Triatlón', 'Fútbol', 'Funcional/Crossfit', 'Yoga/Movilidad']
const TYPE_COLOR: Record<string, string> = {
  fuerza: 'var(--color-protein)', correr: 'var(--color-accent)', bici: 'var(--color-carbs)', natacion: '#6ae0f3',
  brick: 'var(--color-fat)', movilidad: '#c49cf3', descanso: 'var(--color-muted)', otro: 'var(--color-muted)',
}

/** Lunes de la semana de una fecha ISO. */
function mondayOf(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  const wd = new Date(y, m - 1, d).getDay()
  return shiftDate(iso, -((wd + 6) % 7))
}

interface StoredPlan { id: 'plan'; plan: CoachPlan; startDate: string; createdAt: number; model: string }

export default function Coach({ nav, profile }: { nav: Nav; profile: Profile }) {
  const prefs = useLiveQuery(() => db.coach.get('prefs'), []) as (CoachPrefs & { id: string }) | undefined
  const stored = useLiveQuery(() => db.coach.get('plan'), []) as StoredPlan | undefined
  const [editing, setEditing] = useState(false)
  const [tab, setTab] = useState<'train' | 'food'>('train')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate(p: CoachPrefs) {
    setBusy(true); setError(null)
    try {
      await db.coach.put({ id: 'prefs', ...p })
      const t = profile.targets
      const context = {
        sexo: profile.sex === 'male' ? 'hombre' : 'mujer',
        edad: new Date().getFullYear() - profile.birthYear,
        estatura_cm: profile.heightCm,
        peso_kg: profile.weightKg,
        peso_objetivo_kg: profile.targetWeightKg ?? null,
        objetivo: GOALS[profile.goal].label,
        ritmo_kg_semana: t.kgWeek ?? 0,
        metas_dia_entreno: { kcal: t.kcalTrain ?? t.kcal, proteina_g: t.protein_g, carbohidratos_g: t.carbsTrain ?? t.carbs_g, grasa_g: t.fat_g },
        metas_dia_descanso: { kcal: t.kcalRest ?? t.kcal, proteina_g: t.protein_g, carbohidratos_g: t.carbsRest ?? t.carbs_g, grasa_g: t.fat_g },
        pasos_diarios_meta: t.steps,
        deportes: p.sports,
        dias_disponibles: p.days.map((d) => `${d} (${DAY_NAMES[d]})`),
        minutos_por_sesion: p.minutes,
        nivel: p.level,
        lugar: p.place,
        lesiones_o_limitaciones: p.injuries || 'ninguna',
        comidas_al_dia: p.mealsPerDay,
        alimentos_que_no_come: p.avoidFoods || 'ninguno',
        notas: p.notes,
        pais: 'Colombia',
      }
      const { plan, model } = await generateCoachPlan(context)
      await db.coach.put({ id: 'plan', plan, startDate: mondayOf(todayISO()), createdAt: Date.now(), model } as any)
      setEditing(false)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const showForm = editing || !stored
  return (
    <div className="pb-6">
      <div className="pt-safe px-5">
        <div className="flex items-center justify-between pt-2">
          <h1 className="text-2xl font-bold tracking-tight">Coach</h1>
          {stored && !showForm && <button onClick={() => setEditing(true)} className="chip text-xs">Ajustar plan</button>}
        </div>
        {!showForm && (
          <div className="mt-3 flex gap-1">
            <button onClick={() => setTab('train')} className={`flex-1 rounded-xl py-2 text-sm font-medium ${tab === 'train' ? 'bg-accent text-black' : 'bg-card text-muted'}`}>Entrenamiento</button>
            <button onClick={() => setTab('food')} className={`flex-1 rounded-xl py-2 text-sm font-medium ${tab === 'food' ? 'bg-accent text-black' : 'bg-card text-muted'}`}>Nutrición</button>
          </div>
        )}
      </div>

      {busy ? (
        <div className="px-5"><AiSpinner label="Diseñando tu plan de 4 semanas… (puede tardar hasta un minuto)" /></div>
      ) : showForm ? (
        <div className="px-5">
          {error && <div className="mt-3"><ErrorBox message={error} /></div>}
          <PrefsForm profile={profile} initial={prefs} onSubmit={generate} onCancel={stored ? () => setEditing(false) : undefined} />
        </div>
      ) : tab === 'train' ? (
        <TrainingView stored={stored!} />
      ) : (
        <NutritionView stored={stored!} profile={profile} nav={nav} />
      )}
    </div>
  )
}

// ---------- Preferencias ----------

function PrefsForm({ profile, initial, onSubmit, onCancel }: { profile: Profile; initial?: CoachPrefs; onSubmit: (p: CoachPrefs) => void; onCancel?: () => void }) {
  const [sports, setSports] = useState<string[]>(initial?.sports ?? ['Gimnasio (fuerza)'])
  const [days, setDays] = useState<number[]>(initial?.days ?? profile.trainingDays ?? [1, 2, 3, 4, 5])
  const [minutes, setMinutes] = useState(initial?.minutes ?? 60)
  const [level, setLevel] = useState<CoachPrefs['level']>(initial?.level ?? 'intermedio')
  const [place, setPlace] = useState<CoachPrefs['place']>(initial?.place ?? 'gimnasio')
  const [injuries, setInjuries] = useState(initial?.injuries ?? '')
  const [mealsPerDay, setMeals] = useState(initial?.mealsPerDay ?? 4)
  const [avoidFoods, setAvoid] = useState(initial?.avoidFoods ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v])

  return (
    <div className="space-y-5 pt-4">
      <p className="text-sm text-muted">
        Tu objetivo: <b className="text-white">{GOALS[profile.goal].label}</b> · {profile.targets.kcal} kcal promedio
        {profile.targetWeightKg ? ` · meta ${profile.targetWeightKg} kg` : ''}. El coach arma 4 semanas de entreno y tu plan de comidas con esas metas.
      </p>

      <Field title="¿Qué entrenas?">
        <div className="flex flex-wrap gap-2">
          {SPORTS.map((s) => <button key={s} onClick={() => setSports(toggle(sports, s))} className={sports.includes(s) ? 'chip-on' : 'chip'}>{s}</button>)}
        </div>
      </Field>

      <Field title="Días disponibles">
        <div className="flex justify-between">
          {ORDER.map((d) => (
            <button key={d} onClick={() => setDays(toggle(days, d).sort())}
              className={`h-10 w-10 rounded-full text-sm font-medium ${days.includes(d) ? 'bg-accent text-black' : 'border border-line bg-card text-muted'}`}>{DAY_SHORT[d]}</button>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field title="Minutos por sesión">
          <input type="number" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(+e.target.value)} className="field" />
        </Field>
        <Field title="Comidas al día">
          <input type="number" inputMode="numeric" min={3} max={6} value={mealsPerDay} onChange={(e) => setMeals(+e.target.value)} className="field" />
        </Field>
      </div>

      <Field title="Nivel">
        <div className="flex gap-2">
          {(['principiante', 'intermedio', 'avanzado'] as const).map((l) => <button key={l} onClick={() => setLevel(l)} className={level === l ? 'chip-on' : 'chip'}>{l[0].toUpperCase() + l.slice(1)}</button>)}
        </div>
      </Field>

      <Field title="¿Dónde entrenas la fuerza?">
        <div className="flex gap-2">
          {(['gimnasio', 'casa', 'mixto'] as const).map((l) => <button key={l} onClick={() => setPlace(l)} className={place === l ? 'chip-on' : 'chip'}>{l[0].toUpperCase() + l.slice(1)}</button>)}
        </div>
      </Field>

      <Field title="Lesiones o molestias (opcional)">
        <input value={injuries} onChange={(e) => setInjuries(e.target.value)} placeholder="Ej.: molestia en rodilla derecha" className="field" />
      </Field>
      <Field title="Alimentos que no comes (opcional)">
        <input value={avoidFoods} onChange={(e) => setAvoid(e.target.value)} placeholder="Ej.: atún, leche entera" className="field" />
      </Field>
      <Field title="Notas para el coach (opcional)">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="field resize-none"
          placeholder="Ej.: entreno con mi equipo de triatlón martes y jueves a las 5 a. m.; tengo una carrera de 10 km en enero" />
      </Field>

      <button disabled={!days.length || !sports.length} onClick={() => onSubmit({ sports, days, minutes, level, place, injuries, mealsPerDay, avoidFoods, notes })} className="btn-primary w-full">
        Generar mi plan
      </button>
      {onCancel && <button onClick={onCancel} className="btn-ghost w-full">Cancelar</button>}
      <p className="text-center text-[11px] text-muted">Guía general generada con IA; no reemplaza a un profesional de la salud.</p>
    </div>
  )
}

function Field({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-medium text-muted">{title}</h2>
      {children}
    </div>
  )
}

// ---------- Entrenamiento ----------

function TrainingView({ stored }: { stored: StoredPlan }) {
  const today = todayISO()
  const weeksCount = stored.plan.weeks.length
  const elapsed = Math.max(0, daysBetween(stored.startDate, today))
  const currentWeek = (Math.floor(elapsed / 7) % weeksCount) + 1
  const cycle = Math.floor(elapsed / 7 / weeksCount) + 1
  const [week, setWeek] = useState(currentWeek)
  const [open, setOpen] = useState<number | null>(new Date().getDay())
  const done = useLiveQuery(() => db.coach.where('id').startsWith('done:').toArray(), []) ?? []
  const doneSet = new Set(done.map((d) => d.id))

  const w = stored.plan.weeks.find((x) => x.week === week) ?? stored.plan.weeks[week - 1]
  // Fecha real de cada día en la semana mostrada (solo tiene sentido para la semana actual).
  const monday = shiftDate(mondayOf(today), (week - currentWeek) * 7)
  const dateOf = (day: number) => shiftDate(monday, (day + 6) % 7)

  return (
    <div className="px-5 pt-4">
      <p className="text-sm text-muted">{stored.plan.summary}</p>
      <div className="mt-3 flex gap-1">
        {stored.plan.weeks.map((x) => (
          <button key={x.week} onClick={() => setWeek(x.week)}
            className={`flex-1 rounded-xl py-1.5 text-xs font-medium ${week === x.week ? 'bg-white text-black' : 'bg-card text-muted'} ${x.week === currentWeek ? 'ring-1 ring-accent' : ''}`}>
            Sem {x.week}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">{w?.theme}{week === currentWeek ? ` · semana actual${cycle > 1 ? ` (ciclo ${cycle})` : ''}` : ''}</p>

      <ul className="mt-3 space-y-2">
        {ORDER.map((d) => {
          const s = w?.sessions.find((x) => x.day === d)
          if (!s) return null
          const date = dateOf(d)
          const isToday = date === today
          const isDone = doneSet.has(`done:${date}`)
          return (
            <li key={d} className={`rounded-2xl border bg-card ${isToday ? 'border-accent/60' : 'border-line'}`}>
              <button onClick={() => setOpen(open === d ? null : d)} className="flex w-full items-center gap-3 p-3 text-left">
                <span className="h-10 w-1 rounded-full" style={{ background: TYPE_COLOR[s.type] ?? 'var(--color-muted)' }} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-muted">{DAY_NAMES[d]}{isToday ? ' · hoy' : ''}</div>
                  <div className="truncate font-medium">{s.title}</div>
                  <div className="text-xs text-muted">{s.type === 'descanso' ? 'Descanso' : `${s.duration_min} min · ${s.intensity}`}</div>
                </div>
                {isDone && <span className="chip-on text-xs">Hecho</span>}
              </button>
              {open === d && s.type !== 'descanso' && <SessionDetail s={s} date={date} done={isDone} />}
            </li>
          )
        })}
      </ul>
      <p className="mt-4 text-xs text-muted">{stored.plan.progression}</p>
    </div>
  )
}

function SessionDetail({ s, date, done }: { s: CoachSession; date: string; done: boolean }) {
  return (
    <div className="border-t border-line p-3 text-sm">
      {s.focus && <p className="text-muted">{s.focus}</p>}
      {s.warmup && <p className="mt-2"><b>Calentamiento:</b> <span className="text-muted">{s.warmup}</span></p>}
      {s.exercises.length > 0 && (
        <table className="mt-2 w-full text-left">
          <tbody>
            {s.exercises.map((e, i) => (
              <tr key={i} className="border-t border-line/60 align-top">
                <td className="py-1.5 pr-2">
                  <div>{e.name}</div>
                  {e.notes && <div className="text-xs text-muted">{e.notes}</div>}
                </td>
                <td className="whitespace-nowrap py-1.5 text-right tabular-nums text-muted">
                  {e.sets ? `${e.sets}×${e.reps ?? ''}` : ''}{e.rest_s ? <div className="text-[11px]">{e.rest_s}s desc.</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {s.cooldown && <p className="mt-2"><b>Vuelta a la calma:</b> <span className="text-muted">{s.cooldown}</span></p>}
      <button
        onClick={() => (done ? db.coach.delete(`done:${date}`) : db.coach.put({ id: `done:${date}`, title: s.title, type: s.type }))}
        className={`${done ? 'btn-ghost' : 'btn-primary'} mt-3 w-full py-2.5`}
      >{done ? 'Marcar como no hecho' : 'Marcar como hecho'}</button>
    </div>
  )
}

// ---------- Nutrición ----------

function NutritionView({ stored, profile, nav }: { stored: StoredPlan; profile: Profile; nav: Nav }) {
  const today = todayISO()
  const daily = useLiveQuery(() => db.daily.get(today), [today])
  const health = useLiveQuery(() => db.health.get(today), [today])
  const isTrainingToday = daily?.training ?? ((health?.workouts?.length ?? 0) > 0 || (profile.trainingDays ?? []).includes(new Date().getDay()))
  const [training, setTraining] = useState<boolean>(isTrainingToday)
  const [logged, setLogged] = useState<string | null>(null)
  const meals: CoachMeal[] = training ? stored.plan.nutrition.training_day : stored.plan.nutrition.rest_day
  const t = targetsForDay(profile.targets, training)

  async function log(meal: CoachMeal, i: number) {
    const o = meal.options[i]
    const mealType: Meal = guessMeal(meal) ?? mealForNow()
    await db.entries.add({
      date: nav.date, meal: mealType, name: o.description, grams: 100, portion: true,
      kcal: Math.round(o.kcal), protein_g: o.protein_g, carbs_g: o.carbs_g, fat_g: o.fat_g,
      source: 'manual', createdAt: Date.now(),
    })
    setLogged(`${meal.name}-${i}`)
    setTimeout(() => setLogged(null), 2000)
  }

  return (
    <div className="px-5 pt-4">
      <div className="flex gap-2">
        <button onClick={() => setTraining(true)} className={training ? 'chip-on' : 'chip'}>Día de entreno</button>
        <button onClick={() => setTraining(false)} className={!training ? 'chip-on' : 'chip'}>Día de descanso</button>
      </div>
      <p className="mt-2 text-xs text-muted tabular-nums">Meta: {t.kcal} kcal · P {profile.targets.protein_g} g · C {t.carbs_g} g · G {profile.targets.fat_g} g</p>

      <ul className="mt-3 space-y-3">
        {meals.map((m) => (
          <li key={m.name} className="rounded-2xl border border-line bg-card p-3">
            <div className="flex items-baseline justify-between">
              <span className="font-semibold">{m.name}</span>
              <span className="text-xs text-muted">{m.time}</span>
            </div>
            <div className="mt-2 space-y-2">
              {m.options.map((o, i) => (
                <div key={i} className="rounded-xl bg-bg p-2.5">
                  <p className="text-sm">{o.description}</p>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-xs text-muted tabular-nums">{Math.round(o.kcal)} kcal · P {Math.round(o.protein_g)} · C {Math.round(o.carbs_g)} · G {Math.round(o.fat_g)}</span>
                    <button onClick={() => log(m, i)} className={logged === `${m.name}-${i}` ? 'chip-on text-xs' : 'chip text-xs'}>
                      {logged === `${m.name}-${i}` ? 'Registrado' : 'Registrar'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>

      {stored.plan.nutrition.tips.length > 0 && (
        <div className="mt-4 rounded-2xl border border-line bg-card p-3 text-sm">
          <div className="font-semibold">Tips</div>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">
            {stored.plan.nutrition.tips.map((tip, i) => <li key={i}>{tip}</li>)}
          </ul>
        </div>
      )}
      <p className="mt-3 text-[11px] text-muted">"Registrar" anota la opción en tu día ({MEAL_LABEL[mealForNow()].toLowerCase()} si no se reconoce la comida). Puedes ajustarla después tocándola en Hoy.</p>
    </div>
  )
}

function guessMeal(m: CoachMeal): Meal | null {
  const n = m.name.toLowerCase()
  if (/desayuno/.test(n)) return 'breakfast'
  if (/almuerzo/.test(n)) return 'lunch'
  if (/cena|comida de la noche/.test(n)) return 'dinner'
  if (/merienda|snack|media|onces|pre|post/.test(n)) return 'snack'
  return null
}
