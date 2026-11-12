import type { Per100 } from './db'

export interface OffProduct {
  name: string
  brand?: string
  barcode: string
  per100: Per100
  servingG?: number
  servingLabel?: string
}

const FIELDS = 'code,product_name,product_name_es,brands,nutriments,serving_size,serving_quantity'

function toProduct(p: any): OffProduct | null {
  const n = p?.nutriments ?? {}
  const kcal = n['energy-kcal_100g'] ?? (n['energy_100g'] ? n['energy_100g'] / 4.184 : undefined)
  if (kcal == null) return null
  const name = p.product_name_es || p.product_name
  if (!name) return null
  return {
    name,
    brand: p.brands?.split(',')[0]?.trim() || undefined,
    barcode: String(p.code ?? ''),
    per100: {
      kcal: Math.round(kcal),
      protein_g: +(n.proteins_100g ?? 0),
      carbs_g: +(n.carbohydrates_100g ?? 0),
      fat_g: +(n.fat_100g ?? 0),
    },
    servingG: p.serving_quantity ? Number(p.serving_quantity) : undefined,
    servingLabel: p.serving_size || undefined,
  }
}

export async function lookupBarcode(code: string): Promise<OffProduct | null> {
  const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`)
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`Open Food Facts respondió ${r.status}`)
  const j = await r.json()
  if (j.status !== 1) return null
  return toProduct({ ...j.product, code })
}

export async function searchOff(q: string, signal?: AbortSignal): Promise<OffProduct[]> {
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=20&fields=${FIELDS}`
  const r = await fetch(url, { signal })
  if (!r.ok) return []
  const j = await r.json()
  return (j.products ?? []).map(toProduct).filter(Boolean) as OffProduct[]
}
