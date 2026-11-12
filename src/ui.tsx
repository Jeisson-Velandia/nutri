import { useEffect, useState, type ReactNode } from 'react'
import { onAiProgress, type AiProgress } from './lib/gemini'

export function Ring({ value, max, size = 180, stroke = 14, children }: { value: number; max: number; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const pct = max > 0 ? Math.min(1, value / max) : 0
  const over = value > max
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={over ? 'var(--color-fat)' : 'var(--color-accent)'}
          strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)}
          style={{ transition: 'stroke-dashoffset 700ms cubic-bezier(.2,.8,.2,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  )
}

export function MacroBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="flex-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums"><b className="text-white">{Math.round(value)}</b><span className="text-muted">/{max} g</span></span>
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-line overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color, transition: 'width 600ms ease' }} />
      </div>
    </div>
  )
}

export function Header({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <div className="pt-safe sticky top-0 z-10 bg-bg/90 backdrop-blur border-b border-line">
      <div className="flex h-12 items-center gap-2 px-3">
        {onBack ? (
          <button onClick={onBack} className="h-9 w-9 rounded-full grid place-items-center active:bg-card" aria-label="Volver">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
        ) : <div className="w-2" />}
        <h1 className="flex-1 truncate text-lg font-semibold">{title}</h1>
        {right}
      </div>
    </div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-muted">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent" />
      {label && <p className="text-sm">{label}</p>}
    </div>
  )
}

export function ConfidenceDot({ value }: { value: number }) {
  const color = value >= 0.8 ? 'var(--color-accent)' : value >= 0.5 ? 'var(--color-carbs)' : 'var(--color-fat)'
  const label = value >= 0.8 ? 'Seguro' : value >= 0.5 ? 'Revisar' : 'Dudoso'
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />{label}
    </span>
  )
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl border border-fat/40 bg-fat/10 p-4 text-sm">
      <p>{message}</p>
      {onRetry && <button onClick={onRetry} className="mt-3 chip">Reintentar</button>}
    </div>
  )
}

export const Icon = {
  camera: (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
  ),
  home: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" /></svg>
  ),
  search: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
  ),
  gear: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
  ),
  plus: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
  ),
  trash: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
  ),
}

/** Spinner que muestra qué modelo está respondiendo y cuántos segundos van. */
export function AiSpinner({ label }: { label: string }) {
  const [p, setP] = useState<AiProgress | null>(null)
  const [, tick] = useState(0)
  useEffect(() => onAiProgress(setP), [])
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 250); return () => clearInterval(t) }, [])
  const secs = p ? ((performance.now() - p.startedAt) / 1000).toFixed(1) : null
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-muted">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent" />
      <p className="text-sm">{label}</p>
      {p && <p className="text-xs tabular-nums">{secs} s · {p.model}{p.attempt > 1 ? ` (intento ${p.attempt}: el anterior estaba saturado)` : ''}</p>}
    </div>
  )
}
