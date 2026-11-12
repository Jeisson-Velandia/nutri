import { useEffect, useMemo, useState } from 'react'
import type { Nav, ReviewAddition } from '../App'
import { db, macrosFor, MEAL_LABEL, mealForNow, rememberFood, type Meal, type Per100 } from '../lib/db'
import type { AiItem, PlateResult } from '../lib/gemini'
import { ConfidenceDot, Header, Icon } from '../ui'

interface Row {
  key: string
  aiId: string
  name: string
  grams: number
  estGrams: number
  min: number
  max: number
  per100: Per100
  confidence: number
  alternatives: AiItem['alternatives']
  fromQuestion?: string
}

const toRow = (it: AiItem): Row => ({
  key: it.id, aiId: it.id, name: it.display_name, grams: Math.round(it.grams), estGrams: Math.round(it.grams),
  min: Math.round(it.grams_min), max: Math.round(it.grams_max), per100: it.per_100g,
  confidence: it.confidence, alternatives: it.alternatives,
})

export default function Review({ nav, result, scanId, photo, additions, clearAdditions }: {
  nav: Nav; result: PlateResult; scanId: number; photo?: string; additions: ReviewAddition[]; clearAdditions: () => void
}) {
  const [rows, setRows] = useState<Row[]>(() => result.items.map(toRow))

  // Ingredientes agregados desde el buscador.
  useEffect(() => {
    if (!additions.length) return
    setRows((rs) => [
      ...rs,
      ...additions.map((a, i) => ({
        key: `add-${Date.now()}-${i}`, aiId: `user-${i}`, name: a.name, grams: a.grams, estGrams: a.grams,
        min: Math.max(1, Math.round(a.grams / 2)), max: a.grams * 2, per100: a.per100, confidence: 1, alternatives: [],
      })),
    ])
    clearAdditions()
  }, [additions, clearAdditions])
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [open, setOpen] = useState<string | null>(null)
  const [meal, setMeal] = useState<Meal>(
    nav.meal ?? (result.meal_guess !== 'unknown' ? result.meal_guess : mealForNow()),
  )
  const [saving, setSaving] = useState(false)

  // Aplica las respuestas a las preguntas sobre ingredientes ocultos.
  const finalRows = useMemo(() => {
    let out = [...rows]
    for (const q of result.hidden_ingredient_questions) {
      const idx = answers[q.id]
      if (idx == null) continue
      const eff = q.options[idx]?.effect
      if (!eff || eff.type === 'none') continue
      if (eff.type === 'add_item' && eff.name && eff.per_100g) {
        out.push({
          key: `${q.id}-add`, aiId: q.id, name: eff.name, grams: eff.grams ?? 10, estGrams: eff.grams ?? 10,
          min: 1, max: Math.max(50, (eff.grams ?? 10) * 3), per100: eff.per_100g, confidence: 1, alternatives: [], fromQuestion: q.id,
        })
      }
      if (eff.type === 'replace_item' && q.related_item_id && eff.name && eff.per_100g) {
        out = out.map((r) => (r.aiId === q.related_item_id ? { ...r, name: eff.name!, per100: eff.per_100g! } : r))
      }
    }
    return out
  }, [rows, answers, result.hidden_ingredient_questions])

  const totals = finalRows.reduce(
    (a, r) => {
      const m = macrosFor(r.per100, r.grams)
      return { kcal: a.kcal + m.kcal, p: a.p + m.protein_g, c: a.c + m.carbs_g, f: a.f + m.fat_g }
    },
    { kcal: 0, p: 0, c: 0, f: 0 },
  )

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const remove = (key: string) => setRows((rs) => rs.filter((r) => r.key !== key))

  async function save() {
    setSaving(true)
    const now = Date.now()
    for (const r of finalRows) {
      const foodId = await rememberFood({ name: r.name, source: 'ai', per100: r.per100, servingG: r.grams })
      await db.entries.add({
        date: nav.date, meal, name: r.name, grams: r.grams, ...macrosFor(r.per100, r.grams),
        source: photo ? 'photo' : 'text', foodId, scanId, createdAt: now,
      })
    }
    const diff = result.items.map((it) => {
      const r = rows.find((x) => x.aiId === it.id)
      return { name: it.display_name, estG: Math.round(it.grams), finalG: r ? r.grams : null }
    })
    await db.scans.update(scanId, { status: 'saved', diff })
    navigator.vibrate?.(30)
    nav.setMeal(null)
    nav.go({ name: 'today' })
  }

  async function discard() {
    await db.scans.update(scanId, { status: 'discarded' })
    nav.back()
  }

  return (
    <div className="pb-32">
      <Header title="Revisa tu comida" onBack={discard} />

      {photo && <img src={photo} alt="" className="mx-4 mt-3 h-40 w-[calc(100%-2rem)] rounded-2xl object-cover" />}

      <div className="mx-4 mt-3 rounded-2xl border border-line bg-card p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted">Total</span>
          <span className="text-3xl font-bold tabular-nums text-accent">{Math.round(totals.kcal)} <span className="text-base text-muted">kcal</span></span>
        </div>
        <div className="mt-1 flex justify-end gap-3 text-xs tabular-nums">
          <span style={{ color: 'var(--color-protein)' }}>P {Math.round(totals.p)} g</span>
          <span style={{ color: 'var(--color-carbs)' }}>C {Math.round(totals.c)} g</span>
          <span style={{ color: 'var(--color-fat)' }}>G {Math.round(totals.f)} g</span>
        </div>
      </div>

      {result.hidden_ingredient_questions.map((q) => (
        <div key={q.id} className="mx-4 mt-3 rounded-2xl border border-carbs/40 bg-carbs/5 p-4">
          <p className="text-sm font-medium">{q.question}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {q.options.map((o, i) => (
              <button key={i} onClick={() => setAnswers((a) => ({ ...a, [q.id]: i }))} className={answers[q.id] === i ? 'chip-on' : 'chip'}>{o.label}</button>
            ))}
          </div>
        </div>
      ))}

      <ul className="mx-4 mt-3 space-y-2">
        {finalRows.map((r) => {
          const m = macrosFor(r.per100, r.grams)
          const isOpen = open === r.key
          const editable = !r.fromQuestion
          return (
            <li key={r.key} className={`rounded-2xl border bg-card ${r.confidence < 0.8 ? 'border-carbs/50' : 'border-line'}`}>
              <button onClick={() => editable && setOpen(isOpen ? null : r.key)} className="flex w-full items-center gap-3 p-3 text-left">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.name}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted tabular-nums">
                    <span>{r.grams} g</span><span>·</span><span>P {m.protein_g} · C {m.carbs_g} · G {m.fat_g}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold tabular-nums">{m.kcal}</div>
                  {editable && <ConfidenceDot value={r.confidence} />}
                </div>
              </button>

              {editable && r.alternatives.length > 0 && r.confidence < 0.8 && !isOpen && (
                <div className="flex flex-wrap gap-2 px-3 pb-3">
                  <span className="self-center text-xs text-muted">¿O es…?</span>
                  {r.alternatives.map((a) => (
                    <button key={a.name} onClick={() => update(r.key, { name: a.name, per100: a.per_100g, confidence: 1, alternatives: [{ name: r.name, per_100g: r.per100 }] })} className="chip text-xs">{a.name}</button>
                  ))}
                </div>
              )}

              {isOpen && (
                <div className="border-t border-line p-3">
                  <PortionSlider row={r} onChange={(g) => update(r.key, { grams: g })} />
                  {r.alternatives.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {r.alternatives.map((a) => (
                        <button key={a.name} onClick={() => update(r.key, { name: a.name, per100: a.per_100g, alternatives: [{ name: r.name, per_100g: r.per100 }, ...r.alternatives.filter((x) => x.name !== a.name)] })} className="chip text-xs">Cambiar a {a.name}</button>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-2">
                    <input value={r.name} onChange={(e) => update(r.key, { name: e.target.value })} className="field text-sm" />
                    <button onClick={() => remove(r.key)} className="btn-ghost px-3 py-2.5 text-fat" aria-label="Quitar">{Icon.trash}</button>
                  </div>
                  <p className="mt-2 text-[11px] text-muted tabular-nums">Por 100 g: {r.per100.kcal} kcal · P {r.per100.protein_g} · C {r.per100.carbs_g} · G {r.per100.fat_g}</p>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <button onClick={() => nav.go({ name: 'add' })} className="mx-4 mt-3 flex w-[calc(100%-2rem)] items-center justify-center gap-2 rounded-2xl border border-dashed border-line py-3 text-sm text-muted">
        {Icon.plus} Agregar ingrediente
      </button>

      <div className="pb-safe fixed inset-x-0 bottom-0 border-t border-line bg-bg/95 backdrop-blur">
        <div className="mx-auto max-w-md px-4 pt-3">
          <div className="mb-3 flex gap-2 overflow-x-auto">
            {(Object.keys(MEAL_LABEL) as Meal[]).map((m) => (
              <button key={m} onClick={() => setMeal(m)} className={meal === m ? 'chip-on' : 'chip'}>{MEAL_LABEL[m]}</button>
            ))}
          </div>
          <button disabled={saving || finalRows.length === 0} onClick={save} className="btn-primary w-full">
            Guardar {Math.round(totals.kcal)} kcal
          </button>
        </div>
      </div>
    </div>
  )
}

const MEASURES = [
  { label: '½ taza', g: 80 },
  { label: '1 taza', g: 160 },
  { label: 'Palma', g: 100 },
  { label: 'Puño', g: 150 },
]

function PortionSlider({ row, onChange }: { row: Row; onChange: (g: number) => void }) {
  const lo = Math.max(1, Math.round(row.min * 0.5))
  const hi = Math.max(row.max * 1.5, row.grams + 50)
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted">Porción</span>
        <div className="flex items-center gap-2">
          <button onClick={() => onChange(Math.max(1, row.grams - 10))} className="chip px-2.5 py-1">−</button>
          <input type="number" inputMode="numeric" value={row.grams} onChange={(e) => onChange(Math.max(1, +e.target.value))} className="field w-20 py-1 text-center tabular-nums" />
          <span className="text-muted">g</span>
          <button onClick={() => onChange(row.grams + 10)} className="chip px-2.5 py-1">+</button>
        </div>
      </div>
      <input type="range" min={lo} max={Math.round(hi)} step={5} value={row.grams} onChange={(e) => onChange(+e.target.value)} className="mt-3 w-full" />
      <div className="flex justify-between text-[11px] text-muted tabular-nums">
        <span>IA estimó {row.estGrams} g (rango {row.min}–{row.max})</span>
        {row.grams !== row.estGrams && <button onClick={() => onChange(row.estGrams)} className="underline">restaurar</button>}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {MEASURES.map((m) => <button key={m.label} onClick={() => onChange(m.g)} className="chip text-xs">{m.label} · {m.g} g</button>)}
      </div>
    </div>
  )
}
