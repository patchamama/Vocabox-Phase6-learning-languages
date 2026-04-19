import axios from 'axios'

const api = axios.create({
  baseURL: `${import.meta.env.BASE_URL}api`,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.href = `${import.meta.env.BASE_URL}login`
    }
    return Promise.reject(err)
  }
)

export default api

export const authApi = {
  login: (username: string, password: string) =>
    api.post('/auth/login', { username, password }),
  register: (username: string, email: string, password: string) =>
    api.post('/auth/register', { username, email, password }),
  me: () => api.get('/auth/me'),
}

export interface WordFields {
  palabra?: string
  significado?: string
  idioma_origen?: string
  idioma_destino?: string
  tema_id?: number | null
  audio_url?: string | null
  audio_url_translation?: string | null
  audio_text?: string | null
  audio_text_translation?: string | null
  category?: string | null
  source?: string | null
}

export const wordsApi = {
  list: (tema_id?: number) => api.get('/words', { params: { tema_id } }),
  create: (data: WordFields & { palabra: string; significado: string; idioma_origen: string; idioma_destino: string }) =>
    api.post('/words', data),
  update: (id: number, data: WordFields) => api.put(`/words/${id}`, data),
  delete: (id: number) => api.delete(`/words/${id}`),
  deleteAll: () => api.delete('/words/all'),
  exportCsv: () => api.get('/words/export', { responseType: 'blob' }),
  myWords: () => api.get('/words/my'),
  categories: () => api.get<string[]>('/words/categories'),
  bulkAssignTema: (wordIds: number[], temaId: number | null) =>
    api.post('/words/bulk-tema', { word_ids: wordIds, tema_id: temaId }),
}

export const languagesApi = {
  list: () => api.get('/languages'),
}

export const reviewApi = {
  getReview: (limit = 20, boxes?: number[], wordsOnly?: boolean) =>
    api.get('/review', {
      params: {
        limit,
        ...(boxes && boxes.length < 7 ? { boxes: boxes.join(',') } : {}),
        ...(wordsOnly ? { words_only: true } : {}),
      },
    }),
  submitAnswer: (user_word_id: number, correct: boolean) =>
    api.post('/review/answer', { user_word_id, correct }),
}

export const statsApi = {
  get: (wordsOnly = false) => api.get('/stats', { params: wordsOnly ? { words_only: true } : {} }),
}

export const temasApi = {
  list: () => api.get('/temas'),
  create: (nombre: string, color: string) => api.post('/temas', { nombre, color }),
  update: (id: number, nombre: string, color: string) => api.put(`/temas/${id}`, { nombre, color }),
  delete: (id: number) => api.delete(`/temas/${id}`),
}

export const testApi = {
  simulate: () => api.post('/test/simulate'),
  reset: () => api.post('/test/reset'),
}

import type { ImportRowPreview } from '../types'

export const importApi = {
  preview: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return api.post('/import/preview', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  pdfPreview: (file: File, srcLang = 'de', tgtLang = 'es') => {
    const form = new FormData()
    form.append('file', file)
    return api.post('/import/pdf-preview', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      params: { src_lang: srcLang, tgt_lang: tgtLang },
    })
  },
  confirm: (rows: ImportRowPreview[], tema_id?: number) =>
    api.post('/import/confirm', { rows, tema_id }),
}

export const leoApi = {
  lookup: (word: string, lp = 'esde', results = 5) =>
    api.get('/leo/lookup', { params: { word, lp, results } }),
  autoFetchExtras: (word: string, extraLangs: string[]) =>
    api.post('/leo/auto-fetch-extras', { word, extra_langs: extraLangs }),
}

export const wordTranslationsApi = {
  list: (wordId: number) => api.get(`/words/${wordId}/translations`),
  upsert: (wordId: number, data: { idioma: string; texto: string; audio_url?: string | null; audio_text?: string | null; source?: string }) =>
    api.post(`/words/${wordId}/translations`, data),
  delete: (wordId: number, idioma: string) =>
    api.delete(`/words/${wordId}/translations/${idioma}`),
}

export const audioReviewApi = {
  generate: (
    wordIds: number[],
    order: string,
    gapSeconds: number,
    beep: boolean,
    useTts = false,
    includeTtsWords = false,
    ttsVoices: Record<string, string> = {},
    ttsRate = 1.0,
    extraLanguages: string[] = [],
    ollamaModel = '',
    completeWithTts = true,
    ollamaTimeout = 60,
    ollamaPromptTranslate = '',
  ) =>
    api.post('/audio-review/generate', {
      word_ids: wordIds,
      order,
      gap_seconds: gapSeconds,
      beep,
      use_tts: useTts,
      include_tts_words: includeTtsWords,
      tts_voices: ttsVoices,
      tts_rate: ttsRate,
      extra_languages: extraLanguages,
      ollama_model: ollamaModel,
      complete_with_tts: completeWithTts,
      ollama_timeout: ollamaTimeout,
      ollama_prompt_translate: ollamaPromptTranslate,
    }),
  list: () => api.get('/audio-review/list'),
  getFile: (filename: string) =>
    api.get(`/audio-review/file/${encodeURIComponent(filename)}`, { responseType: 'blob' }),
  getSrt: (filename: string) =>
    api.get(`/audio-review/srt/${encodeURIComponent(filename)}`, { responseType: 'text' }),
  deleteFile: (filename: string) =>
    api.delete(`/audio-review/file/${encodeURIComponent(filename)}`),
  getVoices: () => api.get('/audio-review/voices'),
  previewVoice: (lang: string, voice: string, rate: number, text?: string) =>
    api.post(
      '/audio-review/voices/preview',
      { lang, voice, rate, text },
      { responseType: 'blob' },
    ),
  getTtsFilters: (lang: string) => api.get(`/audio-review/tts-filters/${lang}`),
  putTtsFilters: (lang: string, content: string) => api.put(`/audio-review/tts-filters/${lang}`, { content }),
  deleteTtsFilters: (lang: string) => api.delete(`/audio-review/tts-filters/${lang}`),
}

import type { SegmentContext, SegmentRef, SubtitleFile, SubtitleSearchResult, WordVideoRef } from '../types'

export const subtitlesApi = {
  upload: (file: File, youtubeId?: string, language?: string) => {
    const form = new FormData()
    form.append('file', file)
    if (youtubeId) form.append('youtube_id', youtubeId)
    if (language) form.append('language', language)
    return api.post<SubtitleFile>('/subtitles/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  list: () => api.get<SubtitleFile[]>('/subtitles'),
  delete: (id: number) => api.delete(`/subtitles/${id}`),
  deleteAllRefs: () => api.delete('/subtitles/all-refs'),
  startReindex: (params?: {
    minRefs?: number
    maxRefs?: number
    usePalabra?: boolean
    useAudioText?: boolean
    useSignificado?: boolean
  }) =>
    api.post<{ job_id: string }>('/subtitles/reindex', {
      min_refs: params?.minRefs ?? 0,
      max_refs: params?.maxRefs ?? 0,
      use_palabra: params?.usePalabra ?? true,
      use_audio_text: params?.useAudioText ?? true,
      use_significado: params?.useSignificado ?? true,
    }),
  getRefs: (wordId: number) => api.get<WordVideoRef[]>(`/subtitles/refs/${wordId}`),
  getWordIdsWithRefs: () => api.get<{ refs: { word_id: number; count: number }[] }>('/subtitles/word-ids-with-refs'),
  getSegmentContext: (segmentId: number, before: number, after: number) =>
    api.get<SegmentContext>(`/subtitles/segment-context/${segmentId}`, { params: { before, after } }),
  getFileRefCounts: () =>
    api.get<{ file_id: number; count: number }[]>('/subtitles/file-ref-counts'),
  searchSegments: (q: string, limit = 30) =>
    api.get<SubtitleSearchResult>('/subtitles/search', { params: { q, limit } }),
  /** Convenience: convert SegmentRef[] from search into WordVideoRef[] for VideoRefsModal */
  segmentsToVideoRefs: (segs: SegmentRef[]): WordVideoRef[] =>
    segs.map((seg, i) => ({ id: -(i + 1), word_id: 0, segment_id: seg.id, segment: seg })),
}

export const ollamaApi = {
  getStatus: () => api.get('/ollama/status'),
  getDefaultPrompts: () => api.get<{ translate: string; enhance: string }>('/ollama/default-prompts'),
  enhanceWord: (data: {
    palabra: string
    significado: string
    idioma_origen: string
    idioma_destino: string
    model: string
    extra_langs?: string[]
    timeout?: number
    prompt_override?: string
  }) => api.post('/ollama/enhance-word', data),
}

export interface GrammarSegment {
  t: 'text' | 'blank'
  v?: string
  id?: number
  options?: string[]
  correct?: number
  rule?: string
}

export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | ''

export interface GrammarExerciseData {
  title: string
  topic: string
  segments: GrammarSegment[]
  grammar_notes: string[]
  vocabulary_used: string[]
  description?: string | null
  cefr_level?: CefrLevel | null
  grammar_focus?: string[]
}

export interface SavedGrammarExercise extends GrammarExerciseData {
  id: number
  user_id: number
  language: string
  interface_lang: string
  score_correct: number | null
  score_total: number | null
  cefr_level: CefrLevel
  description: string | null
  is_global: boolean
  original_exercise_id: number | null
  grammar_focus: string[]
  share_token: string | null
  created_at: string
  last_attempted: string | null
}

export interface ExtraGrammarCategory {
  key: string
  labels: { es: string; en: string; de: string; fr: string }
}

export const grammarApi = {
  getExtraGrammarCategories: () => api.get<ExtraGrammarCategory[]>('/grammar/extra-grammar-categories'),

  generate: (data: {
    topic: string
    interface_lang: string
    grammar_focus: string[]
    vocabulary: string[]
    model: string
    timeout?: number
    custom_prompt?: string
    temperature?: number
    num_predict?: number
    top_p?: number
    mode?: 'two_phase' | 'rolling' | 'custom'
    rolling_sentences?: number
    prose_override?: string
    double_correct?: boolean
    max_blanks?: number
    cefr_level?: string
    force_extra_grammar?: boolean
    extra_grammar_categories?: string[]
    max_blanks_per_sentence?: number
  }) => api.post<GrammarExerciseData>('/grammar/generate', data),

  checkProse: (data: {
    text: string
    interface_lang: string
    model: string
    timeout?: number
  }) => api.post<{ feedback: string }>('/grammar/check-prose', data),

  suggestTopics: (data: { interface_lang: string; model: string; timeout?: number }) =>
    api.post<{ topics: string[] }>('/grammar/suggest-topics', data),

  getDefaultPrompt: (mode?: string) => api.get<{ prompt: string }>('/grammar/default-prompt', { params: mode ? { mode } : {} }),

  saveExercise: (data: {
    title: string
    topic: string
    language?: string
    interface_lang?: string
    segments_json: string
    grammar_notes_json?: string
    vocabulary_used_json?: string
    grammar_focus_json?: string
    score_correct?: number
    score_total?: number
    cefr_level?: string
    description?: string
    is_global?: boolean
  }) => api.post<SavedGrammarExercise>('/grammar/exercises', data),

  listExercises: (filter?: 'all' | 'private' | 'global') =>
    api.get<SavedGrammarExercise[]>('/grammar/exercises', { params: filter ? { filter } : {} }),

  exploreExercises: (params?: { search?: string; cefr_level?: string; language?: string }) =>
    api.get<SavedGrammarExercise[]>('/grammar/exercises/explore', { params }),

  adoptExercise: (id: number) =>
    api.post<SavedGrammarExercise>(`/grammar/exercises/${id}/adopt`),

  getExercise: (id: number) => api.get<SavedGrammarExercise>(`/grammar/exercises/${id}`),

  updateMeta: (id: number, data: { title?: string; description?: string; cefr_level?: string; is_global?: boolean }) =>
    api.patch<SavedGrammarExercise>(`/grammar/exercises/${id}/meta`, data),

  updateScore: (id: number, correct: number, total: number) =>
    api.patch(`/grammar/exercises/${id}/score`, { correct, total }),

  deleteExercise: (id: number) => api.delete(`/grammar/exercises/${id}`),

  generateShareToken: (id: number) => api.post<{ share_token: string }>(`/grammar/exercises/${id}/share-token`),

  getByToken: (token: string) => api.get<SavedGrammarExercise>(`/grammar/share/${token}`),

  injectExtra: (id: number, data: { allowed_categories?: string[]; max_blanks_per_sentence?: number; max_extra?: number }) =>
    api.post<SavedGrammarExercise>(`/grammar/exercises/${id}/inject-extra`, data),
}

// ── Grammar Queue ─────────────────────────────────────────────────────────────

export type GrammarQueueStatus =
  | 'pending'
  | 'generating'
  | 'grammar_check'
  | 'ready'
  | 'error'
  | 'grammar_error'

export interface GrammarQueueItem {
  id: number
  status: GrammarQueueStatus
  position: number
  params: Record<string, unknown>
  exercise_id: number | null
  grammar_check_enabled: boolean
  grammar_check_feedback: string | null
  error_message: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

export interface GrammarQueueAddRequest {
  topic: string
  interface_lang: string
  grammar_focus: string[]
  vocabulary: string[]
  model: string
  timeout?: number
  custom_prompt?: string
  temperature?: number
  num_predict?: number
  top_p?: number
  mode?: string
  rolling_sentences?: number
  prose_override?: string
  double_correct?: boolean
  max_blanks?: number
  grammar_check_enabled?: boolean
  cefr_level?: string
  is_global?: boolean
  force_extra_grammar?: boolean
  extra_grammar_categories?: string[]
  max_blanks_per_sentence?: number
}

export const grammarQueueApi = {
  add: (data: GrammarQueueAddRequest) =>
    api.post<GrammarQueueItem>('/grammar/queue', data),

  list: () =>
    api.get<{ items: GrammarQueueItem[]; worker_running: boolean }>('/grammar/queue'),

  delete: (id: number) => api.delete(`/grammar/queue/${id}`),

  resume: () => api.post<{ started: boolean }>('/grammar/queue/resume'),

  stop: () => api.post<{ stopped: boolean }>('/grammar/queue/stop'),
}

// ── AI Providers ──────────────────────────────────────────────────────────────

export interface AIProviderInfo {
  id: number
  name: string
  provider_type: string   // ollama / openai / anthropic / gemini / azure / openai_compat
  has_api_key: boolean
  base_url: string | null
  model_name: string
  is_active: boolean
  created_at: string | null
}

export interface AIProviderCreate {
  name: string
  provider_type: string
  api_key?: string
  base_url?: string
  model_name: string
  is_active?: boolean
}

export const aiProvidersApi = {
  list: () => api.get<AIProviderInfo[]>('/ai-providers'),
  active: () => api.get<AIProviderInfo | null>('/ai-providers/active'),
  create: (data: AIProviderCreate) => api.post<AIProviderInfo>('/ai-providers', data),
  update: (id: number, data: Partial<AIProviderCreate>) => api.put<AIProviderInfo>(`/ai-providers/${id}`, data),
  delete: (id: number) => api.delete(`/ai-providers/${id}`),
  activate: (id: number) => api.post<AIProviderInfo>(`/ai-providers/${id}/activate`),
  deactivate: (id: number) => api.post<AIProviderInfo>(`/ai-providers/${id}/deactivate`),
  test: (id: number) => api.post<{ ok: boolean; provider_type: string; model: string }>(`/ai-providers/${id}/test`),
}

// ── User Settings ─────────────────────────────────────────────────────────────

export const userSettingsApi = {
  get: () => api.get<Record<string, unknown>>('/user-settings'),
  save: (settings: Record<string, unknown>) => api.put('/user-settings', { settings }),
}
