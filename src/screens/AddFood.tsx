import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Nav } from '../App'
import { db, type Food } from '../lib/db'
import { searchOff, type OffProduct } from '../lib/off'
import { Header, Icon, Spinner } from '../ui'

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default function AddFood({ nav }: { nav: Nav }) {
  const [q, setQ] = useState('')
  const [remote, setRemote] = useState<OffProduct[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [manual, setManual] = useState(false)

  const local = useLiveQuery(async () => {
    const all = await db.foods.orderBy('lastUsed').reverse().limit(300).toArray()
    if (!q.trim()) return all.slice(0, 25)
    const nq = norm(q)
    return all.filter((f) => norm(`${f.name} ${f.brand ?? ''}`).includes(nq)).slice(0, 25)
  }, [q]) ?? []

  async function searchOnline() {
    if (!q.trim()) return
    setLoading(true)
    try { setRemote(await searchOff(q.trim())) } finally { setLoading(false) }
  }

  const openFood = (f: Food | OffProduct) =>
    nav.go({ name: 'portion', product: { name: f.name, brand: f.brand, barcode: f.barcode, per100: f.per100, servingG: f.servingG, servingLabel: f.servingLabel, source: 'source' in f ? f.source : 'off' } })

  return (
    <div className="pb-6">
      <Header title={nav.inReview ? 'Agregar ingrediente' : 'Buscar alimento'} onBack={nav.back} />
      <div className="p-4">
        <form onSubmit={(e) => { e.preventDefault(); searchOnline() }} className="flex gap-2">
          <input value={q} onChange={(e) => { setQ(e.target.value); setRemote(null) }} placeholder="Arroz, huevo, Alpina…" className="field" />
          <button className="btn-ghost px-3" aria-label="Buscar">{Icon.search}</button>
        </form>

        <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
          <button onClick={() => nav.go({ name: 'scan', mode: 'barcode' })} className="btn-ghost py-2.5">Código</button>
          <button onClick={() => nav.go({ name: 'scan', mode: 'text' })} className="btn-ghost py-2.5">Describir</button>
          <button onClick={() => setManual((m) => !m)} className={`btn-ghost py-2.5 ${manual ? 'border-accent text-accent' : ''}`}>Manual</button>
        </div>

        {manual && <ManualForm nav={nav} defaultName={q} />}

        <h2 className="mt-5 mb-2 text-sm text-muted">{q.trim() ? 'En tus alimentos' : 'Recientes'}</h2>
        {local.length === 0 && <p className="text-sm text-muted">{q.trim() ? 'Nada guardado con ese nombre.' : 'Aún no hay alimentos recientes.'}</p>}
        <ul className="space-y-1">
          {local.map((f) => <FoodRow key={f.id} f={f} onClick={() => openFood(f)} />)}
        </ul>

        {q.trim() && (
          <>
            <h2 className="mt-5 mb-2 text-sm text-muted">Open Food Facts</h2>
            {loading ? <Spinner /> : remote === null ? (
              <button onClick={searchOnline} className="chip">Buscar “{q.trim()}” en línea</button>
            ) : remote.length === 0 ? (
              <p className="text-sm text-muted">Sin resultados. Prueba “Describir” para que la IA lo calcule.</p>
            ) : (
              <ul className="space-y-1">
                {remote.map((p, i) => <FoodRow key={`${p.barcode}-${i}`} f={p} onClick={() => openFood(p)} />)}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function FoodRow({ f, onClick }: { f: Food | OffProduct; onClick: () => void }) {
  return (
    <li>
      <button onClick={onClick} className="flex w-full items-center justify-between rounded-xl bg-card px-3 py-2.5 text-left active:scale-[0.99]">
        <div className="min-w-0">
          <div className="truncate text-sm">{f.name}</div>
          <div className="truncate text-xs text-muted">{f.brand ? `${f.brand} · ` : ''}{f.per100.kcal} kcal / 100 g</div>
        </div>
        <span className="ml-2 text-accent">{Icon.plus}</span>
      </button>
    </li>
  )
}

function ManualForm({ nav, defaultName }: { nav: Nav; defaultName: string }) {
  const [name, setName] = useState(defaultName)
  const [v, setV] = useState({ kcal: '', protein_g: '', carbs_g: '', fat_g: '' } as Record<string, string>)
  const fields: [string, string][] = [['kcal', 'kcal'], ['protein_g', 'Prot. g'], ['carbs_g', 'Carbs g'], ['fat_g', 'Grasa g']]
  return (
    <div className="mt-3 rounded-2xl border border-line bg-card p-3">
      <p className="mb-2 text-xs text-muted">Valores por 100 g</p>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" className="field" />
      <div className="mt-2 grid grid-cols-4 gap-2">
        {fields.map(([k, label]) => (
          <input key={k} type="number" inputMode="decimal" placeholder={label} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} className="field px-2 text-sm" />
        ))}
      </div>
      <button
        disabled={!name.trim() || !v.kcal}
        onClick={() => nav.go({ name: 'portion', product: { name: name.trim(), source: 'manual', per100: { kcal: +v.kcal, protein_g: +v.protein_g || 0, carbs_g: +v.carbs_g || 0, fat_g: +v.fat_g || 0 } } })}
        className="btn-primary mt-3 w-full py-2.5"
      >Continuar</button>
    </div>
  )
}
