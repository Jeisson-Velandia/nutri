import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Nav } from '../App'
import { db, exportAll, getSetting, importAll, setSetting, type Profile } from '../lib/db'
import { DEFAULT_MODEL, MODEL_OPTIONS, testKey } from '../lib/gemini'
import { GOALS } from '../lib/nutrition'
import { Header } from '../ui'
import { syncEnabled } from '../config'
import { getSession, getStatus, healthConnectionCode, onStatus, signOutAndClear, syncNow, type SyncStatus } from '../lib/sync'

export default function Settings({ nav, profile, onSignedOut }: { nav: Nav; profile: Profile; onSignedOut: () => void }) {
  const [key, setKey] = useState('')
  const [model, setModel] = useState(DEFAULT_MODEL)
  const [status, setStatus] = useState<string | null>(null)
  const [usdaKey, setUsdaKey] = useState('')
  const [healthMsg, setHealthMsg] = useState<string | null>(null)
  const [healthCode, setHealthCode] = useState<string | null>(null)
  const [usdaStatus, setUsdaStatus] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const scans = useLiveQuery(() => db.scans.toArray()) ?? []

  const [email, setEmail] = useState<string | null>(null)
  const [sync, setSync] = useState<SyncStatus>(getStatus())
  useEffect(() => onStatus(setSync), [])
  useEffect(() => { getSession().then((s) => setEmail(s?.user.email ?? null)) }, [])

  useEffect(() => {
    getSetting('apiKey', '').then(setKey)
    getSetting('model', DEFAULT_MODEL).then(setModel)
    getSetting('usdaKey', '').then(setUsdaKey)
  }, [])

  async function saveKey() {
    setStatus('Probando…')
    try {
      const r = await testKey(key.trim(), model)
      await setSetting('apiKey', key.trim())
      await setSetting('model', model)
      setStatus(r === 'ok' ? 'Listo: la API key funciona.' : 'Key guardada y válida. El modelo está saturado ahora; la app reintentará sola con otro modelo.')
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
    if (!confirm('Esto agrega los datos del respaldo a los que ya tienes (los repetidos se sobrescriben). ¿Continuar?')) return
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
  const lastScan = [...scans].sort((a, b) => b.createdAt - a.createdAt)[0]
  const avgLatency = scans.length ? (scans.reduce((a, s) => a + s.latencyMs, 0) / scans.length / 1000).toFixed(1) : null

  return (
    <div className="pb-6">
      <Header title="Ajustes" onBack={nav.back} />
      <div className="space-y-5 p-4">
        <section className="rounded-2xl border border-line bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Perfil y metas</h2>
              <p className="text-sm text-muted">{GOALS[profile.goal]?.label} · {profile.targets.kcal} kcal · {profile.weightKg} kg</p>
            </div>
            <button onClick={() => nav.go({ name: 'profile' })} className="chip">Editar</button>
          </div>
        </section>

        {syncEnabled && (
          <section className="rounded-2xl border border-line bg-card p-4">
            <h2 className="font-semibold">Cuenta y sincronización</h2>
            {email ? (
              <>
                <p className="mt-1 text-sm text-muted">{email}</p>
                <p className="mt-1 text-sm">
                  {sync.state === 'syncing' ? 'Sincronizando…'
                    : sync.state === 'error' ? <span className="text-fat">Error: {sync.error}</span>
                    : sync.state === 'offline' ? 'Sin conexión: se sincroniza al volver la señal.'
                    : sync.lastSync ? `Sincronizado ${new Date(sync.lastSync).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}` : 'Pendiente'}
                </p>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => syncNow()} className="btn-ghost flex-1">Sincronizar ahora</button>
                  <button
                    onClick={async () => {
                      if (!confirm('Se cerrará la sesión y se borrarán los datos de este dispositivo. Tus datos quedan guardados en tu cuenta. ¿Continuar?')) return
                      await signOutAndClear(); onSignedOut()
                    }}
                    className="btn-ghost text-fat"
                  >Salir</button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-1 text-sm text-muted">Estás usando la app sin cuenta: tus datos solo viven en este dispositivo.</p>
                <button onClick={() => { localStorage.removeItem('nutri-local-only'); onSignedOut() }} className="btn-primary mt-3 w-full">Iniciar sesión</button>
              </>
            )}
          </section>
        )}

        {syncEnabled && email && (
          <section className="rounded-2xl border border-line bg-card p-4">
            <h2 className="font-semibold">Salud de Apple</h2>
            <p className="mt-1 text-sm text-muted">
              Un Atajo de iOS lleva tus calorías y macros a Salud, y trae pasos, sueño, calorías activas y peso.
              Copia este código y pégalo en el Atajo cuando te lo pida. Es privado: permite escribir en tu cuenta.
            </p>
            <button
              onClick={async () => {
                const code = await healthConnectionCode()
                if (!code) return setHealthMsg('Inicia sesión primero.')
                setHealthCode(code)
                try { await navigator.clipboard.writeText(code); setHealthMsg('Código copiado al portapapeles. También está aquí abajo por si lo necesitas.') }
                catch { setHealthMsg('Mantén presionado el código de abajo → Seleccionar todo → Copiar.') }
              }}
              className="btn-ghost mt-3 w-full"
            >Copiar código de conexión</button>
            {healthMsg && <p className="mt-2 text-sm text-muted">{healthMsg}</p>}
            <label className="mt-3 block text-xs text-muted">Nombre de tu Atajo (para el botón "Actualizar desde Salud")
              <input defaultValue={localStorage.getItem('nutri-shortcut-name') || 'Nutrí'} onChange={(e) => localStorage.setItem('nutri-shortcut-name', e.target.value.trim())} className="field mt-1" />
            </label>
            {healthCode && (
              <textarea readOnly value={healthCode} rows={5} onFocus={(e) => e.currentTarget.select()}
                className="field mt-2 font-mono text-xs break-all" />
            )}
          </section>
        )}

        <section className="rounded-2xl border border-line bg-card p-4">
          <h2 className="font-semibold">IA (Google Gemini)</h2>
          <p className="mt-1 text-sm text-muted">
            Crea una API key gratis en{' '}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-accent underline">aistudio.google.com/apikey</a>.
            {syncEnabled && email ? 'Se guarda en tu cuenta privada y queda disponible en tus otros dispositivos.' : 'Se guarda solo en este dispositivo.'}
          </p>
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Pega tu API key" className="field mt-3" autoComplete="off" />
          <select value={model} onChange={(e) => setModel(e.target.value)} className="field mt-2">
            {MODEL_OPTIONS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <button disabled={!key.trim()} onClick={saveKey} className="btn-primary mt-3 w-full">Guardar y probar</button>
          {status && <p className="mt-2 text-sm text-muted">{status}</p>}
        </section>

        <section className="rounded-2xl border border-line bg-card p-4">
          <h2 className="font-semibold">Datos nutricionales (USDA)</h2>
          <p className="mt-1 text-sm text-muted">
            Las calorías y macros de fotos y textos salen de USDA FoodData Central, la misma fuente de Fitia para alimentos genéricos.
            Sin key se usa una de prueba muy limitada; crea la tuya gratis en{' '}
            <a href="https://fdc.nal.usda.gov/api-key-signup" target="_blank" rel="noreferrer" className="text-accent underline">fdc.nal.usda.gov/api-key-signup</a>.
          </p>
          <input type="password" value={usdaKey} onChange={(e) => setUsdaKey(e.target.value)} placeholder="Pega tu key de USDA (api.data.gov)" className="field mt-3" autoComplete="off" />
          <button
            disabled={!usdaKey.trim()}
            onClick={async () => {
              setUsdaStatus('Probando…')
              const r = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?query=egg&pageSize=1&api_key=${encodeURIComponent(usdaKey.trim())}`).catch(() => null)
              if (r?.ok) { await setSetting('usdaKey', usdaKey.trim()); setUsdaStatus('Listo: la key de USDA funciona.') }
              else setUsdaStatus(r ? `No funcionó (error ${r.status}). Revisa la key.` : 'No se pudo conectar con USDA.')
            }}
            className="btn-primary mt-3 w-full"
          >Guardar y probar</button>
          {usdaStatus && <p className="mt-2 text-sm text-muted">{usdaStatus}</p>}
        </section>

        <section className="rounded-2xl border border-line bg-card p-4">
          <h2 className="font-semibold">Tus datos</h2>
          <p className="mt-1 text-sm text-muted">Exporta un respaldo en JSON cuando quieras (por ejemplo, a Google Drive o Archivos).</p>
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
            {lastScan && ` · último: ${(lastScan.latencyMs / 1000).toFixed(1)} s con ${lastScan.model}`}
            {mape != null && ` · corriges los gramos en ${mape} % en promedio`}
          </p>
        </section>

        <p className="text-center text-xs text-muted">Nutri · versión del {__BUILD__}</p>
      </div>
    </div>
  )
}
