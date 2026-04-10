import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
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
      window.location.href = '/login'
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

export const wordsApi = {
  list: (tema_id?: number) => api.get('/words', { params: { tema_id } }),
  create: (data: {
    palabra: string
    significado: string
    idioma_origen: string
    idioma_destino: string
    tema_id?: number
  }) => api.post('/words', data),
  update: (id: number, data: {
    palabra?: string
    significado?: string
    idioma_origen?: string
    idioma_destino?: string
    tema_id?: number | null
  }) => api.put(`/words/${id}`, data),
  delete: (id: number) => api.delete(`/words/${id}`),
  deleteAll: () => api.delete('/words/all'),
  exportCsv: () => api.get('/words/export', { responseType: 'blob' }),
  myWords: () => api.get('/words/my'),
}

export const languagesApi = {
  list: () => api.get('/languages'),
}

export const reviewApi = {
  getReview: (limit = 20) => api.get('/review', { params: { limit } }),
  submitAnswer: (user_word_id: number, correct: boolean) =>
    api.post('/review/answer', { user_word_id, correct }),
}

export const statsApi = {
  get: () => api.get('/stats'),
}

export const temasApi = {
  list: () => api.get('/temas'),
  create: (nombre: string, color: string) => api.post('/temas', { nombre, color }),
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
  confirm: (rows: ImportRowPreview[], tema_id?: number) =>
    api.post('/import/confirm', { rows, tema_id }),
}
