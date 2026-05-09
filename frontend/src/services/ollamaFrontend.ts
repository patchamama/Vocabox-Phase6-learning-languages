const OLLAMA_BASE = 'http://localhost:11434'

type OllamaTagsResponse = {
  models?: Array<{ name?: string }>
}

export async function listLocalOllamaModels(): Promise<string[]> {
  const resp = await fetch(`${OLLAMA_BASE}/api/tags`)
  if (!resp.ok) throw new Error(`ollama_http_${resp.status}`)
  const data = await resp.json() as OllamaTagsResponse
  return (data.models ?? [])
    .map((m) => String(m.name ?? '').trim())
    .filter(Boolean)
}

const LANG_NAMES: Record<string, string> = {
  de: 'German',
  es: 'Spanish',
  en: 'English',
  fr: 'French',
  it: 'Italian',
  pt: 'Portuguese',
  nl: 'Dutch',
  ru: 'Russian',
  ja: 'Japanese',
  zh: 'Chinese',
  ko: 'Korean',
  pl: 'Polish',
  sv: 'Swedish',
  tr: 'Turkish',
  ar: 'Arabic',
}

const DEFAULT_PROMPT_ENHANCE = `You are an expert multilingual linguist and vocabulary teacher.

Analyze the vocabulary entry below and return a JSON object with corrections and enrichments.

Source word ({src_lang}): {word}
Current translation ({dst_lang}): {translation}

Return a JSON object with EXACTLY these fields:
- "palabra": The corrected and enriched source word in {src_lang}. Rules:
  * German nouns: add the definite article (der/die/das) in nominative if missing; capitalize the noun.
  * French/Italian/Spanish/Portuguese nouns: add the definite article if it is natural.
  * After the corrected word, append " | " followed by: word type in {src_lang} | plural form (if noun) | one brief context word.
  * Examples: "der Hund | Substantiv | die Hunde | Tier", "le chien | nom | les chiens | animal", "laufen | Verb | läuft, lief, gelaufen"
  * For non-noun verbs or adjectives: skip plural, include conjugation hints or forms instead.
  * Keep the total short.
- "significado": The best translation in {dst_lang}. For nouns, include the definite article if natural in {dst_lang}. One word or short phrase only.
- "category": Exactly one of: noun, verb, adjective, phrase, prep, adverb
{extra_field}
Return ONLY a valid JSON object. No markdown code blocks, no explanations, no extra text.`

class SafeDict {
  private readonly data: Record<string, string>
  constructor(data: Record<string, string>) {
    this.data = data
  }
  get(key: string): string {
    return this.data[key] ?? `{${key}}`
  }
}

function formatTemplate(template: string, values: Record<string, string>): string {
  const safe = new SafeDict(values)
  return template.replace(/\{([^{}]+)\}/g, (_, key: string) => safe.get(key))
}

function buildEnhancePrompt(params: {
  palabra: string
  significado: string
  idioma_origen: string
  idioma_destino: string
  extra_langs?: string[]
  prompt_override?: string
}): string {
  const srcName = LANG_NAMES[params.idioma_origen.slice(0, 2)] ?? params.idioma_origen
  const dstName = LANG_NAMES[params.idioma_destino.slice(0, 2)] ?? params.idioma_destino
  const extraField = (params.extra_langs && params.extra_langs.length > 0)
    ? `- "extra_translations": Array of objects with "idioma" (language code) and "texto" (translation in that language, include definite article if natural). Provide translations for: ${params.extra_langs.map((l) => `${LANG_NAMES[l.slice(0, 2)] ?? l} (${l})`).join(', ')}`
    : '- "extra_translations": []'
  const template = params.prompt_override?.trim() ? params.prompt_override : DEFAULT_PROMPT_ENHANCE
  return formatTemplate(template, {
    word: params.palabra,
    translation: params.significado,
    src_lang: srcName,
    dst_lang: dstName,
    extra_field: extraField,
  })
}

function stripCodeFences(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

export interface OllamaEnhancePayload {
  palabra: string
  significado: string
  idioma_origen: string
  idioma_destino: string
  model: string
  extra_langs?: string[]
  timeout?: number
  prompt_override?: string
}

export async function enhanceWordDirect(payload: OllamaEnhancePayload): Promise<unknown> {
  const prompt = buildEnhancePrompt(payload)
  const controller = new AbortController()
  const ms = Math.max(10, Math.min(900, payload.timeout ?? 60)) * 1000
  const timer = window.setTimeout(() => controller.abort(), ms)
  try {
    const resp = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: payload.model,
        prompt,
        stream: false,
        options: { temperature: 0.1, top_p: 0.9, num_predict: 200 },
      }),
    })
    if (!resp.ok) throw new Error(`ollama_http_${resp.status}`)
    const data = await resp.json() as { response?: string }
    const raw = stripCodeFences(String(data.response ?? ''))
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('ollama_no_json')
    return JSON.parse(match[0])
  } finally {
    window.clearTimeout(timer)
  }
}
