import { useState } from 'react'
import { signIn, signUp } from '../lib/sync'

export default function Login({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      if (mode === 'in') await signIn(email.trim(), password)
      else await signUp(email.trim(), password)
      onDone()
    } catch (err: any) {
      setMsg(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col justify-center px-6 pt-safe pb-safe">
      <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="mx-auto h-20 w-20 rounded-3xl" />
      <h1 className="mt-6 text-center text-3xl font-bold tracking-tight">Nutri</h1>
      <p className="mt-1 text-center text-muted">Tu progreso, en el iPhone y en el PC.</p>

      <form onSubmit={submit} className="mt-8 space-y-3">
        <input type="email" autoComplete="email" inputMode="email" placeholder="Correo" value={email} onChange={(e) => setEmail(e.target.value)} className="field" required />
        <input type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)} className="field" required minLength={6} />
        {msg && <p className="text-sm text-carbs">{msg}</p>}
        <button disabled={busy} className="btn-primary w-full">{busy ? 'Un momento…' : mode === 'in' ? 'Iniciar sesión' : 'Crear cuenta'}</button>
      </form>

      <button onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setMsg(null) }} className="mt-4 text-sm text-accent">
        {mode === 'in' ? '¿Primera vez? Crea tu cuenta' : 'Ya tengo cuenta'}
      </button>
      <button onClick={onSkip} className="mt-8 text-xs text-muted underline">Usar sin cuenta (solo en este dispositivo)</button>
    </div>
  )
}
