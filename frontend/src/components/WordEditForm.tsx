/**
 * WordEditForm — shared edit panel used in both Words and Review pages.
 * Loads temas and languages on mount so it works as a self-contained widget.
 * Advanced section: split tool + audio fields (audio_url, audio_text, etc.)
 * LEO button: fetches up to 3 entries from LEO Dictionary and lets the user
 * pick one to auto-fill all fields including audio URLs.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { languagesApi, leoApi, ollamaApi, temasApi, wordTranslationsApi, wordsApi } from '../api/client'
import { playAudio } from '../utils/audioManager'
import { useSettingsStore } from '../stores/settingsStore'
import type { Language, LeoEntry, LeoResult, Tema, WordTranslation } from '../types'
import LanguageSelect from './LanguageSelect'
import TemaSelect from './TemaSelect'

interface SplitResult {
  words: string[]
  meanings: string[]
}

interface OllamaExtraTranslation {
  idioma: string
  texto: string
}

interface OllamaSuggestion {
  palabra?: string
  significado?: string
  category?: string
  extra_translations?: OllamaExtraTranslation[]
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
  audio_url?: string | null
  audio_url_translation?: string | null
  audio_text?: string | null
  audio_text_translation?: string | null
  category?: string | null
  source?: string | null
}

export interface SavedPayload extends Partial<WordData> {
  tema?: Tema | null
}

interface Props {
  word: WordData
  onSaved: (updated: SavedPayload) => void
  onCancel: () => void
  onDeleted?: () => void
}

const CAT_LABELS: Record<string, string> = {
  noun: 'Sustantivo',
  verb: 'Verbo',
  adjective: 'Adjetivo/Adv.',
  phrase: 'Frase',
  prep: 'Preposición',
}

export default function WordEditForm({ word, onSaved, onCancel, onDeleted }: Props) {
  const { t } = useTranslation()
  const { leoAutoFetchExtras, leoExtraLangs, ollamaTranslationModel, ollamaTimeout, ollamaPromptEnhance } = useSettingsStore()
  const [form, setForm] = useState({
    palabra: word.palabra,
    significado: word.significado,
    idioma_origen: word.idioma_origen,
    idioma_destino: word.idioma_destino,
    tema_id: word.tema_id ? String(word.tema_id) : '',
    audio_url: word.audio_url ?? '',
    audio_url_translation: word.audio_url_translation ?? '',
    audio_text: word.audio_text ?? '',
    audio_text_translation: word.audio_text_translation ?? '',
    category: word.category ?? '',
  })
  // Track whether this word's data came from LEO (so we can tag source on save)
  const [filledFromLeo, setFilledFromLeo] = useState(false)
  const [temas, setTemas] = useState<Tema[]>([])
  const [languages, setLanguages] = useState<Language[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [splitChar, setSplitChar] = useState('|')
  const [splitError, setSplitError] = useState<string | null>(null)
  const [splitMsg, setSplitMsg] = useState<string | null>(null)

  // LEO state
  const [leoLoading, setLeoLoading] = useState(false)
  const [leoResults, setLeoResults] = useState<LeoResult | null>(null)
  const [leoError, setLeoError] = useState<string | null>(null)
  const leoRef = useRef<HTMLDivElement>(null)
  const palabraInputRef = useRef<HTMLInputElement>(null)
  const [createFromLeo, setCreateFromLeo] = useState(false)

  // Ollama state
  const [ollamaLoading, setOllamaLoading] = useState(false)
  const [ollamaSuggestion, setOllamaSuggestion] = useState<OllamaSuggestion | null>(null)
  const [ollamaError, setOllamaError] = useState<string | null>(null)
  const [ollamaChecks, setOllamaChecks] = useState<Record<string, boolean>>({})
  const ollamaRef = useRef<HTMLDivElement>(null)

  // Extra translations (multi-language from LEO)
  const [extraTranslations, setExtraTranslations] = useState<WordTranslation[]>([])
  const [extraFetching, setExtraFetching] = useState(false)

  useEffect(() => {
    Promise.all([temasApi.list(), languagesApi.list()]).then(([tRes, lRes]) => {
      setTemas(tRes.data)
      setLanguages(lRes.data)
    })
    // Load existing extra translations in edit mode
    if (word.word_id !== 0) {
      wordTranslationsApi.list(word.word_id).then((res) => {
        setExtraTranslations(res.data)
      }).catch(() => {})
    }
  }, [])

  // Close LEO dropdown on outside click
  useEffect(() => {
    if (!leoResults) return
    const handler = (e: MouseEvent) => {
      if (leoRef.current && !leoRef.current.contains(e.target as Node)) {
        setLeoResults(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [leoResults])

  // Close Ollama panel on outside click
  useEffect(() => {
    if (!ollamaSuggestion && !ollamaError) return
    const handler = (e: MouseEvent) => {
      if (ollamaRef.current && !ollamaRef.current.contains(e.target as Node)) {
        setOllamaSuggestion(null)
        setOllamaError(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [ollamaSuggestion, ollamaError])

  const set = (field: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }))

  const isCreate = word.word_id === 0
  const effectiveIsCreate = isCreate || createFromLeo

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const p = form.palabra.trim()
    const s = form.significado.trim()
    if (!p || !s) return
    setIsSaving(true)
    try {
      const temaId = form.tema_id ? parseInt(form.tema_id) : null
      const payload = {
        palabra: p,
        significado: s,
        idioma_origen: form.idioma_origen,
        idioma_destino: form.idioma_destino,
        tema_id: temaId ?? undefined,
        audio_url: form.audio_url.trim() || null,
        audio_url_translation: form.audio_url_translation.trim() || null,
        audio_text: form.audio_text.trim() || null,
        audio_text_translation: form.audio_text_translation.trim() || null,
        category: form.category.trim() || null,
        source: filledFromLeo ? 'leo' : effectiveIsCreate ? 'manual' : (word.source ?? undefined),
      }
      let savedWordId = word.word_id
      if (effectiveIsCreate) {
        const res = await wordsApi.create(payload)
        savedWordId = res.data.id
      } else {
        await wordsApi.update(word.word_id, payload)
      }
      // Persist extra translations if any
      if (extraTranslations.length > 0 && savedWordId !== 0) {
        await Promise.allSettled(
          extraTranslations.map((tr) =>
            wordTranslationsApi.upsert(savedWordId, {
              idioma: tr.idioma,
              texto: tr.texto,
              audio_url: tr.audio_url,
              audio_text: tr.audio_text,
              source: tr.source ?? 'leo',
            })
          )
        )
      }
      const temaObj = temaId ? (temas.find((t) => t.id === temaId) ?? null) : null
      onSaved({ ...payload, tema_id: temaId, tema: temaObj })
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

  const handleLeoLookup = async () => {
    // Use selected text in the input if present, otherwise full value
    const inputEl = palabraInputRef.current
    let query = form.palabra.trim()
    if (
      inputEl &&
      inputEl.selectionStart !== null &&
      inputEl.selectionEnd !== null &&
      inputEl.selectionStart !== inputEl.selectionEnd
    ) {
      const sel = inputEl.value.slice(inputEl.selectionStart, inputEl.selectionEnd).trim()
      if (sel) query = sel
    }
    if (!query) return
    setLeoLoading(true)
    setLeoError(null)
    setLeoResults(null)
    try {
      const { data } = await leoApi.lookup(query, 'esde', 5)
      if (!data.entries?.length) {
        setLeoError(t('wordEdit.leoNoResults'))
      } else {
        // Sort: entries with both audio tracks come first
        const sorted = [...data.entries].sort((a, b) => {
          const hasAudio = (e: LeoEntry) => {
            const de = e.sides.find((s) => s.lang === 'de') ?? e.sides[1]
            const other = e.sides.find((s) => s.lang !== 'de') ?? e.sides[0]
            return (de?.audio?.length ?? 0) > 0 && (other?.audio?.length ?? 0) > 0
          }
          return (hasAudio(b) ? 1 : 0) - (hasAudio(a) ? 1 : 0)
        })
        setLeoResults({ ...data, entries: sorted })
      }
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      setLeoError(status === 404 ? t('wordEdit.leoNotFound') : t('wordEdit.leoError'))
    } finally {
      setLeoLoading(false)
    }
  }

  const applyLeoEntry = (entry: LeoEntry) => {
    // For esde: sides[0]=es (significado), sides[1]=de (palabra)
    const deSide = entry.sides.find((s) => s.lang === 'de') ?? entry.sides[1]
    const esSide = entry.sides.find((s) => s.lang === 'es') ?? entry.sides[0]
    if (!deSide || !esSide) return

    setForm((f) => ({
      ...f,
      palabra: deSide.text,
      significado: esSide.text,
      audio_url: deSide.audio[0]?.mp3_url ?? '',
      audio_url_translation: esSide.audio[0]?.mp3_url ?? '',
      audio_text: deSide.audio[0]?.label ?? deSide.text,
      audio_text_translation: esSide.audio[0]?.label ?? esSide.text,
      category: entry.category ?? '',
    }))
    setFilledFromLeo(true)
    setLeoResults(null)
    if (!showAdvanced) setShowAdvanced(true)

    // Auto-fetch extra languages if configured
    if (leoAutoFetchExtras && leoExtraLangs.length > 0 && deSide.text) {
      // Filter out idioma_destino (already covered by main translation)
      const langsToFetch = leoExtraLangs.filter((l) => l !== (esSide.lang || 'es'))
      if (langsToFetch.length > 0) {
        setExtraFetching(true)
        leoApi.autoFetchExtras(deSide.text, langsToFetch).then((res) => {
          const fetched = res.data as Array<{ idioma: string; texto: string; audio_url: string | null; audio_text: string | null; found: boolean }>
          setExtraTranslations((prev) => {
            // Merge: keep manually edited ones, replace/add fetched ones
            const merged = [...prev]
            for (const ft of fetched) {
              const idx = merged.findIndex((t) => t.idioma === ft.idioma)
              const entry: WordTranslation = {
                id: 0,
                word_id: word.word_id,
                idioma: ft.idioma,
                texto: ft.texto,
                audio_url: ft.audio_url,
                audio_text: ft.audio_text,
                source: 'leo',
              }
              if (idx >= 0) merged[idx] = entry
              else merged.push(entry)
            }
            return merged
          })
        }).catch(() => {}).finally(() => setExtraFetching(false))
      }
    }
  }

  const applyLeoEntryAsNew = (entry: LeoEntry) => {
    const deSide = entry.sides.find((s) => s.lang === 'de') ?? entry.sides[1]
    const esSide = entry.sides.find((s) => s.lang === 'es') ?? entry.sides[0]
    if (!deSide || !esSide) return
    setForm((f) => ({
      ...f,
      palabra: deSide.text,
      significado: esSide.text,
      audio_url: deSide.audio[0]?.mp3_url ?? '',
      audio_url_translation: esSide.audio[0]?.mp3_url ?? '',
      audio_text: deSide.audio[0]?.label ?? deSide.text,
      audio_text_translation: esSide.audio[0]?.label ?? esSide.text,
      category: entry.category ?? '',
    }))
    setFilledFromLeo(true)
    setCreateFromLeo(true)
    setLeoResults(null)
    if (!showAdvanced) setShowAdvanced(true)
  }

  const handleOllamaEnhance = async () => {
    if (!form.palabra.trim() || !ollamaTranslationModel) return
    setOllamaLoading(true)
    setOllamaError(null)
    setOllamaSuggestion(null)
    try {
      const { data } = await ollamaApi.enhanceWord({
        palabra: form.palabra.trim(),
        significado: form.significado.trim(),
        idioma_origen: form.idioma_origen,
        idioma_destino: form.idioma_destino,
        model: ollamaTranslationModel,
        extra_langs: leoExtraLangs.length > 0 ? leoExtraLangs : undefined,
        timeout: ollamaTimeout,
        prompt_override: ollamaPromptEnhance || undefined,
      })
      setOllamaSuggestion(data)
      const checks: Record<string, boolean> = {}
      if (data.palabra) checks['palabra'] = true
      if (data.significado) checks['significado'] = true
      if (data.category) checks['category'] = true
      data.extra_translations?.forEach((et: OllamaExtraTranslation) => {
        checks[`extra_${et.idioma}`] = true
      })
      setOllamaChecks(checks)
    } catch {
      setOllamaError(t('wordEdit.ollamaError'))
    } finally {
      setOllamaLoading(false)
    }
  }

  const handleApplyOllama = () => {
    if (!ollamaSuggestion) return
    setForm((f) => ({
      ...f,
      ...(ollamaChecks['palabra'] && ollamaSuggestion.palabra ? { palabra: ollamaSuggestion.palabra } : {}),
      ...(ollamaChecks['significado'] && ollamaSuggestion.significado ? { significado: ollamaSuggestion.significado } : {}),
      ...(ollamaChecks['category'] && ollamaSuggestion.category ? { category: ollamaSuggestion.category } : {}),
    }))
    const extrasToApply = (ollamaSuggestion.extra_translations ?? []).filter(
      (et) => ollamaChecks[`extra_${et.idioma}`],
    )
    if (extrasToApply.length > 0) {
      setExtraTranslations((prev) => {
        const merged = [...prev]
        for (const et of extrasToApply) {
          const idx = merged.findIndex((x) => x.idioma === et.idioma)
          const entry: WordTranslation = {
            id: 0,
            word_id: word.word_id,
            idioma: et.idioma,
            texto: et.texto,
            audio_url: null,
            audio_text: null,
            source: 'ollama',
          }
          if (idx >= 0) merged[idx] = entry
          else merged.push(entry)
        }
        return merged
      })
    }
    if (!showAdvanced && (ollamaChecks['category'] || extrasToApply.length > 0)) {
      setShowAdvanced(true)
    }
    setOllamaSuggestion(null)
    setOllamaError(null)
  }

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
        {effectiveIsCreate ? t('wordEdit.titleNew') : t('wordEdit.title')}
      </p>

      {/* ── Word / Meaning row + LEO button ── */}
      <div className="flex gap-2 items-start">
        <div className="grid grid-cols-2 gap-2 flex-1">
          <input
            ref={palabraInputRef}
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

        {/* LEO lookup button */}
        <div className="flex flex-col gap-1.5 shrink-0">
        <div className="relative" ref={leoRef}>
          <button
            type="button"
            title={t('wordEdit.leoLookup')}
            onClick={handleLeoLookup}
            disabled={leoLoading || !form.palabra.trim()}
            className="flex items-center justify-center w-9 h-9 rounded-lg border border-slate-600 bg-slate-800 hover:border-blue-400 hover:bg-slate-700 disabled:opacity-40 transition-colors"
          >
            {leoLoading ? (
              <span className="text-xs text-slate-400 animate-spin">⟳</span>
            ) : (
              <img
                src="https://dict.leo.org/img/svg/leo_esde.svg"
                alt="LEO"
                className="w-5 h-5"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none'
                  ;(e.target as HTMLImageElement).nextElementSibling!.removeAttribute('hidden')
                }}
              />
            )}
            <span hidden className="text-xs font-bold text-blue-400">LEO</span>
          </button>

          {/* LEO results dropdown */}
          {(leoResults || leoError) && (
            <div className="absolute right-0 top-10 z-50 w-80 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl overflow-hidden">
              {leoError && (
                <p className="text-xs text-red-400 p-3">{leoError}</p>
              )}
              {leoResults && (
                <>
                  <div className="px-3 py-2 border-b border-slate-700 text-xs text-slate-400 uppercase tracking-wide">
                    LEO · {leoResults.entries.length} {t('wordEdit.leoSelect')}
                  </div>
                  <div className="divide-y divide-slate-700/50 max-h-72 overflow-y-auto">
                    {leoResults.entries.map((entry, i) => {
                      const deSide = entry.sides.find((s) => s.lang === 'de') ?? entry.sides[1]
                      const esSide = entry.sides.find((s) => s.lang === 'es') ?? entry.sides[0]
                      if (!deSide || !esSide) return null
                      return (
                        <div
                          key={entry.aiid || i}
                          onClick={() => applyLeoEntry(entry)}
                          className="w-full text-left px-3 py-2.5 hover:bg-slate-700/60 transition-colors cursor-pointer"
                        >
                          <div className="flex items-start gap-2">
                            <span className="text-xs bg-slate-700 text-slate-400 rounded px-1.5 py-0.5 shrink-0 mt-0.5">
                              {CAT_LABELS[entry.category] ?? entry.section ?? '—'}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-slate-100 truncate">{deSide.text}</p>
                              <p className="text-xs text-slate-400 truncate">{esSide.text}</p>
                            </div>
                            <div className="shrink-0 flex items-center gap-1 mt-0.5">
                              {deSide.audio.length > 0 && <span title="Audio DE" className="text-blue-400 text-xs">🔊</span>}
                              {esSide.audio.length > 0 && <span title="Audio ES" className="text-green-400 text-xs">🔊</span>}
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); applyLeoEntryAsNew(entry) }}
                                title={t('wordEdit.leoAddNew')}
                                className="text-xs bg-green-900/50 hover:bg-green-600 text-green-400 hover:text-white px-1.5 py-0.5 rounded transition-colors ml-1"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Ollama enhance button */}
        {ollamaTranslationModel && (
          <div className="relative" ref={ollamaRef}>
            <button
              type="button"
              title={t('wordEdit.ollamaEnhance')}
              onClick={handleOllamaEnhance}
              disabled={ollamaLoading || !form.palabra.trim()}
              className="flex items-center justify-center w-9 h-9 rounded-lg border border-slate-600 bg-slate-800 hover:border-purple-400 hover:bg-slate-700 disabled:opacity-40 transition-colors"
            >
              {ollamaLoading ? (
                <span className="text-xs text-slate-400 animate-spin">⟳</span>
              ) : (
                <img
                  src="https://ollama.com/public/ollama.png"
                  alt="Ollama"
                  className="w-5 h-5 rounded"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none'
                    ;(e.target as HTMLImageElement).nextElementSibling!.removeAttribute('hidden')
                  }}
                />
              )}
              <span hidden className="text-xs font-bold text-purple-400">AI</span>
            </button>

            {/* Ollama suggestion panel */}
            {(ollamaSuggestion || ollamaError) && (
              <div className="absolute right-0 top-10 z-50 w-80 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl overflow-hidden">
                {ollamaError && (
                  <p className="text-xs text-red-400 p-3">{ollamaError}</p>
                )}
                {ollamaSuggestion && (
                  <>
                    <div className="px-3 py-2 border-b border-slate-700 text-xs text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
                      <img src="https://ollama.com/public/ollama.png" alt="" className="w-3.5 h-3.5 rounded" />
                      {t('wordEdit.ollamaSuggestions')}
                    </div>
                    <div className="divide-y divide-slate-700/50 max-h-80 overflow-y-auto">
                      {ollamaSuggestion.palabra && (
                        <label className="flex items-start gap-2.5 px-3 py-2.5 hover:bg-slate-700/40 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={ollamaChecks['palabra'] ?? true}
                            onChange={(e) => setOllamaChecks((c) => ({ ...c, palabra: e.target.checked }))}
                            className="mt-0.5 shrink-0 accent-purple-500"
                          />
                          <div className="min-w-0">
                            <p className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">{t('wordEdit.ollamaFieldPalabra')}</p>
                            <p className="text-sm text-slate-100 font-mono break-all">{ollamaSuggestion.palabra}</p>
                          </div>
                        </label>
                      )}
                      {ollamaSuggestion.significado && (
                        <label className="flex items-start gap-2.5 px-3 py-2.5 hover:bg-slate-700/40 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={ollamaChecks['significado'] ?? true}
                            onChange={(e) => setOllamaChecks((c) => ({ ...c, significado: e.target.checked }))}
                            className="mt-0.5 shrink-0 accent-purple-500"
                          />
                          <div className="min-w-0">
                            <p className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">{t('wordEdit.ollamaFieldSignificado')}</p>
                            <p className="text-sm text-slate-100">{ollamaSuggestion.significado}</p>
                          </div>
                        </label>
                      )}
                      {ollamaSuggestion.category && (
                        <label className="flex items-start gap-2.5 px-3 py-2.5 hover:bg-slate-700/40 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={ollamaChecks['category'] ?? true}
                            onChange={(e) => setOllamaChecks((c) => ({ ...c, category: e.target.checked }))}
                            className="mt-0.5 shrink-0 accent-purple-500"
                          />
                          <div className="min-w-0">
                            <p className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">{t('wordEdit.ollamaFieldCategory')}</p>
                            <p className="text-sm text-slate-100">{ollamaSuggestion.category}</p>
                          </div>
                        </label>
                      )}
                      {ollamaSuggestion.extra_translations?.map((et) => (
                        <label key={et.idioma} className="flex items-start gap-2.5 px-3 py-2.5 hover:bg-slate-700/40 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={ollamaChecks[`extra_${et.idioma}`] ?? true}
                            onChange={(e) => setOllamaChecks((c) => ({ ...c, [`extra_${et.idioma}`]: e.target.checked }))}
                            className="mt-0.5 shrink-0 accent-purple-500"
                          />
                          <div className="min-w-0 flex items-center gap-2 flex-1">
                            <span className="text-xs font-mono bg-slate-700 text-slate-300 rounded px-1.5 py-0.5 uppercase shrink-0">
                              {et.idioma}
                            </span>
                            <p className="text-sm text-slate-100 truncate">{et.texto}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                    <div className="px-3 py-2 border-t border-slate-700">
                      <button
                        type="button"
                        onClick={handleApplyOllama}
                        className="w-full py-1.5 text-xs font-medium rounded-lg bg-purple-700 hover:bg-purple-600 text-white transition-colors"
                      >
                        {t('wordEdit.ollamaApply')}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
        </div>
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

      {/* ── Advanced section: split + audio + category ── */}
      {showAdvanced && (
        <div className="border-t border-slate-700/60 pt-3 space-y-3">
          {/* Split tool — only in edit mode */}
          {!effectiveIsCreate && <div className="space-y-2">
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

          {/* Audio + category fields */}
          <div className="space-y-2 border-t border-slate-700/40 pt-2">
            <p className="text-xs text-slate-500 uppercase tracking-wide">
              {t('wordEdit.audioSection')}
            </p>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-slate-500 block mb-0.5">{t('wordEdit.audioUrl')}</label>
                <input
                  type="text"
                  className="input text-xs"
                  placeholder="https://…mp3"
                  value={form.audio_url}
                  onChange={(e) => set('audio_url')(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-0.5">{t('wordEdit.audioUrlTranslation')}</label>
                <input
                  type="text"
                  className="input text-xs"
                  placeholder="https://…mp3"
                  value={form.audio_url_translation}
                  onChange={(e) => set('audio_url_translation')(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-0.5">{t('wordEdit.audioText')}</label>
                <input
                  type="text"
                  className="input text-xs"
                  placeholder={t('wordEdit.audioTextPlaceholder')}
                  value={form.audio_text}
                  onChange={(e) => set('audio_text')(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-0.5">{t('wordEdit.audioTextTranslation')}</label>
                <input
                  type="text"
                  className="input text-xs"
                  placeholder={t('wordEdit.audioTextPlaceholder')}
                  value={form.audio_text_translation}
                  onChange={(e) => set('audio_text_translation')(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-500 block mb-0.5">{t('wordEdit.category')}</label>
              <input
                type="text"
                className="input text-sm"
                placeholder="noun / verb / adjective…"
                value={form.category}
                onChange={(e) => set('category')(e.target.value)}
              />
            </div>

            {/* Audio preview buttons */}
            {(form.audio_url || form.audio_url_translation) && (
              <div className="flex gap-2">
                {form.audio_url && (
                  <button
                    type="button"
                    onClick={() => playAudio(new Audio(form.audio_url!))}
                    className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded-lg transition-colors"
                  >
                    ▶ {t('wordEdit.playWord')}
                  </button>
                )}
                {form.audio_url_translation && (
                  <button
                    type="button"
                    onClick={() => playAudio(new Audio(form.audio_url_translation!))}
                    className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded-lg transition-colors"
                  >
                    ▶ {t('wordEdit.playTranslation')}
                  </button>
                )}
              </div>
            )}

            {/* ── Extra translations (multi-language LEO) ── */}
            {(extraTranslations.length > 0 || extraFetching) && (
              <div className="border-t border-slate-200 dark:border-slate-600 pt-3 space-y-2">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  {t('wordEdit.extraTranslations')}
                  {extraFetching && (
                    <span className="text-blue-400 text-xs animate-pulse">{t('common.loading')}</span>
                  )}
                </p>
                {extraTranslations.map((tr) => (
                  <div key={tr.idioma} className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 rounded-lg p-2">
                    {/* Language badge */}
                    <span className="text-xs font-mono bg-slate-700 text-slate-300 rounded px-1.5 py-0.5 uppercase shrink-0">
                      {tr.idioma}
                    </span>
                    {/* Text */}
                    <input
                      type="text"
                      className="input text-sm flex-1 min-w-0"
                      value={tr.texto}
                      onChange={(e) =>
                        setExtraTranslations((prev) =>
                          prev.map((x) => x.idioma === tr.idioma ? { ...x, texto: e.target.value } : x)
                        )
                      }
                    />
                    {/* Audio URL */}
                    <input
                      type="text"
                      className="input text-xs w-32 shrink-0"
                      placeholder="audio URL"
                      value={tr.audio_url ?? ''}
                      onChange={(e) =>
                        setExtraTranslations((prev) =>
                          prev.map((x) => x.idioma === tr.idioma ? { ...x, audio_url: e.target.value || null } : x)
                        )
                      }
                    />
                    {/* Play button */}
                    {tr.audio_url && (
                      <button
                        type="button"
                        onClick={() => playAudio(new Audio(tr.audio_url!))}
                        className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded transition-colors shrink-0"
                        title={tr.audio_text ?? undefined}
                      >
                        ▶
                      </button>
                    )}
                    {/* Delete */}
                    <button
                      type="button"
                      onClick={async () => {
                        if (word.word_id !== 0 && tr.id !== 0) {
                          await wordTranslationsApi.delete(word.word_id, tr.idioma).catch(() => {})
                        }
                        setExtraTranslations((prev) => prev.filter((x) => x.idioma !== tr.idioma))
                      }}
                      className="text-xs text-red-400 hover:text-red-300 px-1 shrink-0"
                      title={t('common.delete')}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

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
