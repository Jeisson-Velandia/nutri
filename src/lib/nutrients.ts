import { db, getSetting, type Per100 } from './db'

export type NutrientSource = 'mine' | 'usda' | 'ai'

export interface Resolved {
  per100: Per100
  source: NutrientSource
  /** Texto corto para mostrar de dónde salen los valores. */
  label: string
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** Busca en los alimentos que ya usaste con valores confiables (USDA, etiqueta, código de barras o manual). */
async function fromMine(name: string): Promise<Resolved | null> {
  const n = norm(name)
  const all = await db.foods.orderBy('uses').reverse().limit(500).toArray()
  const hit = all.find((f) => f.source !== 'ai' && norm(f.name) === n)
  if (!hit) return null
  const label = hit.source === 'usda' ? `USDA · ${hit.sourceName ?? hit.name}` : 'Tu alimento guardado'
  return { per100: hit.per100, source: hit.source === 'usda' ? 'usda' : 'mine', label }
}

// ---------- USDA FoodData Central ----------

const USDA_CACHE = 'nutri-usda-cache-v1'
let cache: Record<string, { per100: Per100; desc: string } | null> = {}
try { cache = JSON.parse(localStorage.getItem(USDA_CACHE) ?? '{}') } catch {}
const saveCache = () => { try { localStorage.setItem(USDA_CACHE, JSON.stringify(cache)) } catch {} }

const ENERGY_IDS = [1008, 2047, 2048] // kcal (SR Legacy / Atwater)
function nutrient(food: any, ids: number[]): number | null {
  for (const id of ids) {
    const n = (food.foodNutrients ?? []).find((x: any) => x.nutrientId === id || Number(x.nutrientNumber) === id)
    if (n && typeof n.value === 'number' && (id !== 1008 || n.unitName?.toUpperCase() !== 'KJ')) return n.value
  }
  return null
}

function toTitle(desc: string) {
  return desc.charAt(0) + desc.slice(1).toLowerCase()
}

export async function usdaLookup(query: string): Promise<{ per100: Per100; desc: string } | null> {
  const q = query.trim().toLowerCase()
  if (!q) return null
  if (q in cache) return cache[q]
  const key = (await getSetting<string>('usdaKey', '')) || 'DEMO_KEY'
  const params = new URLSearchParams({ query: q, pageSize: '8', api_key: key })
  // Genéricos primero (SR Legacy y Foundation); platos mixtos en FNDDS (Survey).
  for (const t of ['SR Legacy', 'Foundation', 'Survey (FNDDS)']) params.append('dataType', t)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 6000)
  try {
    const r = await fetch(`https://api.nal.usda.gov/fdc/v1/foods/search?${params}`, { signal: ctrl.signal })
    if (!r.ok) return null // límite de la key, caído, etc.: se usa el estimado de la IA
    const j = await r.json()
    for (const f of j.foods ?? []) {
      const kcal = nutrient(f, ENERGY_IDS)
      if (kcal == null) continue
      const result = {
        desc: toTitle(String(f.description ?? query)),
        per100: {
          kcal: Math.round(kcal),
          protein_g: +(nutrient(f, [1003]) ?? 0).toFixed(1),
          carbs_g: +(nutrient(f, [1005, 1050]) ?? 0).toFixed(1),
          fat_g: +(nutrient(f, [1004, 1085]) ?? 0).toFixed(1),
        },
      }
      cache[q] = result
      saveCache()
      return result
    }
    cache[q] = null
    saveCache()
    return null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Valores por 100 g para un alimento detectado: tuyos → USDA → estimado de la IA. */
export async function resolveNutrients(name: string, searchEn: string, aiEstimate?: Per100): Promise<Resolved> {
  const mine = await fromMine(name)
  if (mine) return mine
  const usda = await usdaLookup(searchEn || name)
  if (usda) return { per100: usda.per100, source: 'usda', label: `USDA · ${usda.desc}` }
  return { per100: aiEstimate ?? { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }, source: 'ai', label: 'Estimado por IA' }
}
