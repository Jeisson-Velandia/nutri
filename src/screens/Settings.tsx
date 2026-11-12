import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Nav } from '../App'
import { db, exportAll, getSetting, importAll, setSetting, type Profile } from '../lib/db'
import { DEFAULT_MODEL, MODEL_OPTIONS, testKey } from '../lib/gemini'
import { GOAL } from '../lib/nutrition'
import { Header } from '../ui'

export default function Settings({ nav, profile }: { nav: Nav; profile: Profile }) {
  const [key, setKey] = useState('')
  const [model, setModel] = useState(DEFAULT_MODEL)
  const [status, setStatus] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const scans = useLiveQuery(() => db.scans.toArray()) ?? []

  useEffect(() => {
    getSetting('apiKey', '').then(setKey)
    getSetting('model', DEFAULT_MODEL).then(setModel)
  }, [])

  async function saveKey() {
    setStatus('Probando…')
    try {
      await testKey(key.trim(), model)
      await setSetting('apiKey', key.trim())
      await setSetting('model', model)
      setStatus('Listo: la API key funciona.')
    } catch (e: any) {
      setStatus(`No funcionó: ${e.message}`)
    }
  }

  async function doExport() {
    const data = await exportAll()
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
    const file = new File([blob], `nutri-respaldo-${new Date().toISOString().slice(0, 10)}.json`, { type: 'application/json' })
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Respaldo Nutri' }).catch(() => {})
    } else {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = file.name
      a.click()
    }
  }

  async function doImport(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!confirm('Esto reemplaza todos tus datos actuales por los del respaldo. ¿Continuar?')) return
    try {
      await importAll(JSON.parse(await f.text()))
      setStatus('Respaldo restaurado.')
    } catch (err: any) {
      setStatus(`No se pudo importar: ${err.message}`)
    }
  }

  // Precisión: cuánto corrige el usuario los gramos que estima la IA.
  const diffs = scans.flatMap((s) => s.diff ?? []).filter((d) => d.finalG != null && d.estG > 0)
  const mape = diffs.length ? Math.round((diffs.reduce((a, d) => a + Math.abs(d.finalG! - d.estG) / d.estG, 0) / diffs.length) * 100) : null
  const avgLatency = scans.length ? (scans.reduce((a, s) => a + s.latencyMs, 0) / scans.length / 1000).toFixed(1) : null

  return (
    <div className="pb-6">
      <Header title="Ajustes" onBack={nav.back} />
      <div className="space-y-5 p-4">
        <section className="rounded-2xl border border-line bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Perfil y metas</h2>
              <p className="text-sm text-muted">{GOAL[profile.goal]} · {profile.targets.kcal} kcal · {profile.weightKg} kg</p>
            </div>
            <button onClick={() => nav.go({ name: 'profile' })} className="chip">Editar</button>
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-card p-4">
          <h2 className="font-semibold">IA (Google Gemini)</h2>
          <p className="mt-1 text-sm text-muted">
            Crea una API key gratis en{' '}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-accent underline">aistudio.google.com/apikey</a>.
            Se guarda solo en este teléfono.
          </p>
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Pega tu API key" className="field mt-3" autoComplete="off" />
          <select value={model} onChange={(e) => setModel(e.target.value)} className="field mt-2">
            {MODEL_OPTIONS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <button disabled={!key.trim()} onClick={saveKey} className="btn-primary mt-3 w-full">Guardar y probar</button>
          {status && <p className="mt-2 text-sm text-muted">{status}</p>}
        </section>

        <section className="rounded-2xl border border-line bg-card p-4">
          <h2 className="font-semibold">Tus datos</h2>
          <p className="mt-1 text-sm text-muted">Todo vive en este teléfono. Haz un respaldo de vez en cuando (por ejemplo, a Google Drive o Archivos).</p>
          <div className="mt-3 flex gap-2">
            <button onClick={doExport} className="btn-ghost flex-1">Exportar</button>
            <button onClick={() => fileRef.current?.click()} className="btn-ghost flex-1">Importar</button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={doImport} />
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-card p-4 text-sm">
          <h2 className="font-semibold">Precisión de la IA</h2>
          <p className="mt-1 text-muted tabular-nums">
            {scans.length} análisis · {avgLatency ? `${avgLatency} s promedio` : 'sin datos aún'}
            {mape != null && ` · corriges los gramos en ${mape} % en promedio`}
          </p>
        </section>

        <p className="text-center text-xs text-muted">Nutri · uso personal</p>
      </div>
    </div>
  )
}
