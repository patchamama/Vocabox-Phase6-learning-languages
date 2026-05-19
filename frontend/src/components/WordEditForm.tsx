/**
 * WordEditForm — shared edit panel used in both Words and Review pages.
 * Loads temas and languages on mount so it works as a self-contained widget.
 * Advanced section: split tool + audio fields (audio_url, audio_text, etc.)
 * LEO button: fetches up to 3 entries from LEO Dictionary and lets the user
 * pick one to auto-fill all fields including audio URLs.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { languagesApi, leoApi, ollamaApi, temasApi, verbformenApi, wordExamplesApi, wordTranslationsApi, wordsApi } from '../api/client'
import type { VerbformenResult, WordExample } from '../api/client'
import { playAudio } from '../utils/audioManager'
import { useSettingsStore } from '../stores/settingsStore'
import { enhanceWordDirect } from '../services/ollamaFrontend'
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

type OllamaSource = 'frontend-ollama' | 'backend-fallback' | 'backend'

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
  onTemaChange?: (temaId: string) => void
}

const CAT_LABELS: Record<string, string> = {
  noun: 'Sustantivo',
  verb: 'Verbo',
  adjective: 'Adjetivo/Adv.',
  phrase: 'Frase',
  prep: 'Preposición',
}

export default function WordEditForm({ word, onSaved, onCancel, onDeleted, onTemaChange }: Props) {
  const { t } = useTranslation()
  const {
    leoAutoFetchExtras, leoExtraLangs, ollamaTranslationModel, useFrontendOllama, ollamaTimeout, ollamaPromptEnhance,
    frontendOllamaUrl, frontendOllamaPort,
  } = useSettingsStore()
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
  const [ollamaSource, setOllamaSource] = useState<OllamaSource | null>(null)
  const ollamaRef = useRef<HTMLDivElement>(null)

  // Extra translations (multi-language from LEO)
  const [extraTranslations, setExtraTranslations] = useState<WordTranslation[]>([])
  const [extraFetching, setExtraFetching] = useState(false)

  // verbformen.de state
  const [vfLoading, setVfLoading] = useState(false)
  const [vfResult, setVfResult] = useState<VerbformenResult | null>(null)
  const [vfError, setVfError] = useState<string | null>(null)
  const [vfChecks, setVfChecks] = useState<{
    palabra: boolean
    audio: boolean
    examples: boolean[]
    translationEn: boolean
    translationEnAudio: boolean
  }>({
    palabra: true,
    audio: true,
    examples: [],
    translationEn: true,
    translationEnAudio: true,
  })
  const [vfVariantIdx, setVfVariantIdx] = useState(0)
  const [vfEnAudio, setVfEnAudio] = useState<{ url: string; text: string } | null>(null)
  const [vfEnAudioLoading, setVfEnAudioLoading] = useState(false)
  const [vfEnAudioTried, setVfEnAudioTried] = useState(false)
  const vfRef = useRef<HTMLDivElement>(null)

  // Local examples editor (id < 0 means new, not yet persisted)
  type LocalExample = { id: number; texto: string; traduccion: string | null; source: string | null; audio_url: string | null }
  const [examples, setExamples] = useState<LocalExample[]>([])
  const [originalExampleIds, setOriginalExampleIds] = useState<number[]>([])
  const nextNegIdRef = useRef(-1)

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
      wordExamplesApi.list(word.word_id).then((res) => {
        const items = res.data as WordExample[]
        setExamples(items.map((e) => ({
          id: e.id,
          texto: e.texto,
          traduccion: e.traduccion,
          source: e.source,
          audio_url: e.audio_url,
        })))
        setOriginalExampleIds(items.map((e) => e.id))
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
        setOllamaSource(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [ollamaSuggestion, ollamaError])

  // Close verbformen panel on outside click
  useEffect(() => {
    if (!vfResult && !vfError) return
    const handler = (e: MouseEvent) => {
      if (vfRef.current && !vfRef.current.contains(e.target as Node)) {
        setVfResult(null)
        setVfError(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [vfResult, vfError])

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
      // Sync examples: delete removed, create new, update existing
      if (savedWordId !== 0) {
        const currentIds = new Set(examples.filter((e) => e.id > 0).map((e) => e.id))
        const toDelete = originalExampleIds.filter((id) => !currentIds.has(id))
        const ops: Promise<unknown>[] = []
        for (const id of toDelete) {
          ops.push(wordExamplesApi.delete(savedWordId, id).catch(() => null))
        }
        examples.forEach((ex, i) => {
          const payload = {
            texto: ex.texto,
            traduccion: ex.traduccion,
            source: ex.source ?? 'manual',
            audio_url: ex.audio_url,
            orden: i,
          }
          if (ex.id < 0) {
            ops.push(wordExamplesApi.create(savedWordId, payload).catch(() => null))
          } else {
            ops.push(wordExamplesApi.update(savedWordId, ex.id, payload).catch(() => null))
          }
        })
        if (ops.length > 0) await Promise.allSettled(ops)
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
    setOllamaSource(null)
    const payload = {
      palabra: form.palabra.trim(),
      significado: form.significado.trim(),
      idioma_origen: form.idioma_origen,
      idioma_destino: form.idioma_destino,
      model: ollamaTranslationModel,
      extra_langs: leoExtraLangs.length > 0 ? leoExtraLangs : undefined,
      timeout: ollamaTimeout,
      prompt_override: ollamaPromptEnhance || undefined,
      base_url: frontendOllamaUrl,
      base_port: frontendOllamaPort,
    }
    try {
      let data: OllamaSuggestion
      if (useFrontendOllama) {
        try {
          data = await enhanceWordDirect(payload) as OllamaSuggestion
          setOllamaSource('frontend-ollama')
        } catch {
          const backend = await ollamaApi.enhanceWord(payload)
          data = backend.data
          setOllamaSource('backend-fallback')
        }
      } else {
        const backend = await ollamaApi.enhanceWord(payload)
        data = backend.data
        setOllamaSource('backend')
      }
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

  const handleVerbformenLookup = async () => {
    const query = form.palabra.trim().split('|')[0].trim()
    if (!query) return
    setVfLoading(true)
    setVfError(null)
    setVfResult(null)
    try {
      const { data } = await verbformenApi.lookup(query)
      setVfResult(data)
      setVfVariantIdx(0)
      setVfChecks({
        palabra: true,
        audio: !!data.audio_url,
        examples: data.examples.map(() => true),
        translationEn: !!data.translation_en,
        translationEnAudio: true,
      })
      setVfEnAudio(null)
      setVfEnAudioTried(false)
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status
      setVfError(status === 404 ? t('wordEdit.vfNotFound') : t('wordEdit.vfError'))
    } finally {
      setVfLoading(false)
    }
  }

  const handleFetchVfEnAudio = async () => {
    if (!vfResult?.translation_en) return
    const lemma = vfResult.lemma || form.palabra.trim().split('|')[0].trim()
    if (!lemma) return
    setVfEnAudioLoading(true)
    setVfEnAudioTried(true)
    try {
      const { data } = await leoApi.autoFetchExtras(lemma, ['en'])
      const en = (data as Array<{ idioma: string; texto: string; audio_url: string | null; audio_text: string | null }>)
        .find((x) => x.idioma === 'en')
      if (en?.audio_url) {
        setVfEnAudio({ url: en.audio_url, text: en.audio_text ?? en.texto })
      } else {
        setVfEnAudio(null)
      }
    } catch {
      setVfEnAudio(null)
    } finally {
      setVfEnAudioLoading(false)
    }
  }

  const handleApplyVerbformen = () => {
    if (!vfResult) return
    const variant = vfResult.stammformen_options?.[vfVariantIdx]
    const palabra = variant?.palabra_formatted ?? vfResult.palabra_formatted
    setForm((f) => ({
      ...f,
      ...(vfChecks.palabra ? { palabra } : {}),
      ...(vfChecks.audio && vfResult.audio_url ? { audio_url: vfResult.audio_url } : {}),
    }))
    const source = vfResult.examples_full ?? vfResult.examples.map((texto) => ({ texto, traduccion: null }))
    const lemmaAudio = vfResult.audio_url ?? null
    const newExamples = source
      .filter((_, i) => vfChecks.examples[i])
      .map<LocalExample>((e) => ({
        id: nextNegIdRef.current--,
        texto: e.texto,
        traduccion: e.traduccion,
        source: 'verbformen',
        audio_url: lemmaAudio,
      }))
    if (newExamples.length > 0) {
      setExamples((prev) => [...prev, ...newExamples])
    }
    // Apply EN translation to extra translations
    if (vfChecks.translationEn && vfResult.translation_en) {
      const useAudio = vfChecks.translationEnAudio && vfEnAudio
      const entry: WordTranslation = {
        id: 0,
        word_id: word.word_id,
        idioma: 'en',
        texto: vfResult.translation_en,
        audio_url: useAudio ? vfEnAudio!.url : null,
        audio_text: useAudio ? vfEnAudio!.text : null,
        source: useAudio ? 'verbformen+leo' : 'verbformen',
      }
      setExtraTranslations((prev) => {
        const merged = [...prev]
        const idx = merged.findIndex((x) => x.idioma === 'en')
        if (idx >= 0) merged[idx] = entry
        else merged.push(entry)
        return merged
      })
    }
    if (!showAdvanced && (vfChecks.audio || newExamples.length > 0 || (vfChecks.translationEn && vfResult.translation_en))) {
      setShowAdvanced(true)
    }
    setVfResult(null)
    setVfError(null)
    setVfEnAudio(null)
    setVfEnAudioTried(false)
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
    setOllamaSource(null)
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

        {/* LEO / Ollama / Verbformen buttons — horizontal row */}
        <div className="flex flex-row gap-1.5 shrink-0">
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
                      {ollamaSource && (
                        <span
                          className={`ml-auto normal-case text-[10px] px-1.5 py-0.5 rounded border ${
                            ollamaSource === 'frontend-ollama'
                              ? 'bg-emerald-900/40 border-emerald-700 text-emerald-300'
                              : ollamaSource === 'backend-fallback'
                                ? 'bg-amber-900/40 border-amber-700 text-amber-300'
                                : 'bg-slate-700/60 border-slate-600 text-slate-300'
                          }`}
                          title={ollamaSource}
                        >
                          {ollamaSource === 'frontend-ollama' ? 'frontend' : ollamaSource === 'backend-fallback' ? 'fallback→backend' : 'backend'}
                        </span>
                      )}
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

        {/* verbformen.de lookup button (German verbs) */}
        {form.idioma_origen === 'de' && (
          <div className="relative" ref={vfRef}>
            <button
              type="button"
              title={t('wordEdit.vfLookup')}
              onClick={handleVerbformenLookup}
              disabled={vfLoading || !form.palabra.trim()}
              className="flex items-center justify-center w-9 h-9 rounded-lg border border-slate-600 bg-slate-800 hover:border-amber-400 hover:bg-slate-700 disabled:opacity-40 transition-colors"
            >
              {vfLoading ? (
                <span className="text-xs text-slate-400 animate-spin">⟳</span>
              ) : (
                <img
                  src="https://www.verbformen.de/favicon.ico"
                  alt="VF"
                  className="w-5 h-5"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none'
                    ;(e.target as HTMLImageElement).nextElementSibling!.removeAttribute('hidden')
                  }}
                />
              )}
              <span hidden className="text-xs font-bold text-amber-400">VF</span>
            </button>

            {(vfResult || vfError) && (
              <div className="absolute right-0 top-10 z-50 w-96 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl overflow-hidden">
                {vfError && <p className="text-xs text-red-400 p-3">{vfError}</p>}
                {vfResult && (
                  <>
                    <div className="px-3 py-2 border-b border-slate-700 text-xs text-slate-400 uppercase tracking-wide flex items-center gap-1.5">
                      <img src="https://www.verbformen.de/favicon.ico" alt="" className="w-3.5 h-3.5" />
                      verbformen · {vfResult.lemma}
                      <a
                        href={vfResult.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-auto normal-case text-[10px] text-blue-400 hover:underline"
                      >
                        ↗
                      </a>
                    </div>
                    <div className="divide-y divide-slate-700/50 max-h-96 overflow-y-auto">
                      {(vfResult.stammformen_options?.length ?? 0) > 1 && (
                        <div className="px-3 py-2 bg-slate-900/40">
                          <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">
                            {t('wordEdit.vfVariantSelect')}
                          </p>
                          <select
                            className="input text-xs w-full"
                            value={vfVariantIdx}
                            onChange={(e) => setVfVariantIdx(parseInt(e.target.value))}
                          >
                            {vfResult.stammformen_options!.map((v, i) => (
                              <option key={i} value={i}>{v.palabra_formatted}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      <label className="flex items-start gap-2.5 px-3 py-2.5 hover:bg-slate-700/40 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={vfChecks.palabra}
                          onChange={(e) => setVfChecks((c) => ({ ...c, palabra: e.target.checked }))}
                          className="mt-0.5 shrink-0 accent-amber-500"
                        />
                        <div className="min-w-0">
                          <p className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">{t('wordEdit.vfFieldPalabra')}</p>
                          <p className="text-sm text-slate-100 font-mono break-words">
                            {vfResult.stammformen_options?.[vfVariantIdx]?.palabra_formatted ?? vfResult.palabra_formatted}
                          </p>
                        </div>
                      </label>
                      {vfResult.audio_url && (
                        <label className="flex items-start gap-2.5 px-3 py-2.5 hover:bg-slate-700/40 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={vfChecks.audio}
                            onChange={(e) => setVfChecks((c) => ({ ...c, audio: e.target.checked }))}
                            className="mt-0.5 shrink-0 accent-amber-500"
                          />
                          <div className="min-w-0 flex items-center gap-2 flex-1">
                            <span className="text-xs text-slate-400 uppercase tracking-wide">{t('wordEdit.vfFieldAudio')}</span>
                            <button
                              type="button"
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); playAudio(new Audio(vfResult.audio_url!)) }}
                              className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-0.5 rounded transition-colors"
                            >
                              ▶
                            </button>
                            <span className="text-[10px] text-slate-500 truncate">{vfResult.audio_url}</span>
                          </div>
                        </label>
                      )}
                      {vfResult.translation_en && (
                        <div className="px-3 py-2.5 bg-slate-900/30 space-y-1.5">
                          <label className="flex items-start gap-2.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={vfChecks.translationEn}
                              onChange={(e) => setVfChecks((c) => ({ ...c, translationEn: e.target.checked }))}
                              className="mt-0.5 shrink-0 accent-amber-500"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs text-slate-400 uppercase tracking-wide mb-0.5 flex items-center gap-1.5">
                                <span className="text-xs font-mono bg-slate-700 text-slate-300 rounded px-1.5 py-0.5 uppercase">EN</span>
                                {t('wordEdit.vfFieldTranslationEn')}
                              </p>
                              <p className="text-sm text-slate-100">{vfResult.translation_en}</p>
                            </div>
                          </label>
                          {vfChecks.translationEn && (
                            <div className="pl-6 flex items-center gap-2 flex-wrap">
                              {!vfEnAudioTried && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleFetchVfEnAudio() }}
                                  disabled={vfEnAudioLoading}
                                  className="text-[11px] bg-blue-900/40 hover:bg-blue-700 text-blue-300 hover:text-white px-2 py-0.5 rounded transition-colors disabled:opacity-40"
                                >
                                  {vfEnAudioLoading ? '⟳ ' + t('common.loading') : '🔊 ' + t('wordEdit.vfFetchEnAudio')}
                                </button>
                              )}
                              {vfEnAudioTried && vfEnAudioLoading && (
                                <span className="text-[11px] text-slate-400 animate-pulse">⟳ {t('common.loading')}</span>
                              )}
                              {vfEnAudioTried && !vfEnAudioLoading && !vfEnAudio && (
                                <span className="text-[11px] text-slate-500 italic">{t('wordEdit.vfEnAudioNotFound')}</span>
                              )}
                              {vfEnAudio && (
                                <>
                                  <label className="flex items-center gap-1.5 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={vfChecks.translationEnAudio}
                                      onChange={(e) => setVfChecks((c) => ({ ...c, translationEnAudio: e.target.checked }))}
                                      className="shrink-0 accent-amber-500"
                                    />
                                    <span className="text-[11px] text-slate-300">{t('wordEdit.vfIncludeEnAudio')}</span>
                                  </label>
                                  <button
                                    type="button"
                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); playAudio(new Audio(vfEnAudio.url)) }}
                                    className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-0.5 rounded transition-colors"
                                  >
                                    ▶
                                  </button>
                                  <span className="text-[10px] text-slate-500 truncate max-w-[150px]">{vfEnAudio.url}</span>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                      {vfResult.examples.length > 0 && (
                        <div className="px-3 py-2">
                          <div className="flex items-center justify-between mb-1.5">
                            <p className="text-xs text-slate-400 uppercase tracking-wide">
                              {t('wordEdit.vfFieldExamples')} ({vfResult.examples.length})
                            </p>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setVfChecks((c) => ({ ...c, examples: vfResult.examples.map(() => true) }))}
                                className="text-[10px] text-slate-400 hover:text-slate-200"
                              >
                                {t('wordEdit.vfSelectAll')}
                              </button>
                              <button
                                type="button"
                                onClick={() => setVfChecks((c) => ({ ...c, examples: vfResult.examples.map(() => false) }))}
                                className="text-[10px] text-slate-400 hover:text-slate-200"
                              >
                                {t('wordEdit.vfSelectNone')}
                              </button>
                            </div>
                          </div>
                          <div className="space-y-1">
                            {(vfResult.examples_full ?? vfResult.examples.map((texto) => ({ texto, traduccion: null }))).map((ex, i) => (
                              <label key={i} className="flex items-start gap-2 cursor-pointer hover:bg-slate-700/30 rounded px-1.5 py-1">
                                <input
                                  type="checkbox"
                                  checked={vfChecks.examples[i] ?? true}
                                  onChange={(e) => setVfChecks((c) => {
                                    const next = [...c.examples]
                                    next[i] = e.target.checked
                                    return { ...c, examples: next }
                                  })}
                                  className="mt-0.5 shrink-0 accent-amber-500"
                                />
                                <div className="min-w-0">
                                  <p className="text-xs text-slate-200 leading-snug">{ex.texto}</p>
                                  {ex.traduccion && (
                                    <p className="text-[10px] text-slate-500 leading-snug italic">{ex.traduccion}</p>
                                  )}
                                </div>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="px-3 py-2 border-t border-slate-700">
                      <button
                        type="button"
                        onClick={handleApplyVerbformen}
                        className="w-full py-1.5 text-xs font-medium rounded-lg bg-amber-700 hover:bg-amber-600 text-white transition-colors"
                      >
                        {t('wordEdit.vfApply')}
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
        onChange={(v) => { set('tema_id')(v); onTemaChange?.(v) }}
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

            {/* ── Examples (verbformen / manual) ── */}
            <div className="border-t border-slate-200 dark:border-slate-600 pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                  {t('wordEdit.examplesSection')} {examples.length > 0 && `(${examples.length})`}
                </p>
                <button
                  type="button"
                  onClick={() => setExamples((prev) => [
                    ...prev,
                    { id: nextNegIdRef.current--, texto: '', traduccion: null, source: 'manual', audio_url: null },
                  ])}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  + {t('wordEdit.exampleAdd')}
                </button>
              </div>
              {examples.length === 0 && (
                <p className="text-xs text-slate-500 italic">{t('wordEdit.examplesEmpty')}</p>
              )}
              {examples.map((ex, i) => (
                <div key={ex.id} className="flex items-start gap-2 bg-slate-50 dark:bg-slate-800 rounded-lg p-2">
                  <span className="text-xs text-slate-500 font-mono mt-1.5 shrink-0">{i + 1}.</span>
                  <div className="flex-1 min-w-0 space-y-1">
                    <input
                      type="text"
                      className="input text-sm w-full"
                      placeholder={t('wordEdit.examplePlaceholder')}
                      value={ex.texto}
                      onChange={(e) =>
                        setExamples((prev) => prev.map((x) => x.id === ex.id ? { ...x, texto: e.target.value } : x))
                      }
                    />
                    <input
                      type="text"
                      className="input text-xs w-full"
                      placeholder={t('wordEdit.exampleTranslationPlaceholder')}
                      value={ex.traduccion ?? ''}
                      onChange={(e) =>
                        setExamples((prev) => prev.map((x) => x.id === ex.id ? { ...x, traduccion: e.target.value || null } : x))
                      }
                    />
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        className="input text-xs flex-1 min-w-0"
                        placeholder={t('wordEdit.exampleAudioPlaceholder')}
                        value={ex.audio_url ?? ''}
                        onChange={(e) =>
                          setExamples((prev) => prev.map((x) => x.id === ex.id ? { ...x, audio_url: e.target.value || null } : x))
                        }
                      />
                      {ex.audio_url && (
                        <button
                          type="button"
                          onClick={() => playAudio(new Audio(ex.audio_url!))}
                          className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded transition-colors shrink-0"
                          title={t('wordEdit.examplePlayAudio')}
                        >
                          ▶
                        </button>
                      )}
                    </div>
                  </div>
                  {ex.source && (
                    <span className="text-[10px] font-mono bg-slate-700 text-slate-400 rounded px-1.5 py-0.5 uppercase mt-1.5 shrink-0">
                      {ex.source}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setExamples((prev) => prev.filter((x) => x.id !== ex.id))}
                    className="text-xs text-red-400 hover:text-red-300 px-1 mt-1.5 shrink-0"
                    title={t('common.delete')}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

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
