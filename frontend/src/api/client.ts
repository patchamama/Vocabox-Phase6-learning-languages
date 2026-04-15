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

export const ollamaApi = {
  getStatus: () => api.get('/ollama/status'),
}
