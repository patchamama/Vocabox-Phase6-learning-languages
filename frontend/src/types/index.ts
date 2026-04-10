export interface User {
  id: number
  username: string
  email: string
}

export interface Tema {
  id: number
  nombre: string
  color: string
}

export interface Word {
  id: number
  palabra: string
  significado: string
  idioma_origen: string
  idioma_destino: string
  tema_id: number | null
  audio_url: string | null
  tema: Tema | null
}

export interface UserWord {
  id: number
  word: Word
  box_level: number
  next_review_date: string
  last_reviewed: string | null
}

export interface ReviewWord {
  user_word_id: number
  word_id: number
  palabra: string
  significado: string
  idioma_origen: string
  idioma_destino: string
  box_level: number
  audio_url: string | null
  exercise_type: 'write' | 'multiple_choice'
  choices: string[] | null
  tema_nombre: string | null
}

export interface ImportRowPreview {
  palabra: string
  significado: string
  idioma_origen: string
  idioma_destino: string
  is_duplicate: boolean
  box_level?: number | null
  next_review_date?: string | null
}

export interface ImportPreview {
  rows: ImportRowPreview[]
  total: number
  new_count: number
  duplicate_count: number
  source_lang: string
  target_lang: string
  source_code: string
  target_code: string
}

export interface ImportResult {
  imported: number
  skipped: number
}

export interface Language {
  code: string
  name_es: string | null
  name_en: string | null
}

export interface BoxStats {
  box: number
  count: number
  pending_today: number
}

export interface Stats {
  total_words: number
  pending_today: number
  streak: number
  accuracy: number
  boxes: BoxStats[]
}
