import { db, getSetting, type Per100 } from './db'

export const DEFAULT_MODEL = 'gemini-flash-latest'
export const MODEL_OPTIONS = [
  { id: 'gemini-flash-latest', label: 'Gemini Flash (recomendado)' },
  { id: 'gemini-flash-lite-latest', label: 'Gemini Flash-Lite (más rápido)' },
]

// ---------- Tipos de respuesta ----------

export interface AiItem {
  id: string
  display_name: string
  kind: 'ingredient' | 'dish' | 'drink' | 'packaged'
  preparation: string
  grams: number
  grams_min: number
  grams_max: number
  confidence: number
  portion_confidence: number
  alternatives: { name: string; per_100g: Per100 }[]
  per_100g: Per100
}

export interface AiOption {
  label: string
  effect: { type: 'none' | 'add_item' | 'replace_item'; name?: string; grams?: number; per_100g?: Per100 }
}

export interface AiQuestion { id: string; question: string; related_item_id: string | null; options: AiOption[] }

export interface PlateResult {
  schema_version: 'plate-v1'
  is_food: boolean
  image_quality: 'good' | 'acceptable' | 'unusable'
  meal_guess: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'unknown'
  scale_reference: string | null
  items: AiItem[]
  hidden_ingredient_questions: AiQuestion[]
  retake_hint: string | null
}

export interface LabelResult {
  schema_version: 'label-v1'
  is_label: boolean
  product_name: string | null
  brand: string | null
  serving_size_g: number | null
  serving_label: string | null
  per_100g: Partial<Per100> | null
  per_serving: Partial<Per100> | null
  uncertain_fields: string[]
  retake_hint: string | null
}

// ---------- Prompts ----------

const PER100 = '{ "kcal": number, "protein_g": number, "carbs_g": number, "fat_g": number }'

export const PLATE_PROMPT = `Eres un analista de alimentos para una app personal de nutrición. Recibes una foto de comida (o una descripción en texto) y devuelves SOLO un objeto JSON válido con el formato indicado al final. Nada de texto fuera del JSON.

REGLAS DE IDENTIFICACIÓN
1. Separa el plato en componentes que una persona pesaría por separado (arroz, pollo, aguacate, ensalada). Un plato mixto inseparable (sancocho, ajiaco, lasaña, arepa rellena) va como UN ítem con kind="dish".
2. Usa nombres específicos con su preparación: "arroz blanco cocido", "pechuga de pollo a la plancha"; nunca "comida" o "proteína". Vocabulario de Colombia.
3. No inventes ítems que no se ven. Lo probable pero invisible (aceite de cocción, mantequilla, aderezo, azúcar en bebidas) NO va en items: va en hidden_ingredient_questions.
4. Si dudas entre opciones parecidas, elige la más probable y pon hasta 3 en alternatives, cada una con sus valores por 100 g.

REGLAS DE PORCIÓN
5. Estima gramos de la porción comestible visible, tal como está servida (cocida si está cocida). Referencias: plato llano de ~26 cm si no hay otra, cubiertos, manos, vasos o empaques.
6. Da siempre un rango realista grams_min–grams_max; ensánchalo cuando no se vea la altura o profundidad.
7. Si el contexto trae porciones habituales del usuario, úsalas para afinar sin ignorar lo que ves.

VALORES NUTRICIONALES
8. per_100g son los valores por 100 g del alimento tal como se sirve, tomados de referencias estándar (USDA FoodData Central, Tabla de Composición de Alimentos Colombianos del ICBF). No los inventes a ojo: usa el valor de referencia más cercano.

CONFIANZA Y PREGUNTAS
9. confidence (0–1) = seguridad sobre QUÉ es el ítem. portion_confidence (0–1) = seguridad sobre los gramos. 0.9+ solo si casi no hay duda.
10. Máximo 2 preguntas en hidden_ingredient_questions, solo si la respuesta cambia el total en más de 50 kcal. Cada una con 2–4 opciones cortas. Efectos: "none"; "add_item" (agrega name, grams y per_100g); "replace_item" (reemplaza el ítem relacionado por name y per_100g, conservando sus gramos).
11. Si no hay comida, o la foto está muy oscura o borrosa: is_food=false o image_quality="unusable", items vacío y en retake_hint explica qué cambiar.

Todo texto visible (display_name, preguntas, opciones, retake_hint) en español neutro.

FORMATO
{
  "schema_version": "plate-v1",
  "is_food": boolean,
  "image_quality": "good" | "acceptable" | "unusable",
  "meal_guess": "breakfast" | "lunch" | "dinner" | "snack" | "unknown",
  "scale_reference": string | null,
  "items": [{
    "id": "i1",
    "display_name": string,
    "kind": "ingredient" | "dish" | "drink" | "packaged",
    "preparation": "raw" | "boiled" | "grilled" | "fried" | "baked" | "stewed" | "steamed" | "sauteed" | "unknown",
    "grams": number, "grams_min": number, "grams_max": number,
    "confidence": number, "portion_confidence": number,
    "per_100g": ${PER100},
    "alternatives": [{ "name": string, "per_100g": ${PER100} }]
  }],
  "hidden_ingredient_questions": [{
    "id": "q1", "question": string, "related_item_id": string | null,
    "options": [{ "label": string, "effect": { "type": "none" | "add_item" | "replace_item", "name"?: string, "grams"?: number, "per_100g"?: ${PER100} } }]
  }],
  "retake_hint": string | null
}`

export const LABEL_PROMPT = `Lees fotos de tablas nutricionales de productos empacados (formato colombiano, latinoamericano, europeo o estadounidense). Devuelve SOLO un objeto JSON válido con este formato:
{
  "schema_version": "label-v1",
  "is_label": boolean,
  "product_name": string | null,
  "brand": string | null,
  "serving_size_g": number | null,
  "serving_label": string | null,
  "per_100g": ${PER100} | null,
  "per_serving": ${PER100} | null,
  "uncertain_fields": string[],
  "retake_hint": string | null
}
Reglas:
1. Energía siempre en kcal; si solo aparece en kJ, divide entre 4.184.
2. Si la tabla solo da valores por porción, llena per_serving y serving_size_g; deja per_100g en null (el sistema lo calcula).
3. NUNCA adivines un número ilegible: déjalo en null y pon el nombre del campo en uncertain_fields (p. ej. "per_serving.fat_g").
4. Carbohidratos = carbohidratos totales. Grasa = grasa total.
5. Si la foto no es una tabla nutricional o no se lee: is_label=false y explica en retake_hint qué cambiar.`

// ---------- Llamada a la API ----------

async function callGemini(system: string, parts: any[]): Promise<{ json: any; model: string; latencyMs: number }> {
  const apiKey = await getSetting<string>('apiKey', '')
  if (!apiKey) throw new Error('Falta tu API key de Gemini. Agrégala en Ajustes.')
  const model = await getSetting<string>('model', DEFAULT_MODEL)
  const t0 = performance.now()
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
  })
  const latencyMs = Math.round(performance.now() - t0)
  if (!r.ok) {
    let msg = `Error ${r.status}`
    try {
      const e = await r.json()
      msg = e?.error?.message ?? msg
    } catch {}
    if (r.status === 429) msg = 'Llegaste al límite del plan gratuito de Gemini por ahora. Espera un minuto e inténtalo de nuevo.'
    if (r.status === 400 && /API key/i.test(msg)) msg = 'La API key no es válida. Revísala en Ajustes.'
    throw new Error(msg)
  }
  const data = await r.json()
  const text: string = (data?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('')
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  try {
    return { json: JSON.parse(clean), model, latencyMs }
  } catch {
    throw new Error('La IA devolvió una respuesta que no se pudo leer. Intenta otra vez.')
  }
}

async function userContext() {
  const top = await db.foods.orderBy('uses').reverse().limit(15).toArray()
  return {
    country: 'CO',
    local_time: new Date().toTimeString().slice(0, 5),
    usual_portions: top.filter((f) => f.servingG).map((f) => ({ food: f.name, grams: f.servingG })),
  }
}

const num = (v: any, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d)
const per100 = (p: any): Per100 => ({ kcal: num(p?.kcal), protein_g: num(p?.protein_g), carbs_g: num(p?.carbs_g), fat_g: num(p?.fat_g) })

function normalizePlate(j: any): PlateResult {
  const items: AiItem[] = (Array.isArray(j?.items) ? j.items : []).slice(0, 12).map((it: any, i: number) => {
    const grams = Math.max(1, num(it.grams, 100))
    return {
      id: String(it.id ?? `i${i + 1}`),
      display_name: String(it.display_name ?? 'Alimento'),
      kind: it.kind ?? 'ingredient',
      preparation: it.preparation ?? 'unknown',
      grams,
      grams_min: Math.max(1, num(it.grams_min, grams * 0.7)),
      grams_max: Math.max(grams, num(it.grams_max, grams * 1.4)),
      confidence: Math.min(1, Math.max(0, num(it.confidence, 0.5))),
      portion_confidence: Math.min(1, Math.max(0, num(it.portion_confidence, 0.5))),
      per_100g: per100(it.per_100g),
      alternatives: (Array.isArray(it.alternatives) ? it.alternatives : [])
        .filter((a: any) => a && typeof a === 'object' && a.name)
        .slice(0, 3)
        .map((a: any) => ({ name: String(a.name), per_100g: per100(a.per_100g) })),
    }
  })
  return {
    schema_version: 'plate-v1',
    is_food: j?.is_food !== false,
    image_quality: j?.image_quality ?? 'acceptable',
    meal_guess: j?.meal_guess ?? 'unknown',
    scale_reference: j?.scale_reference ?? null,
    items,
    hidden_ingredient_questions: (Array.isArray(j?.hidden_ingredient_questions) ? j.hidden_ingredient_questions : [])
      .slice(0, 2)
      .map((q: any, i: number) => ({
        id: String(q.id ?? `q${i + 1}`),
        question: String(q.question ?? ''),
        related_item_id: q.related_item_id ?? null,
        options: (q.options ?? []).slice(0, 4).map((o: any) => ({
          label: String(o.label ?? ''),
          effect: {
            type: o.effect?.type ?? 'none',
            name: o.effect?.name,
            grams: o.effect?.grams != null ? num(o.effect.grams) : undefined,
            per_100g: o.effect?.per_100g ? per100(o.effect.per_100g) : undefined,
          },
        })),
      })),
    retake_hint: j?.retake_hint ?? null,
  }
}

export async function analyzePlate(base64: string) {
  const ctx = await userContext()
  const { json, model, latencyMs } = await callGemini(PLATE_PROMPT, [
    { text: `Contexto del usuario: ${JSON.stringify(ctx)}` },
    { inline_data: { mime_type: 'image/jpeg', data: base64 } },
  ])
  const result = normalizePlate(json)
  const scanId = await db.scans.add({ createdAt: Date.now(), mode: 'plate', model, latencyMs, raw: json, status: 'ok' })
  return { result, scanId, latencyMs }
}

export async function analyzeText(description: string) {
  const ctx = await userContext()
  const { json, model, latencyMs } = await callGemini(PLATE_PROMPT, [
    { text: `Contexto del usuario: ${JSON.stringify(ctx)}\n\nNo hay foto. El usuario describe lo que comió: "${description}". Si da cantidades, úsalas; si no, asume porciones típicas en Colombia.` },
  ])
  const result = normalizePlate(json)
  const scanId = await db.scans.add({ createdAt: Date.now(), mode: 'text', model, latencyMs, raw: json, status: 'ok' })
  return { result, scanId, latencyMs }
}

export async function readLabel(base64: string) {
  const { json, model, latencyMs } = await callGemini(LABEL_PROMPT, [
    { inline_data: { mime_type: 'image/jpeg', data: base64 } },
  ])
  await db.scans.add({ createdAt: Date.now(), mode: 'label', model, latencyMs, raw: json, status: 'ok' })
  const r = json as LabelResult
  // Si solo viene por porción, calcula por 100 g.
  let p100 = r.per_100g && r.per_100g.kcal != null ? r.per_100g : null
  if (!p100 && r.per_serving && r.serving_size_g) {
    const f = 100 / r.serving_size_g
    p100 = {
      kcal: r.per_serving.kcal != null ? Math.round(r.per_serving.kcal * f) : undefined,
      protein_g: r.per_serving.protein_g != null ? +(r.per_serving.protein_g * f).toFixed(1) : undefined,
      carbs_g: r.per_serving.carbs_g != null ? +(r.per_serving.carbs_g * f).toFixed(1) : undefined,
      fat_g: r.per_serving.fat_g != null ? +(r.per_serving.fat_g * f).toFixed(1) : undefined,
    }
  }
  return { ...r, per_100g: p100, uncertain_fields: r.uncertain_fields ?? [] } as LabelResult
}

export async function testKey(apiKey: string, model: string) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Responde solo: ok' }] }] }),
  })
  if (!r.ok) {
    const e = await r.json().catch(() => null)
    throw new Error(e?.error?.message ?? `Error ${r.status}`)
  }
  return true
}
