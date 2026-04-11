/**
 * WordEditForm — shared edit panel used in both Words and Review pages.
 * Loads temas and languages on mount so it works as a self-contained widget.
 */
import { useEffect, useState } from 'react'
import { languagesApi, temasApi, wordsApi } from '../api/client'
import type { Language, Tema } from '../types'
import LanguageSelect from './LanguageSelect'
import TemaSelect from './TemaSelect'

interface WordData {
  word_id: number
  palabra: string
  significado: string
  idioma_origen: string
  idioma_destino: string
  tema_id: number | null
}

interface SavedPayload extends Partial<WordData> {
  tema?: Tema | null  // full tema object so callers can update display name/color
}

interface Props {
  word: WordData
  onSaved: (updated: SavedPayload) => void
  onCancel: () => void
}

export default function WordEditForm({ word, onSaved, onCancel }: Props) {
  const [form, setForm] = useState({
    palabra: word.palabra,
    significado: word.significado,
    idioma_origen: word.idioma_origen,
    idioma_destino: word.idioma_destino,
    tema_id: word.tema_id ? String(word.tema_id) : '',
  })
  const [temas, setTemas] = useState<Tema[]>([])
  const [languages, setLanguages] = useState<Language[]>([])
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    Promise.all([temasApi.list(), languagesApi.list()]).then(([tRes, lRes]) => {
      setTemas(tRes.data)
      setLanguages(lRes.data)
    })
  }, [])

  const set = (field: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const p = form.palabra.trim()
    const s = form.significado.trim()
    if (!p || !s) return
    setIsSaving(true)
    try {
      await wordsApi.update(word.word_id, {
        palabra: p,
        significado: s,
        idioma_origen: form.idioma_origen,
        idioma_destino: form.idioma_destino,
        tema_id: form.tema_id ? parseInt(form.tema_id) : null,
      })
      const temaId = form.tema_id ? parseInt(form.tema_id) : null
      const temaObj = temaId ? (temas.find((t) => t.id === temaId) ?? null) : null
      onSaved({
        palabra: p,
        significado: s,
        idioma_origen: form.idioma_origen,
        idioma_destino: form.idioma_destino,
        tema_id: temaId,
        tema: temaObj,
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card space-y-3 animate-slide-up border-blue-500/30">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-widest">
        Editar palabra
      </p>

      <div className="grid grid-cols-2 gap-2">
        <input
          className="input text-sm"
          placeholder="Palabra (origen)"
          value={form.palabra}
          onChange={(e) => set('palabra')(e.target.value)}
          required
          autoFocus
        />
        <input
          className="input text-sm"
          placeholder="Significado"
          value={form.significado}
          onChange={(e) => set('significado')(e.target.value)}
          required
        />
      </div>

      {languages.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <LanguageSelect
            languages={languages}
            value={form.idioma_origen}
            onChange={set('idioma_origen')}
          />
          <LanguageSelect
            languages={languages}
            value={form.idioma_destino}
            onChange={set('idioma_destino')}
          />
        </div>
      )}

      <TemaSelect
        temas={temas}
        value={form.tema_id}
        onChange={set('tema_id')}
        onTemaCreated={(t) => setTemas((prev) => [...prev, t])}
      />

      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="btn-secondary flex-1 py-2 text-sm">
          Cancelar
        </button>
        <button
          type="submit"
          disabled={isSaving || !form.palabra.trim() || !form.significado.trim()}
          className="btn-primary flex-1 py-2 text-sm"
        >
          {isSaving ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </form>
  )
}
