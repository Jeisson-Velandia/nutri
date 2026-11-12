import { useEffect, useRef, useState } from 'react'
import type { IScannerControls } from '@zxing/browser'
import type { Nav } from '../App'
import { analyzePlate, analyzeText, readLabel, type LabelResult } from '../lib/gemini'
import { resizeToBase64 } from '../lib/image'
import { lookupBarcode } from '../lib/off'
import { ErrorBox, Header, Icon, Spinner } from '../ui'

export type ScanMode = 'plate' | 'barcode' | 'label' | 'text'

const MODES: { id: ScanMode; label: string }[] = [
  { id: 'plate', label: 'Plato' },
  { id: 'barcode', label: 'Código' },
  { id: 'label', label: 'Etiqueta' },
  { id: 'text', label: 'Texto' },
]

export default function Scan({ nav, initialMode, barcode }: { nav: Nav; initialMode: ScanMode; barcode?: string }) {
  const [mode, setMode] = useState<ScanMode>(initialMode)
  return (
    <div className="flex min-h-full flex-col">
      <Header title="Registrar" onBack={nav.back} />
      <div className="flex gap-1 p-3">
        {MODES.map((m) => (
          <button key={m.id} onClick={() => setMode(m.id)} className={`flex-1 rounded-xl py-2 text-sm font-medium ${mode === m.id ? 'bg-accent text-black' : 'bg-card text-muted'}`}>{m.label}</button>
        ))}
      </div>
      <div className="flex-1 px-4 pb-8">
        {mode === 'plate' && <PlateMode nav={nav} />}
        {mode === 'barcode' && <BarcodeMode nav={nav} onNotFound={() => setMode('label')} />}
        {mode === 'label' && <LabelMode nav={nav} barcode={barcode} />}
        {mode === 'text' && <TextMode nav={nav} />}
      </div>
    </div>
  )
}

// ---------- Foto de plato ----------

function PhotoButtons({ onFile }: { onFile: (f: File) => void }) {
  const cam = useRef<HTMLInputElement>(null)
  const gal = useRef<HTMLInputElement>(null)
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) onFile(f)
  }
  return (
    <div className="space-y-2">
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={gal} type="file" accept="image/*" hidden onChange={pick} />
      <button onClick={() => cam.current?.click()} className="btn-primary flex w-full items-center justify-center gap-2 py-4 text-lg">{Icon.camera} Tomar foto</button>
      <button onClick={() => gal.current?.click()} className="btn-ghost w-full">Elegir de la galería</button>
    </div>
  )
}

function PlateMode({ nav }: { nav: Nav }) {
  const [photo, setPhoto] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [slow, setSlow] = useState(false)
  const lastFile = useRef<File | null>(null)

  async function run(file: File) {
    lastFile.current = file
    setError(null); setBusy(true); setSlow(false)
    const timer = setTimeout(() => setSlow(true), 8000)
    try {
      const { base64, dataUrl } = await resizeToBase64(file)
      setPhoto(dataUrl)
      const { result, scanId } = await analyzePlate(base64)
      if (!result.is_food || result.image_quality === 'unusable' || result.items.length === 0) {
        setError(result.retake_hint || 'No pude identificar comida en la foto. Prueba con más luz y el plato completo.')
        return
      }
      nav.back()
      nav.go({ name: 'review', result, scanId, photo: dataUrl })
    } catch (e: any) {
      setError(e.message)
    } finally {
      clearTimeout(timer); setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {photo ? (
        <img src={photo} className="aspect-square w-full rounded-3xl object-cover" alt="" />
      ) : (
        <div className="grid aspect-square w-full place-items-center rounded-3xl border border-dashed border-line bg-card p-8 text-center text-muted">
          <div>
            <div className="mx-auto mb-3 w-fit text-accent">{Icon.camera}</div>
            <p className="font-medium text-white">Foto al plato completo</p>
            <p className="mt-1 text-sm">Desde arriba o a 45°, con buena luz. Un tenedor al lado ayuda a calcular la porción.</p>
          </div>
        </div>
      )}
      {busy ? (
        <>
          <Spinner label="Detectando ingredientes…" />
          {slow && <button onClick={() => nav.go({ name: 'add' })} className="btn-ghost w-full">Está tardando, buscar manualmente</button>}
        </>
      ) : (
        <>
          {error && <ErrorBox message={error} onRetry={lastFile.current ? () => run(lastFile.current!) : undefined} />}
          <PhotoButtons onFile={run} />
        </>
      )}
    </div>
  )
}

// ---------- Código de barras ----------

function BarcodeMode({ nav, onNotFound }: { nav: Nav; onNotFound: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const controls = useRef<IScannerControls | null>(null)
  const [code, setCode] = useState('')
  const [status, setStatus] = useState<'scanning' | 'looking' | 'notfound' | 'error'>('scanning')
  const [error, setError] = useState<string | null>(null)
  const [manual, setManual] = useState('')

  async function lookup(c: string) {
    controls.current?.stop()
    setCode(c); setStatus('looking')
    try {
      const p = await lookupBarcode(c)
      if (p) { nav.back(); nav.go({ name: 'portion', product: { ...p, source: 'off' } }) }
      else setStatus('notfound')
    } catch (e: any) {
      setError(e.message); setStatus('error')
    }
  }

  useEffect(() => {
    if (status !== 'scanning') return
    let cancelled = false
    import('@zxing/browser')
      .then(({ BrowserMultiFormatReader }) => new BrowserMultiFormatReader().decodeFromConstraints({ video: { facingMode: 'environment' } }, video.current!, (res) => {
        if (res && !cancelled) {
          cancelled = true
          navigator.vibrate?.(60)
          lookup(res.getText())
        }
      }))
      .then((c) => { if (cancelled) c.stop(); else controls.current = c })
      .catch(() => { setError('No se pudo abrir la cámara. Revisa los permisos o escribe el código.'); setStatus('error') })
    return () => { cancelled = true; controls.current?.stop() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  return (
    <div className="space-y-4">
      {status === 'scanning' && (
        <div className="relative overflow-hidden rounded-3xl bg-black">
          <video ref={video} className="aspect-[4/3] w-full object-cover" playsInline muted />
          <div className="pointer-events-none absolute inset-x-10 top-1/2 h-24 -translate-y-1/2 rounded-xl border-2 border-accent/80" />
          <p className="absolute inset-x-0 bottom-3 text-center text-sm text-white/80">Apunta al código de barras</p>
        </div>
      )}
      {status === 'looking' && <Spinner label={`Buscando ${code}…`} />}
      {status === 'notfound' && (
        <div className="rounded-2xl border border-line bg-card p-4">
          <p className="font-medium">No tenemos el producto {code}</p>
          <p className="mt-1 text-sm text-muted">Toma una foto a la tabla nutricional y lo creo por ti.</p>
          <div className="mt-3 flex gap-2">
            <button onClick={() => { nav.back(); nav.go({ name: 'scan', mode: 'label', barcode: code }) }} className="btn-primary flex-1">Foto a la etiqueta</button>
            <button onClick={() => setStatus('scanning')} className="btn-ghost">Otra vez</button>
          </div>
        </div>
      )}
      {status === 'error' && error && <ErrorBox message={error} onRetry={() => { setError(null); setStatus('scanning') }} />}

      <form onSubmit={(e) => { e.preventDefault(); if (manual.trim()) lookup(manual.trim()) }} className="flex gap-2">
        <input value={manual} onChange={(e) => setManual(e.target.value)} inputMode="numeric" placeholder="O escribe el código" className="field" />
        <button className="btn-ghost">Buscar</button>
      </form>
      <button onClick={onNotFound} className="w-full text-center text-sm text-muted underline">Sin código: leer la etiqueta</button>
    </div>
  )
}

// ---------- Etiqueta nutricional ----------

function LabelMode({ nav, barcode }: { nav: Nav; barcode?: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [res, setRes] = useState<LabelResult | null>(null)

  async function run(file: File) {
    setError(null); setBusy(true)
    try {
      const { base64 } = await resizeToBase64(file, 1600, 0.9) // más resolución para leer números
      const r = await readLabel(base64)
      if (!r.is_label) setError(r.retake_hint || 'No pude leer una tabla nutricional. Acércate y evita reflejos.')
      else setRes(r)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (res) return <LabelForm nav={nav} res={res} barcode={barcode} />

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-dashed border-line bg-card p-8 text-center text-muted">
        <p className="font-medium text-white">Foto a la tabla nutricional</p>
        <p className="mt-1 text-sm">Que se lean bien los números, sin reflejos.{barcode ? ` Se guardará con el código ${barcode}.` : ''}</p>
      </div>
      {busy ? <Spinner label="Leyendo la etiqueta…" /> : (
        <>
          {error && <ErrorBox message={error} />}
          <PhotoButtons onFile={run} />
        </>
      )}
    </div>
  )
}

function LabelForm({ nav, res, barcode }: { nav: Nav; res: LabelResult; barcode?: string }) {
  const unsure = new Set(res.uncertain_fields)
  const [name, setName] = useState(res.product_name ?? '')
  const [brand, setBrand] = useState(res.brand ?? '')
  const [servingG, setServingG] = useState<number | ''>(res.serving_size_g ?? '')
  const [v, setV] = useState({
    kcal: res.per_100g?.kcal ?? '',
    protein_g: res.per_100g?.protein_g ?? '',
    carbs_g: res.per_100g?.carbs_g ?? '',
    fat_g: res.per_100g?.fat_g ?? '',
  } as Record<string, number | ''>)

  const isUnsure = (k: string) => unsure.has(`per_100g.${k}`) || unsure.has(`per_serving.${k}`) || v[k] === ''
  const valid = name.trim() && v.kcal !== ''

  function next() {
    nav.back()
    nav.go({
      name: 'portion',
      product: {
        name: name.trim(), brand: brand.trim() || undefined, barcode, source: 'label',
        per100: { kcal: +v.kcal || 0, protein_g: +v.protein_g || 0, carbs_g: +v.carbs_g || 0, fat_g: +v.fat_g || 0 },
        servingG: servingG ? +servingG : undefined,
        servingLabel: res.serving_label ?? undefined,
      },
    })
  }

  const fields: [string, string][] = [['kcal', 'Calorías (kcal)'], ['protein_g', 'Proteína (g)'], ['carbs_g', 'Carbohidratos (g)'], ['fat_g', 'Grasa (g)']]

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Revisa los valores. Los marcados en ámbar no se leían bien.</p>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del producto" className="field" />
      <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Marca (opcional)" className="field" />
      <label className="block text-sm text-muted">Porción (g)
        <input type="number" inputMode="decimal" value={servingG} onChange={(e) => setServingG(e.target.value === '' ? '' : +e.target.value)} className="field mt-1" />
      </label>
      <p className="pt-2 text-sm font-medium">Por 100 g</p>
      <div className="grid grid-cols-2 gap-3">
        {fields.map(([k, label]) => (
          <label key={k} className="block text-xs text-muted">{label}
            <input
              type="number" inputMode="decimal" value={v[k]}
              onChange={(e) => setV({ ...v, [k]: e.target.value === '' ? '' : +e.target.value })}
              className={`field mt-1 ${isUnsure(k) ? 'border-carbs!' : ''}`}
            />
          </label>
        ))}
      </div>
      <button disabled={!valid} onClick={next} className="btn-primary w-full">Continuar</button>
    </div>
  )
}

// ---------- Descripción en texto ----------

function TextMode({ nav }: { nav: Nav }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setError(null); setBusy(true)
    try {
      const { result, scanId } = await analyzeText(text.trim())
      if (result.items.length === 0) { setError('No entendí qué comiste. Intenta describirlo con más detalle.'); return }
      nav.back()
      nav.go({ name: 'review', result, scanId })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <textarea
        value={text} onChange={(e) => setText(e.target.value)} rows={4} autoFocus
        placeholder="Ej: 2 huevos pericos, una arepa con queso y un café con leche"
        className="field resize-none"
      />
      {error && <ErrorBox message={error} />}
      {busy ? <Spinner label="Calculando…" /> : <button disabled={!text.trim()} onClick={run} className="btn-primary w-full">Calcular</button>}
    </div>
  )
}
