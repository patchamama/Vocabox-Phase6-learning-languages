/**
 * WordEditForm — shared edit panel used in both Words and Review pages.
 * Loads temas and languages on mount so it works as a self-contained widget.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { languagesApi, temasApi, wordsApi } from '../api/client'
import type { Language, Tema } from '../types'
import LanguageSelect from './LanguageSelect'
import TemaSelect from './TemaSelect'

interface SplitResult {
  words: string[]
  meanings: string[]
}

function splitByChar(text: string, char: string): string[] {
  return text.split(char).map((s) => s.trim()).filter(Boolean)
}

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
  onDeleted?: () => void
}

export default function WordEditForm({ word, onSaved, onCancel, onDeleted }: Props) {
  const { t } = useTranslation()
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
  const [isDeleting, setIsDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [splitChar, setSplitChar] = useState('|')
  const [splitError, setSplitError] = useState<string | null>(null)
  const [splitMsg, setSplitMsg] = useState<string | null>(null)

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

  const handleSplit = async () => {
    setSplitError(null)
    setSplitMsg(null)
    const char = splitChar.trim()
    if (!char) return
    const words = splitByChar(form.palabra, char)
    const meanings = splitByChar(form.significado, char)
    if (words.length !== meanings.length) {
      setSplitError(t('wordEdit.splitMismatch', { words: words.length, meanings: meanings.length }))
      return
    }
    if (words.length < 2) return
    setIsSaving(true)
    try {
      const temaId = form.tema_id ? parseInt(form.tema_id) : null
      const results = await Promise.allSettled(
        words.map((palabra, i) =>
          wordsApi.create({
            palabra,
            significado: meanings[i],
            idioma_origen: form.idioma_origen,
            idioma_destino: form.idioma_destino,
            ...(temaId ? { tema_id: temaId } : {}),
          })
        )
      )
      const created = results.filter((r) => r.status === 'fulfilled').length
      const skipped = results.length - created
      const msg = skipped > 0
        ? t('wordEdit.splitSuccess', { count: created }) + ' ' + t('wordEdit.splitSkipped', { count: skipped })
        : t('wordEdit.splitSuccess', { count: created })
      setSplitMsg(msg)
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return }
    setIsDeleting(true)
    try {
      await wordsApi.delete(word.word_id)
      onDeleted?.()
    } finally {
      setIsDeleting(false)
      setConfirmDelete(false)
    }
  }

  // Preview split result for validation feedback
  const splitPreview: SplitResult | null = (() => {
    const char = splitChar.trim()
    if (!char) return null
    const words = splitByChar(form.palabra, char)
    const meanings = splitByChar(form.significado, char)
    if (words.length < 2) return null
    return { words, meanings }
  })()

  return (
    <form onSubmit={handleSubmit} className="card space-y-3 animate-slide-up border-blue-500/30">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-widest">
        {t('wordEdit.title')}
      </p>

      <div className="grid grid-cols-2 gap-2">
        <input
          className="input text-sm"
          placeholder={t('wordEdit.wordOrigin')}
          value={form.palabra}
          onChange={(e) => set('palabra')(e.target.value)}
          required
          autoFocus
        />
        <input
          className="input text-sm"
          placeholder={t('wordEdit.meaning')}
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

      {/* ── Advanced toggle ── */}
      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1 transition-colors"
      >
        <span>{showAdvanced ? '▾' : '▸'}</span>
        {t('wordEdit.advanced')}
      </button>

      {/* ── Split section ── */}
      {showAdvanced && <div className="border-t border-slate-700/60 pt-3 space-y-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            className="input text-sm w-16 text-center font-mono"
            value={splitChar}
            onChange={(e) => { setSplitChar(e.target.value); setSplitError(null); setSplitMsg(null) }}
            placeholder={t('wordEdit.splitChar')}
            maxLength={3}
          />
          <span className="text-xs text-slate-500 flex-1">{t('wordEdit.splitChar')}</span>
          <button
            type="button"
            disabled={isSaving || !splitChar.trim() || !splitPreview || splitPreview.words.length < 2}
            onClick={handleSplit}
            className="btn-secondary py-1.5 px-3 text-sm"
          >
            {isSaving ? t('wordEdit.splitCreating', { count: splitPreview?.words.length ?? 0 }) : t('wordEdit.splitBtn')}
          </button>
        </div>

        {splitPreview && !splitError && !splitMsg && (
          <div className="text-xs text-slate-500 space-y-0.5">
            {splitPreview.words.map((w, i) => (
              <div key={i} className={`flex gap-1 ${splitPreview.meanings[i] === undefined ? 'text-red-400' : ''}`}>
                <span className="text-slate-400">{i + 1}.</span>
                <span>{w}</span>
                <span className="text-slate-600">→</span>
                <span>{splitPreview.meanings[i] ?? '?'}</span>
              </div>
            ))}
          </div>
        )}

        {splitError && <p className="text-xs text-red-400">{splitError}</p>}
        {splitMsg && <p className="text-xs text-green-400">{splitMsg}</p>}
      </div>}

      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="btn-secondary py-2 text-sm px-3">
          {t('wordEdit.cancel')}
        </button>
        {onDeleted && (
          <button
            type="button"
            disabled={isDeleting || isSaving}
            onClick={handleDelete}
            onBlur={() => setConfirmDelete(false)}
            className={`py-2 text-sm px-3 rounded-lg font-medium transition-colors ${
              confirmDelete
                ? 'bg-red-600 text-white'
                : 'bg-red-900/40 text-red-400 hover:bg-red-600 hover:text-white'
            }`}
          >
            {isDeleting ? t('wordEdit.deleting') : confirmDelete ? t('wordEdit.deleteConfirm') : t('wordEdit.deleteBtn')}
          </button>
        )}
        <button
          type="submit"
          disabled={isSaving || !form.palabra.trim() || !form.significado.trim()}
          className="btn-primary flex-1 py-2 text-sm"
        >
          {isSaving ? t('wordEdit.saving') : t('wordEdit.save')}
        </button>
      </div>
    </form>
  )
}
