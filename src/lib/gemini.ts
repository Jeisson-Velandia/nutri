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
  /** Nombre estilo USDA en inglés para buscar los valores verificados. */
  search_name_en: string
  alternatives: { name: string; search_name_en: string; per_100g?: Per100 }[]
  /** Valor estimado por la IA: solo se usa si no se encuentra en USDA ni en tus alimentos. */
  per_100g: Per100
}

export interface AiOption {
  label: string
  effect: { type: 'none' | 'add_item' | 'replace_item'; name?: string; search_name_en?: string; grams?: number; per_100g?: Per100 }
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
4. Si dudas entre opciones parecidas, elige la más probable y pon hasta 3 en alternatives (nombre en español y search_name_en).
5b. search_name_en: descripción en inglés al estilo de USDA FoodData Central para buscar el alimento ("Rice, white, cooked", "Chicken breast, grilled", "Egg, whole, fried", "Sandwich, ham and cheese"). Corta y genérica, sin marcas.

REGLAS DE PORCIÓN
5. Estima gramos de la porción comestible visible, tal como está servida (cocida si está cocida). Referencias: plato llano de ~26 cm si no hay otra, cubiertos, manos, vasos o empaques.
6. Da siempre un rango realista grams_min–grams_max; ensánchalo cuando no se vea la altura o profundidad.
7. Si el contexto trae porciones habituales del usuario, úsalas para afinar sin ignorar lo que ves.

VALORES NUTRICIONALES
8. per_100g es tu mejor estimación por 100 g (referencia USDA/ICBF); el sistema la reemplaza por datos verificados cuando los encuentra. Sé breve: sin decimales innecesarios.

CONFIANZA Y PREGUNTAS
9. confidence (0–1) = seguridad sobre QUÉ es el ítem. portion_confidence (0–1) = seguridad sobre los gramos. 0.9+ solo si casi no hay duda.
10. Máximo 2 preguntas en hidden_ingredient_questions, solo si la respuesta cambia el total en más de 50 kcal. Cada una con 2–4 opciones cortas. Efectos: "none"; "add_item" (agrega name, search_name_en, grams y per_100g); "replace_item" (reemplaza el ítem relacionado por name, search_name_en y per_100g, conservando sus gramos).
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
    "search_name_en": string,
    "kind": "ingredient" | "dish" | "drink" | "packaged",
    "preparation": "raw" | "boiled" | "grilled" | "fried" | "baked" | "stewed" | "steamed" | "sauteed" | "unknown",
    "grams": number, "grams_min": number, "grams_max": number,
    "confidence": number, "portion_confidence": number,
    "per_100g": ${PER100},
    "alternatives": [{ "name": string, "search_name_en": string }]
  }],
  "hidden_ingredient_questions": [{
    "id": "q1", "question": string, "related_item_id": string | null,
    "options": [{ "label": string, "effect": { "type": "none" | "add_item" | "replace_item", "name"?: string, "search_name_en"?: string, "grams"?: number, "per_100g"?: ${PER100} } }]
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

const isOverload = (status: number, msg: string) => status === 503 || status === 500 || status === 504 || /high demand|overloaded|unavailable|timeout/i.test(msg)

// ---------- Progreso visible en la UI ----------
export interface AiProgress { model: string; attempt: number; startedAt: number }
const progressListeners = new Set<(p: AiProgress | null) => void>()
export const onAiProgress = (fn: (p: AiProgress | null) => void) => { progressListeners.add(fn); return () => { progressListeners.delete(fn) } }
const emit = (p: AiProgress | null) => progressListeners.forEach((l) => l(p))

const GOOD_MODEL = 'nutri-good-model'
function lastGoodModel(): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(GOOD_MODEL) ?? 'null')
    return v && Date.now() - v.at < 6 * 3600_000 ? v.model : null // se olvida a las 6 h
  } catch { return null }
}
const rememberGood = (model: string) => { try { localStorage.setItem(GOOD_MODEL, JSON.stringify({ model, at: Date.now() })) } catch {} }

/** Desactiva (o reduce al mínimo) el "razonamiento" interno: es lo que más demora la respuesta. */
function fastThinking(model: string) {
  if (/gemini-2\.5/.test(model)) return { thinkingBudget: 0 }
  if (/gemini-[3-9]|latest/.test(model)) return { thinkingLevel: 'minimal' }
  return undefined
}

const noThinkingSupport = new Set<string>()

async function requestOnce(model: string, apiKey: string, system: string, parts: any[], timeoutMs = 60000) {
  const send = async (withThinking: boolean) => {
    const thinkingConfig = withThinking ? fastThinking(model) : undefined
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    let r: Response
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      signal: ctrl.signal,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', ...(thinkingConfig ? { thinkingConfig } : {}) },
      }),
    })
    } catch (e: any) {
      clearTimeout(timer)
      const msg = e?.name === 'AbortError' ? 'timeout' : 'network'
      return { ok: false, status: msg === 'timeout' ? 504 : 0, body: null, msg }
    }
    clearTimeout(timer)
    let body: any = null
    try { body = await r.json() } catch {}
    return { ok: r.ok, status: r.status, body, msg: body?.error?.message ?? `Error ${r.status}` }
  }
  const tryThinking = !noThinkingSupport.has(model) && fastThinking(model) != null
  let res = await send(tryThinking)
  // Si el modelo no acepta esa configuración, se repite sin ella (y se recuerda).
  if (tryThinking && res.status === 400 && /thinking/i.test(res.msg)) {
    noThinkingSupport.add(model)
    res = await send(false)
  }
  return res
}

let flashModelsCache: string[] | null = null

/** Modelos Flash disponibles para esta key (más nuevos primero), para usarlos de respaldo. */
async function availableFlashModels(apiKey: string): Promise<string[]> {
  if (flashModelsCache) return flashModelsCache
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': apiKey } })
    const j = await r.json()
    const ids: string[] = (j.models ?? [])
      .filter((m: any) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m: any) => String(m.name).replace(/^models\//, ''))
      .filter((id: string) => /flash/.test(id) && !/image|tts|audio|live|embedding|thinking|exp/.test(id))
    const ver = (id: string) => parseFloat(id.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? '0')
    flashModelsCache = ids.sort((a, b) => ver(b) - ver(a))
  } catch {
    flashModelsCache = []
  }
  return flashModelsCache
}

/** Llama al modelo elegido; si está saturado, reintenta una vez y luego prueba con otros modelos Flash. */
async function callGemini(system: string, parts: any[], hasImage = false, timeoutOverride?: number): Promise<{ json: any; model: string; latencyMs: number }> {
  const apiKey = await getSetting<string>('apiKey', '')
  if (!apiKey) throw new Error('Falta tu API key de Gemini. Agrégala en Ajustes.')
  const preferred = await getSetting<string>('model', DEFAULT_MODEL)
  // Empieza por el último modelo que respondió bien; sin esperas entre intentos.
  const chain = [...new Set([lastGoodModel(), preferred, ...MODEL_OPTIONS.map((m) => m.id)].filter(Boolean) as string[])]
  const timeoutMs = timeoutOverride ?? (hasImage ? 20000 : 12000)
  const t0 = performance.now()
  let last = { status: 0, msg: '' }
  let extended = false
  try {
    for (let i = 0; i < chain.length && i < 6; i++) {
      const model = chain[i]
      emit({ model, attempt: i + 1, startedAt: t0 })
      const res = await requestOnce(model, apiKey, system, parts, timeoutMs)
      if (res.ok) {
        const text: string = (res.body?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('')
        const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
        try {
          const json = JSON.parse(clean)
          rememberGood(model)
          return { json, model, latencyMs: Math.round(performance.now() - t0) }
        } catch {
          throw new Error('La IA devolvió una respuesta que no se pudo leer. Intenta otra vez.')
        }
      }
      last = { status: res.status, msg: res.msg }
      if (res.status === 0) throw new Error('Sin conexión a internet.')
      const retryable = isOverload(res.status, res.msg) || res.status === 429 || res.status === 404
      if (!retryable) break
      if (i === chain.length - 1 && !extended) {
        extended = true
        for (const m of await availableFlashModels(apiKey)) if (!chain.includes(m)) chain.push(m)
      }
    }
  } finally {
    emit(null)
  }
  if (last.status === 429) throw new Error('Llegaste al límite del plan gratuito de Gemini por ahora. Espera un minuto e inténtalo de nuevo.')
  if (isOverload(last.status, last.msg)) throw new Error('Los modelos de Gemini están saturados o lentos en este momento. Intenta de nuevo en unos minutos.')
  if (last.status === 400 && /API key/i.test(last.msg)) throw new Error('La API key no es válida. Revísala en Ajustes.')
  throw new Error(last.msg)
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
      search_name_en: String(it.search_name_en ?? it.display_name ?? ''),
      per_100g: per100(it.per_100g),
      alternatives: (Array.isArray(it.alternatives) ? it.alternatives : [])
        .filter((a: any) => a && typeof a === 'object' && a.name)
        .slice(0, 3)
        .map((a: any) => ({ name: String(a.name), search_name_en: String(a.search_name_en ?? a.name), per_100g: a.per_100g ? per100(a.per_100g) : undefined })),
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
            search_name_en: o.effect?.search_name_en,
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
  ], true)
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
  ], true)
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

/** Devuelve 'ok' si la key funciona, 'busy' si la key es válida pero el modelo está saturado. */
export async function testKey(apiKey: string, model: string): Promise<'ok' | 'busy'> {
  // Listar modelos valida la key sin gastar cuota ni depender de la carga del modelo.
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': apiKey } })
  if (!r.ok) {
    const e = await r.json().catch(() => null)
    throw new Error(e?.error?.message ?? `Error ${r.status}`)
  }
  const res = await requestOnce(model, apiKey, 'Responde solo con {"ok":true}', [{ text: 'ping' }])
  if (res.ok) return 'ok'
  if (isOverload(res.status, res.msg) || res.status === 429) return 'busy'
  throw new Error(res.msg)
}

// ---------- Coach: plan de entrenamiento y nutrición ----------

export interface CoachPrefs {
  sports: string[]          // gym, correr, bici, natación, …
  days: number[]            // 0 = domingo
  minutes: number           // por sesión
  level: 'principiante' | 'intermedio' | 'avanzado'
  place: 'gimnasio' | 'casa' | 'mixto'
  injuries: string
  mealsPerDay: number
  avoidFoods: string
  notes: string
}

export interface CoachExercise { name: string; sets?: number; reps?: string; rest_s?: number; notes?: string }
export interface CoachSession {
  day: number               // 0 = domingo
  title: string
  type: 'fuerza' | 'correr' | 'bici' | 'natacion' | 'brick' | 'movilidad' | 'descanso' | 'otro'
  duration_min: number
  intensity: string         // p. ej. "Zona 2", "RPE 7", "suave"
  focus?: string
  warmup?: string
  exercises: CoachExercise[]
  cooldown?: string
}
export interface CoachWeek { week: number; theme: string; sessions: CoachSession[] }
export interface CoachMealOption { description: string; kcal: number; protein_g: number; carbs_g: number; fat_g: number }
export interface CoachMeal { name: string; time: string; share_pct: number; options: CoachMealOption[] }
export interface CoachPlan {
  summary: string
  weeks: CoachWeek[]
  nutrition: { training_day: CoachMeal[]; rest_day: CoachMeal[]; tips: string[] }
  progression: string
}

export const COACH_PROMPT = `Eres un entrenador personal certificado y nutricionista deportivo. Diseñas planes realistas, seguros y progresivos para una sola persona, en español neutro de Colombia. Devuelve SOLO un objeto JSON válido con el formato indicado, sin texto fuera del JSON.

ENTRENAMIENTO
1. Plan de 4 semanas: semanas 1–3 con progresión (volumen o intensidad suben poco a poco) y semana 4 de descarga (~30 % menos volumen).
2. Usa SOLO los días disponibles del usuario; los demás días van con type "descanso" o "movilidad" ligera. Respeta los minutos por sesión.
3. Combina los deportes que indique. Si hace triatlón o resistencia: reparte natación, bici y carrera con mayoría de trabajo suave (zona 2) y 1–2 sesiones de calidad por semana; fuerza 2 días.
4. Según el objetivo: definición → mantener fuerza pesada (protege el músculo) y algo más de volumen aeróbico suave; volumen → más series de fuerza por grupo muscular, cardio moderado; recomposición/mantenimiento → equilibrio.
5. Fuerza: 4–7 ejercicios por sesión con series, repeticiones (rango, p. ej. "8-10") y descanso en segundos. Cardio: describe la sesión en exercises (p. ej. {"name":"Calentamiento","notes":"10 min suave"}, {"name":"Bloque principal","notes":"5×4 min zona 4, 2 min suave"}).
6. Adapta a lesiones y nivel. Nada peligroso para un principiante.

NUTRICIÓN
7. Plan de comidas para día de entreno y día de descanso, con el número de comidas indicado, repartiendo las calorías y macros objetivo del contexto (share_pct suma 100 en cada día).
8. Cada comida con 2 opciones con comida colombiana real y cantidades (p. ej. "2 huevos pericos + 1 arepa mediana (80 g) + 1 taza de papaya"), con kcal y macros estimados de esa opción.
9. Evita los alimentos que el usuario no come. Prioriza proteína en todas las comidas. Comida pre y post entreno en días de entreno.
10. 4–6 tips cortos y concretos (hidratación, sueño, timing).

FORMATO
{
  "summary": string,
  "progression": string,
  "weeks": [{ "week": 1, "theme": string, "sessions": [{
     "day": 0-6 (0 = domingo), "title": string,
     "type": "fuerza"|"correr"|"bici"|"natacion"|"brick"|"movilidad"|"descanso"|"otro",
     "duration_min": number, "intensity": string, "focus": string,
     "warmup": string, "exercises": [{ "name": string, "sets": number, "reps": string, "rest_s": number, "notes": string }], "cooldown": string }] }],
  "nutrition": {
    "training_day": [{ "name": string, "time": "HH:MM", "share_pct": number, "options": [{ "description": string, "kcal": number, "protein_g": number, "carbs_g": number, "fat_g": number }] }],
    "rest_day": [ igual ],
    "tips": [string]
  }
}
Cada semana debe tener exactamente 7 sesiones, una por día (0 a 6).`

export async function generateCoachPlan(context: unknown): Promise<{ plan: CoachPlan; model: string }> {
  const { json, model } = await callGemini(COACH_PROMPT, [{ text: `Datos del usuario y metas: ${JSON.stringify(context)}` }], false, 120000)
  const plan = json as CoachPlan
  if (!Array.isArray(plan?.weeks) || !plan.weeks.length || !plan.nutrition) throw new Error('El plan llegó incompleto. Intenta generarlo otra vez.')
  plan.weeks.forEach((w, i) => {
    w.week = w.week ?? i + 1
    w.sessions = (w.sessions ?? []).map((s) => ({ ...s, exercises: Array.isArray(s.exercises) ? s.exercises : [] }))
  })
  plan.nutrition.training_day ??= []
  plan.nutrition.rest_day ??= plan.nutrition.training_day
  plan.nutrition.tips ??= []
  return { plan, model }
}
