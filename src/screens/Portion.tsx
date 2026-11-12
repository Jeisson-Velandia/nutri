import { useState } from 'react'
import type { Nav, PortionFood } from '../App'
import { db, macrosFor, MEAL_LABEL, mealForNow, rememberFood, type Meal } from '../lib/db'
import { Header } from '../ui'

export default function Portion({ nav, product }: { nav: Nav; product: PortionFood }) {
  const [grams, setGrams] = useState<number>(product.servingG ?? 100)
  const [meal, setMeal] = useState<Meal>(nav.meal ?? mealForNow())
  const m = macrosFor(product.per100, grams || 0)

  const quick = [
    ...(product.servingG ? [{ label: product.servingLabel ? `1 porción (${product.servingLabel})` : `1 porción`, g: product.servingG }] : []),
    { label: '50 g', g: 50 }, { label: '100 g', g: 100 }, { label: '150 g', g: 150 }, { label: '200 g', g: 200 },
  ]

  async function save() {
    const foodId = await rememberFood({
      name: product.name, brand: product.brand, barcode: product.barcode, source: product.source ?? 'manual',
      per100: product.per100, servingG: product.servingG ?? grams, servingLabel: product.servingLabel,
    })
    if (nav.inReview) {
      nav.addToReview({ name: product.name, grams, per100: product.per100 })
      return
    }
    await db.entries.add({
      date: nav.date, meal, name: product.brand ? `${product.name} (${product.brand})` : product.name, grams, ...m,
      source: product.source === 'off' ? 'barcode' : product.source === 'label' ? 'label' : 'search', foodId, createdAt: Date.now(),
    })
    navigator.vibrate?.(30)
    nav.setMeal(null)
    nav.done()
  }

  return (
    <div className="pb-6">
      <Header title={product.name} onBack={nav.back} />
      <div className="p-4">
        {product.brand && <p className="text-sm text-muted">{product.brand}</p>}
        <div className="mt-2 rounded-2xl border border-line bg-card p-4 text-center">
          <div className="text-4xl font-bold tabular-nums text-accent">{m.kcal}<span className="ml-1 text-base text-muted">kcal</span></div>
          <div className="mt-2 flex justify-center gap-4 text-sm tabular-nums">
            <span style={{ color: 'var(--color-protein)' }}>P {m.protein_g} g</span>
            <span style={{ color: 'var(--color-carbs)' }}>C {m.carbs_g} g</span>
            <span style={{ color: 'var(--color-fat)' }}>G {m.fat_g} g</span>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button onClick={() => setGrams((g) => Math.max(1, g - 10))} className="chip">−10</button>
          <input type="number" inputMode="decimal" value={grams || ''} onChange={(e) => setGrams(+e.target.value)} className="field text-center text-lg tabular-nums" />
          <span className="text-muted">g</span>
          <button onClick={() => setGrams((g) => g + 10)} className="chip">+10</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {quick.map((qq) => <button key={qq.label} onClick={() => setGrams(qq.g)} className={grams === qq.g ? 'chip-on' : 'chip'}>{qq.label}</button>)}
        </div>

        {!nav.inReview && (
          <div className="mt-5 flex flex-wrap gap-2">
            {(Object.keys(MEAL_LABEL) as Meal[]).map((x) => <button key={x} onClick={() => setMeal(x)} className={meal === x ? 'chip-on' : 'chip'}>{MEAL_LABEL[x]}</button>)}
          </div>
        )}

        <p className="mt-4 text-xs text-muted tabular-nums">Por 100 g: {product.per100.kcal} kcal · P {product.per100.protein_g} · C {product.per100.carbs_g} · G {product.per100.fat_g}</p>

        <button disabled={!grams} onClick={save} className="btn-primary mt-6 w-full">{nav.inReview ? 'Agregar al plato' : 'Guardar'}</button>
      </div>
    </div>
  )
}
