import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, todayISO, type Meal } from './lib/db'
import type { PlateResult } from './lib/gemini'
import type { OffProduct } from './lib/off'
import Onboarding from './screens/Onboarding'
import Today from './screens/Today'
import Scan, { type ScanMode } from './screens/Scan'
import Review from './screens/Review'
import AddFood from './screens/AddFood'
import Portion from './screens/Portion'
import Settings from './screens/Settings'
import { Icon } from './ui'

export type View =
  | { name: 'today' }
  | { name: 'scan'; mode: ScanMode; barcode?: string }
  | { name: 'review'; result: PlateResult; scanId: number; photo?: string }
  | { name: 'add' }
  | { name: 'portion'; product: OffProduct | PortionFood }
  | { name: 'settings' }
  | { name: 'profile' }

export interface PortionFood {
  name: string
  brand?: string
  barcode?: string
  per100: { kcal: number; protein_g: number; carbs_g: number; fat_g: number }
  servingG?: number
  servingLabel?: string
  source?: 'off' | 'label' | 'manual' | 'ai'
}

export interface ReviewAddition {
  name: string
  grams: number
  per100: { kcal: number; protein_g: number; carbs_g: number; fat_g: number }
}

export interface Nav {
  go: (v: View) => void
  back: () => void
  done: () => void
  /** true si hay una revisión de escaneo abierta: lo que se busque se agrega a ella. */
  inReview: boolean
  addToReview: (item: ReviewAddition) => void
  date: string
  setDate: (d: string) => void
  meal: Meal | null
  setMeal: (m: Meal | null) => void
}

export default function App() {
  const profile = useLiveQuery(() => db.profile.get('me'), [], 'loading' as const)
  const [stack, setStack] = useState<View[]>([{ name: 'today' }])
  const [date, setDate] = useState(todayISO())
  const [meal, setMeal] = useState<Meal | null>(null)
  const [additions, setAdditions] = useState<ReviewAddition[]>([])
  const view = stack[stack.length - 1]
  const inReview = stack.some((v) => v.name === 'review')

  // Si la app queda abierta de un día para otro, vuelve a "hoy" al regresar.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') setDate((d) => (d < todayISO() && stack.length === 1 ? todayISO() : d)) }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [stack.length])

  const nav: Nav = {
    go: (v) => setStack((s) => (v.name === 'today' ? [v] : [...s, v])),
    back: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    // Tras guardar: vuelve a la revisión de un escaneo si se venía de ahí; si no, a Hoy.
    done: () => setStack((s) => {
      const i = s.map((v) => v.name).lastIndexOf('review')
      return i > 0 ? s.slice(0, i + 1) : [{ name: 'today' }]
    }),
    inReview,
    addToReview: (item) => {
      setAdditions((a) => [...a, item])
      setStack((s) => s.slice(0, s.map((v) => v.name).lastIndexOf('review') + 1))
    },
    date, setDate, meal, setMeal,
  }

  if (profile === 'loading') return null
  if (!profile || view.name === 'profile') return <Onboarding existing={profile ?? undefined} onDone={() => setStack([{ name: 'today' }])} />

  const tabbed = view.name === 'today' || view.name === 'add' || view.name === 'settings'

  return (
    <div className="mx-auto flex h-full max-w-md flex-col">
      {/* Todas las pantallas del historial quedan montadas (ocultas) para no perder su estado. */}
      {stack.map((v, i) => (
        <main key={`${i}-${v.name}`} className={`flex-1 overflow-y-auto ${i === stack.length - 1 ? '' : 'hidden'}`}>
          {v.name === 'today' && <Today nav={nav} profile={profile} />}
          {v.name === 'scan' && <Scan nav={nav} initialMode={v.mode} barcode={v.barcode} />}
          {v.name === 'review' && <Review nav={nav} {...v} additions={additions} clearAdditions={() => setAdditions([])} />}
          {v.name === 'add' && <AddFood nav={nav} />}
          {v.name === 'portion' && <Portion nav={nav} product={v.product} />}
          {v.name === 'settings' && <Settings nav={nav} profile={profile} />}
        </main>
      ))}

      {tabbed && (
        <nav className="pb-safe border-t border-line bg-bg/95 backdrop-blur">
          <div className="relative grid grid-cols-3 items-center pt-2">
            <TabBtn active={view.name === 'today'} onClick={() => setStack([{ name: 'today' }])} icon={Icon.home} label="Hoy" />
            <div className="flex justify-center">
              <button
                onClick={() => { setMeal(null); nav.go({ name: 'scan', mode: 'plate' }) }}
                className="-mt-8 grid h-16 w-16 place-items-center rounded-full bg-accent text-black shadow-[0_8px_30px_rgba(182,243,106,0.35)] active:scale-95 transition"
                aria-label="Escanear comida"
              >
                {Icon.camera}
              </button>
            </div>
            <TabBtn active={view.name === 'add'} onClick={() => setStack([{ name: 'today' }, { name: 'add' }])} icon={Icon.search} label="Buscar" />
          </div>
        </nav>
      )}
    </div>
  )
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button onClick={onClick} className={`flex flex-col items-center gap-0.5 py-1 text-[11px] ${active ? 'text-accent' : 'text-muted'}`}>
      {icon}
      {label}
    </button>
  )
}
