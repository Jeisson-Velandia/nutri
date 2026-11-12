import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Nav } from '../App'
import { db, MEAL_LABEL, shiftDate, todayISO, type Entry, type Meal, type Profile } from '../lib/db'
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
  const [editing, setEditing] = useState<Entry | null>(null)

  const t = profile.targets
  const sum = entries.reduce(
    (a, e) => ({ kcal: a.kcal + e.kcal, p: a.p + e.protein_g, c: a.c + e.carbs_g, f: a.f + e.fat_g }),
    { kcal: 0, p: 0, c: 0, f: 0 },
  )
  const waterMl = water.reduce((a, w) => a + w.ml, 0)
  const remaining = t.kcal - sum.kcal

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
        </Ring>
      </div>

      <div className="mx-5 mt-5 flex gap-4">
        <MacroBar label="Proteína" value={sum.p} max={t.protein_g} color="var(--color-protein)" />
        <MacroBar label="Carbos" value={sum.c} max={t.carbs_g} color="var(--color-carbs)" />
        <MacroBar label="Grasa" value={sum.f} max={t.fat_g} color="var(--color-fat)" />
      </div>

      <div className="mx-5 mt-5 rounded-2xl border border-line bg-card p-4">
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
                          <div className="text-xs text-muted tabular-nums">{Math.round(e.grams)} g · P {Math.round(e.protein_g)} · C {Math.round(e.carbs_g)} · G {Math.round(e.fat_g)}</div>
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
          <button onClick={() => setGrams((g) => Math.max(1, g - 10))} className="chip">−10</button>
          <input type="number" inputMode="decimal" value={grams} onChange={(e) => setGrams(+e.target.value)} className="field text-center tabular-nums" />
          <span className="text-muted">g</span>
          <button onClick={() => setGrams((g) => g + 10)} className="chip">+10</button>
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
