import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getLastErrors } from './Review'
import { useTranslation } from 'react-i18next'
import { subtitlesApi, temasApi, wordsApi } from '../api/client'
import AudioReviewPanel from '../components/AudioReviewPanel'
import SpeakButton from '../components/SpeakButton'
import VideoRefsModal from '../components/VideoRefsModal'
import WordDrillModal from '../components/WordDrillModal'
import GrammarSession from '../components/GrammarSession'
import WordEditForm from '../components/WordEditForm'
import { useSettingsStore } from '../stores/settingsStore'
import { useUserProfileStore } from '../stores/userProfileStore'
import type { ReviewWord } from '../types'
import type { TipLang } from '../data/germanGrammarTips'
import { playAudio, speakUtterance } from '../utils/audioManager'
import type { SavedPayload } from '../components/WordEditForm'
import type { Tema, UserWord, Word, WordVideoRef } from '../types'

// ── WordCard ──────────────────────────────────────────────────────────────────
// Shared between list mode and flashcard revealed state.
// onCollapse: only passed in flashcard mode — shows ✕ to collapse instead of delete.
interface WordCardProps {
  uw: UserWord
  showStats: boolean
  t: (key: string, opts?: Record<string, unknown>) => string
  onEdit: () => void
  onCollapse?: () => void     // flashcard mode only
  onSpeak: () => void
  onToggleExpand: () => void
  isExpanded: boolean
  boxPrefix: string
  // editor
  isEditing: boolean
  onSaved: (updated: SavedPayload) => void
  onCancelEdit: () => void
  onDeleted: () => void
  // video refs
  clipCount?: number
  onVideoRefs?: () => void
}

function WordCard({
  uw, showStats, t, onEdit, onCollapse, onSpeak,
  onToggleExpand, isExpanded,
  boxPrefix, isEditing, onSaved, onCancelEdit, onDeleted,
  clipCount, onVideoRefs,
}: WordCardProps) {
  if (isEditing) {
    return (
      <WordEditForm
        word={{
          word_id: uw.word.id,
          palabra: uw.word.palabra,
          significado: uw.word.significado,
          idioma_origen: uw.word.idioma_origen,
          idioma_destino: uw.word.idioma_destino,
          tema_id: uw.word.tema_id,
          audio_url: uw.word.audio_url,
          audio_url_translation: uw.word.audio_url_translation,
          audio_text: uw.word.audio_text,
          audio_text_translation: uw.word.audio_text_translation,
          category: uw.word.category,
          source: uw.word.source,
        }}
        onSaved={onSaved}
        onCancel={onCancelEdit}
        onDeleted={onDeleted}
      />
    )
  }

  return (
    <div
      className={`card flex gap-3 py-3 cursor-pointer transition-all ${
        isExpanded ? 'items-start !border-blue-500 !bg-slate-900/60' : 'items-center'
      } ${onCollapse ? '!border-blue-500/30 animate-slide-up' : ''}`}
      onClick={onToggleExpand}
    >
      {uw.word.tema && (
        <div
          className={`w-1.5 rounded-full shrink-0 ${isExpanded ? 'min-h-[2.5rem] self-stretch' : 'h-10'}`}
          style={{ backgroundColor: uw.word.tema.color }}
        />
      )}
      <div className="flex-1 min-w-0">
        <p className={`font-semibold ${isExpanded ? 'whitespace-normal break-words' : 'truncate'}`}>
          {uw.word.palabra}
        </p>
        <p className={`text-slate-400 text-sm ${isExpanded ? 'whitespace-normal break-words mt-0.5' : 'truncate'}`}>
          {uw.word.significado}
        </p>
        {uw.word.tema && (
          <span
            className="inline-block text-xs px-2 py-0.5 rounded-full font-medium text-white mt-0.5"
            style={{ backgroundColor: uw.word.tema.color ?? '#64748b' }}
          >
            {uw.word.tema.nombre}
          </span>
        )}
        {showStats && uw.times_reviewed > 0 && (
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] text-slate-500">{t('words.statsReviewed', { n: uw.times_reviewed })}</span>
            <span className="text-[10px] text-green-500">✓{uw.times_correct}</span>
            {uw.times_incorrect > 0 && <span className="text-[10px] text-red-400">✗{uw.times_incorrect}</span>}
          </div>
        )}
        {showStats && uw.times_reviewed === 0 && (
          <span className="text-[10px] text-slate-600 mt-0.5 block">{t('words.statsNever')}</span>
        )}
      </div>
      <div className={`flex shrink-0 gap-1 ${isExpanded ? 'items-start' : 'items-center'}`}>
        {!!clipCount && onVideoRefs && (
          <button
            onClick={(e) => { e.stopPropagation(); onVideoRefs() }}
            className="relative text-slate-500 hover:text-purple-400 transition-colors px-1.5 text-base"
            title={t('words.videoRefs')}
          >
            🎬
            <span className="absolute -top-1 -right-0 text-[8px] font-bold bg-purple-600 text-white rounded-full min-w-[13px] h-[13px] flex items-center justify-center leading-none px-0.5">
              {clipCount > 9 ? '9+' : clipCount}
            </span>
          </button>
        )}
        <span className={`text-xs px-2 py-0.5 rounded-full text-slate-900 font-bold ${BOX_COLORS[uw.box_level]}`}>
          {boxPrefix}{uw.box_level}
        </span>
        <SpeakButton
          onClick={(e) => { e.stopPropagation(); onToggleExpand(); onSpeak() }}
          hasMp3={!!uw.word.audio_url}
          size="sm"
          className="px-1"
        />
        <button
          onClick={(e) => { e.stopPropagation(); onEdit() }}
          className="text-slate-500 hover:text-blue-400 transition-colors px-2"
          title={t('common.edit')}
        >
          ✎
        </button>
        {onCollapse && (
          <button
            onClick={(e) => { e.stopPropagation(); onCollapse() }}
            className="text-slate-500 hover:text-slate-300 transition-colors px-2"
            title={t('words.collapse')}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  )
}

const BOX_COLORS = [
  'bg-red-500',
  'bg-orange-500',
  'bg-yellow-400',
  'bg-lime-400',
  'bg-cyan-400',
  'bg-blue-500',
  'bg-purple-500',
] as const

// ── Persistent state via localStorage ────────────────────────────────────────
function useLocalStorage<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw !== null ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    localStorage.setItem(key, JSON.stringify(state))
  }, [key, state])
  return [state, setState]
}

const SELECT_CLASS =
  'bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all'

type SortField = 'palabra' | 'significado' | 'box_level' | 'added' | 'tema' | 'times_incorrect' | 'times_reviewed'
type SortDir = 'asc' | 'desc'

function sortUserWords(words: UserWord[], field: SortField, dir: SortDir): UserWord[] {
  const sorted = [...words].sort((a, b) => {
    let va: string | number, vb: string | number
    switch (field) {
      case 'palabra':    va = a.word.palabra.toLowerCase();    vb = b.word.palabra.toLowerCase();    break
      case 'significado': va = a.word.significado.toLowerCase(); vb = b.word.significado.toLowerCase(); break
      case 'box_level':  va = a.box_level;                     vb = b.box_level;                     break
      case 'added':      va = a.id;                            vb = b.id;                            break
      case 'tema':       va = a.word.tema?.nombre.toLowerCase() ?? ''; vb = b.word.tema?.nombre.toLowerCase() ?? ''; break
      case 'times_incorrect': va = a.times_incorrect;          vb = b.times_incorrect;               break
      case 'times_reviewed':  va = a.times_reviewed;           vb = b.times_reviewed;                break
    }
    if (va < vb) return dir === 'asc' ? -1 : 1
    if (va > vb) return dir === 'asc' ? 1 : -1
    return 0
  })
  return sorted
}

function userWordToReviewWord(uw: import('../types').UserWord): ReviewWord {
  return {
    user_word_id: uw.id,
    word_id: uw.word.id,
    palabra: uw.word.palabra,
    significado: uw.word.significado,
    idioma_origen: uw.word.idioma_origen,
    idioma_destino: uw.word.idioma_destino,
    box_level: uw.box_level,
    audio_url: uw.word.audio_url,
    audio_url_translation: uw.word.audio_url_translation,
    exercise_type: 'multiple_choice',
    choices: null,
    tema_id: uw.word.tema_id,
    tema_nombre: uw.word.tema?.nombre ?? null,
    tema_color: uw.word.tema?.color ?? null,
  }
}

export default function Words() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const { autoPlayAudio, wordsOnly, pageSizeOptions, selectedPageSize, setSelectedPageSize } = useSettingsStore()
  const { uiLanguage } = useUserProfileStore()
  const uiLang = (uiLanguage as TipLang) ?? 'es'

  const speak = (palabra: string, idioma: string, audioUrl?: string | null) => {
    if (audioUrl) {
      playAudio(new Audio(audioUrl))
      return
    }
    const u = new SpeechSynthesisUtterance(palabra)
    u.lang = idioma
    speakUtterance(u)
  }

  // ── Data ─────────────────────────────────────────────────────────────────────
  const [userWords, setUserWords] = useState<UserWord[]>([])
  const [temas, setTemas] = useState<Tema[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // ── Video refs ───────────────────────────────────────────────────────────────
  const [wordRefCounts, setWordRefCounts] = useState<Map<number, number>>(new Map())
  const [videoRefsWord, setVideoRefsWord] = useState<UserWord | null>(null)

  // ── Subtitle search in words tab ──────────────────────────────────────────────
  const [hasSubtitleFiles, setHasSubtitleFiles] = useState(false)
  const [subtitleSearchEnabled, setSubtitleSearchEnabled] = useState(false)
  const [subtitleSearchResults, setSubtitleSearchResults] = useState<WordVideoRef[] | null>(null)
  const [isSubtitleSearching, setIsSubtitleSearching] = useState(false)
  const [subtitleSearchModal, setSubtitleSearchModal] = useState<WordVideoRef[] | null>(null)

  // ── CRUD ─────────────────────────────────────────────────────────────────────
  const [isAdding, setIsAdding] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [showDeleteAll, setShowDeleteAll] = useState(false)
  const [isBusy, setIsBusy] = useState(false)

  // ── Filters ──────────────────────────────────────────────────────────────────
  const [filterSearch, setFilterSearch] = useState('')
  const [filterBox, setFilterBox] = useState<number | null>(() => {
    const p = searchParams.get('box')
    return p !== null ? parseInt(p) : null
  })
  // 'none' = show words without any tema
  const [filterTema, setFilterTema] = useState<number | 'none' | null>(null)
  const [filterCategory, setFilterCategory] = useState<string | null>(null)
  const [filterLastErrors, setFilterLastErrors] = useState(() =>
    searchParams.get('filter') === 'lastErrors'
  )
  const lastErrorIds = getLastErrors()

  // ── Categories (fetched once) ─────────────────────────────────────────────
  const [categories, setCategories] = useState<string[]>([])

  // ── Sort (persistent) ────────────────────────────────────────────────────────
  const [sortField, setSortField] = useLocalStorage<SortField>('words:sortField', 'added')
  const [sortDir, setSortDir] = useLocalStorage<SortDir>('words:sortDir', 'desc')

  // ── Advanced panel (persistent) ──────────────────────────────────────────────
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showAudioPanel, setShowAudioPanel] = useState(false)
  const [showStats, setShowStats] = useLocalStorage<boolean>('words:showStats', false)
  const [expandAll, setExpandAll] = useLocalStorage<boolean>('words:expandAll', false)

  // ── Drill / Grammar modals for filtered words ────────────────────────────────
  const [showDrill, setShowDrill] = useState(false)
  const [showGrammarWords, setShowGrammarWords] = useState(false)

  // ── Bulk tema assignment ──────────────────────────────────────────────────────
  const [showBulkTema, setShowBulkTema] = useState(false)
  const [bulkTemaId, setBulkTemaId] = useState<number | 'none' | null>(null)
  const [bulkNewTemaName, setBulkNewTemaName] = useState('')
  const [bulkNewTemaColor, setBulkNewTemaColor] = useState('#6366f1')
  const [isBulkAssigning, setIsBulkAssigning] = useState(false)
  const [bulkAssignedMsg, setBulkAssignedMsg] = useState('')

  // ── View ─────────────────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<'list' | 'flashcard'>('list')
  const [flashSide, setFlashSide] = useState<'palabra' | 'significado'>('palabra')
  const [revealed, setRevealed] = useState<Set<number>>(new Set())
  const [seen, setSeen] = useState<Set<number>>(new Set())
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const toggleExpand = (id: number) => setExpandedId((prev) => prev === id ? null : id)

  // ── Pagination ───────────────────────────────────────────────────────────────
  const pageSize = selectedPageSize
  const setPageSize = setSelectedPageSize
  const [page, setPage] = useState(1)

  // ── Load ─────────────────────────────────────────────────────────────────────
  const load = async () => {
    setIsLoading(true)
    const [wRes, tRes, cRes, rRes, sRes] = await Promise.all([
      wordsApi.myWords(),
      temasApi.list(),
      wordsApi.categories(),
      subtitlesApi.getWordIdsWithRefs(),
      subtitlesApi.list(),
    ])
    setUserWords(wRes.data)
    setTemas(tRes.data)
    setCategories(cRes.data)
    setWordRefCounts(new Map(rRes.data.refs.map((r) => [r.word_id, r.count])))
    setHasSubtitleFiles(sRes.data.length > 0)
    setIsLoading(false)
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    const p = searchParams.get('box')
    if (p !== null) setFilterBox(parseInt(p))
  }, [searchParams])

  // ── Subtitle search — debounced, triggered by filterSearch ───────────────────
  useEffect(() => {
    if (!subtitleSearchEnabled || filterSearch.trim().length < 2) {
      setSubtitleSearchResults(null)
      return
    }
    setIsSubtitleSearching(true)
    const timer = setTimeout(async () => {
      try {
        const res = await subtitlesApi.searchSegments(filterSearch.trim())
        setSubtitleSearchResults(subtitlesApi.segmentsToVideoRefs(res.data.results))
      } catch {
        setSubtitleSearchResults([])
      } finally {
        setIsSubtitleSearching(false)
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [filterSearch, subtitleSearchEnabled])

  // ── Derived ──────────────────────────────────────────────────────────────────
  const filtered = userWords.filter((uw) => {
    // Words with audio (from LEO) are NEVER treated as phrases
    const hasAudio = !!(uw.word.audio_url || uw.word.audio_url_translation)
    if (wordsOnly && !hasAudio) {
      const tooLong =
        uw.word.palabra.split(' ').length > 2 ||
        uw.word.significado.split(' ').length > 2
      if (tooLong) return false
    }
    if (filterLastErrors) return lastErrorIds.includes(uw.id)
    if (filterBox !== null && uw.box_level !== filterBox) return false
    if (filterTema === 'none') {
      if (uw.word.tema_id !== null) return false
    } else if (filterTema !== null && uw.word.tema_id !== filterTema) {
      return false
    }
    if (filterCategory !== null && uw.word.category !== filterCategory) return false
    if (filterSearch) {
      const q = filterSearch.toLowerCase()
      const inTranslations = uw.word.translations?.some(
        (tr) => tr.texto.toLowerCase().includes(q)
      ) ?? false
      return (
        uw.word.palabra.toLowerCase().includes(q) ||
        uw.word.significado.toLowerCase().includes(q) ||
        inTranslations
      )
    }
    return true
  })

  const sorted = sortUserWords(filtered, sortField, sortDir)
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const paginated = sorted.slice((safePage - 1) * pageSize, safePage * pageSize)

  const toggleReveal = (uw: UserWord) => {
    const isCurrentlyRevealed = revealed.has(uw.word.id)
    if (isCurrentlyRevealed) {
      setSeen((prev) => new Set(prev).add(uw.word.id))
      setExpandedId((prev) => prev === uw.word.id ? null : prev)
    } else {
      setExpandedId(uw.word.id)
    }
    setRevealed((prev) => {
      const next = new Set(prev)
      if (isCurrentlyRevealed) next.delete(uw.word.id)
      else next.add(uw.word.id)
      return next
    })
    if (!isCurrentlyRevealed && autoPlayAudio) {
      speak(uw.word.palabra, uw.word.idioma_origen, uw.word.audio_url)
    }
  }

  const switchViewMode = (mode: 'list' | 'flashcard') => {
    setViewMode(mode)
    setRevealed(new Set())
  }

  const resetPage = () => setPage(1)

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir(field === 'times_incorrect' || field === 'times_reviewed' ? 'desc' : 'asc')
    }
    resetPage()
  }

  // ── Delete ───────────────────────────────────────────────────────────────────
  const handleDeleteAll = async () => {
    setIsBusy(true)
    try {
      await wordsApi.deleteAll()
      setUserWords([])
      setShowDeleteAll(false)
    } finally {
      setIsBusy(false)
    }
  }

  // ── Export ───────────────────────────────────────────────────────────────────
  const handleExport = async () => {
    const res = await wordsApi.exportCsv()
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url
    a.download = 'vocabox_export.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Bulk tema assign ─────────────────────────────────────────────────────────
  const handleBulkAssignTema = async () => {
    setIsBulkAssigning(true)
    try {
      let temaId: number | null = null
      if (bulkTemaId === 'none') {
        temaId = null
      } else if (bulkTemaId !== null) {
        temaId = bulkTemaId
      } else if (bulkNewTemaName.trim()) {
        const res = await temasApi.create(bulkNewTemaName.trim(), bulkNewTemaColor)
        temaId = res.data.id
      } else {
        return
      }
      const wordIds = filtered.map((uw) => uw.word.id)
      await wordsApi.bulkAssignTema(wordIds, temaId)
      setBulkAssignedMsg(t('words.bulkAssigned', { count: wordIds.length }))
      setBulkNewTemaName('')
      setBulkTemaId(null)
      setShowBulkTema(false)
      await load()
    } finally {
      setIsBulkAssigning(false)
    }
  }

  // ── Sort indicator ────────────────────────────────────────────────────────────
  const sortIndicator = (field: SortField) => {
    if (sortField !== field) return <span className="text-slate-600 ml-0.5">↕</span>
    return <span className="text-blue-400 ml-0.5">{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <>
    <div className="p-4 pt-8 space-y-4">

      {/* Header */}
      <div className="flex justify-between items-center gap-2 flex-wrap">
        <h1 className="text-2xl font-bold">{t('words.title')}</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-xl overflow-hidden border border-slate-600">
            <button
              onClick={() => switchViewMode('list')}
              title={t('words.listView')}
              className={`py-2 px-3 text-sm transition-colors ${
                viewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
              }`}
            >
              ≡
            </button>
            <button
              onClick={() => switchViewMode('flashcard')}
              title={t('words.cardView')}
              className={`py-2 px-3 text-sm transition-colors ${
                viewMode === 'flashcard' ? 'bg-blue-600 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
              }`}
            >
              ⊞
            </button>
          </div>
          <button onClick={handleExport} title="Exportar CSV" className="btn-secondary py-2 px-3 text-sm">
            ↓ CSV
          </button>
          <button
            onClick={() => setShowDeleteAll(true)}
            title={t('words.deleteAll')}
            className="btn-secondary py-2 px-3 text-sm text-red-400 hover:text-red-300"
          >
            🗑
          </button>
          <button
            onClick={() => { setIsAdding((v) => !v); setEditId(null) }}
            className="btn-primary py-2 px-4 text-sm"
          >
            {isAdding ? t('words.cancel') : t('words.addWord')}
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex gap-2 flex-wrap">
        <input
          type="search"
          placeholder={t('words.search')}
          value={filterSearch}
          onChange={(e) => { setFilterSearch(e.target.value); resetPage() }}
          className="flex-1 min-w-[120px] bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
        />
        <select
          value={filterBox ?? ''}
          onChange={(e) => { setFilterBox(e.target.value !== '' ? Number(e.target.value) : null); resetPage() }}
          className={SELECT_CLASS}
        >
          <option value="">{t('words.allBoxes')}</option>
          {[0, 1, 2, 3, 4, 5, 6].map((b) => (
            <option key={b} value={b}>{t('words.box', { n: b })}</option>
          ))}
        </select>
        {temas.length > 0 && (
          <select
            value={filterTema === 'none' ? 'none' : (filterTema ?? '')}
            onChange={(e) => {
              const v = e.target.value
              setFilterTema(v === '' ? null : v === 'none' ? 'none' : Number(v))
              resetPage()
            }}
            className={SELECT_CLASS}
          >
            <option value="">{t('words.allThemes')}</option>
            <option value="none">{t('words.noTheme')}</option>
            {temas.map((tm) => (
              <option key={tm.id} value={tm.id}>{tm.nombre}</option>
            ))}
          </select>
        )}
        {categories.length > 0 && (
          <select
            value={filterCategory ?? ''}
            onChange={(e) => { setFilterCategory(e.target.value !== '' ? e.target.value : null); resetPage() }}
            className={SELECT_CLASS}
          >
            <option value="">{t('words.allCategories')}</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        )}
        {/* Last errors chip */}
        {lastErrorIds.length > 0 && (
          <button
            onClick={() => { setFilterLastErrors((v) => !v); setFilterBox(null); setFilterTema(null); setFilterCategory(null); setFilterSearch(''); resetPage() }}
            className={`flex items-center gap-1.5 py-2 px-3 text-sm rounded-xl border transition-colors ${
              filterLastErrors
                ? 'border-red-500 bg-red-500/15 text-red-300'
                : 'border-slate-600 bg-slate-700 text-slate-400 hover:border-slate-500'
            }`}
          >
            ✗ {t('words.lastErrors')}
          </button>
        )}
        {/* Subtitle search toggle — only if subtitle files exist */}
        {hasSubtitleFiles && (
          <button
            onClick={() => { setSubtitleSearchEnabled((v) => !v); setSubtitleSearchResults(null) }}
            title={t('words.subtitleSearchDesc')}
            className={`flex items-center gap-1.5 py-2 px-3 text-sm rounded-xl border transition-colors ${
              subtitleSearchEnabled
                ? 'border-purple-500 bg-purple-500/15 text-purple-300'
                : 'border-slate-600 bg-slate-700 text-slate-400 hover:border-slate-500'
            }`}
          >
            🎬 {t('words.subtitleSearch')}
          </button>
        )}
        {/* Filtered-words actions: drill, grammar, bulk-tema */}
        {filtered.length > 0 && (filterTema !== null || filterCategory !== null || filterSearch || filterBox !== null || filterLastErrors) && (
          <>
            <button
              onClick={() => setShowDrill(true)}
              className="btn-secondary py-2 px-3 text-sm"
              title={uiLang === 'en' ? 'Quick review (no box changes)' : 'Repasar palabras filtradas (sin cajas)'}
            >
              📚
            </button>
            <button
              onClick={() => setShowGrammarWords(true)}
              className="btn-secondary py-2 px-3 text-sm"
              title={uiLang === 'en' ? 'Grammar exercises for these words' : 'Ejercicios de gramática con estas palabras'}
            >
              ✏️
            </button>
            <button
              onClick={() => { setShowBulkTema((v) => !v); setBulkAssignedMsg('') }}
              className={`btn-secondary py-2 px-3 text-sm flex items-center gap-1 ${showBulkTema ? 'border-indigo-500 text-indigo-300' : ''}`}
              title={t('words.bulkAssignTema')}
            >
              🏷
            </button>
          </>
        )}
        {/* More options toggle */}
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className={`btn-secondary py-2 px-3 text-sm flex items-center gap-1 ${showAdvanced ? 'border-blue-500 text-blue-300' : ''}`}
        >
          ⚙ {showAdvanced ? '▴' : '▾'}
        </button>
        {/* Audio review */}
        <button
          onClick={() => setShowAudioPanel((v) => !v)}
          title={t('audioReview.button')}
          className={`btn-secondary py-2 px-3 text-sm ${showAudioPanel ? 'border-blue-500 text-blue-300' : ''}`}
        >
          🎧
        </button>
      </div>

      {/* Bulk tema assignment panel */}
      {showBulkTema && (
        <div className="card space-y-3 animate-slide-up border border-indigo-500/30">
          <p className="text-sm text-slate-300">
            {t('words.bulkAssignTema')}
            <span className="ml-2 text-xs text-slate-500">
              {t('words.bulkAssignTemaDesc', { count: filtered.length })}
            </span>
          </p>
          {bulkAssignedMsg && (
            <p className="text-xs text-green-400">{bulkAssignedMsg}</p>
          )}
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={bulkTemaId === 'none' ? 'none' : (bulkTemaId ?? '')}
              onChange={(e) => {
                const v = e.target.value
                setBulkTemaId(v === '' ? null : v === 'none' ? 'none' : Number(v))
                setBulkNewTemaName('')
              }}
              className={`${SELECT_CLASS} flex-1 min-w-[160px]`}
            >
              <option value="">{t('words.bulkAssignNewTema')}</option>
              <option value="none">{t('words.bulkRemoveTema')}</option>
              {temas.map((tm) => (
                <option key={tm.id} value={tm.id}>{tm.nombre}</option>
              ))}
            </select>
            {bulkTemaId === null && (
              <>
                <input
                  type="text"
                  placeholder={t('words.bulkAssignNewTemaName')}
                  value={bulkNewTemaName}
                  onChange={(e) => setBulkNewTemaName(e.target.value)}
                  className="flex-1 min-w-[140px] bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">{t('words.bulkAssignNewTemaColor')}</span>
                  <input
                    type="color"
                    value={bulkNewTemaColor}
                    onChange={(e) => setBulkNewTemaColor(e.target.value)}
                    className="w-8 h-8 rounded cursor-pointer bg-transparent border-0"
                  />
                </div>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { setShowBulkTema(false); setBulkTemaId(null); setBulkNewTemaName('') }}
              className="btn-secondary flex-1 text-sm"
            >
              {t('words.bulkCancel')}
            </button>
            <button
              onClick={handleBulkAssignTema}
              disabled={isBulkAssigning || (bulkTemaId === null && !bulkNewTemaName.trim())}
              className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl px-4 py-2 font-medium text-sm transition-colors"
            >
              {isBulkAssigning ? t('words.bulkAssigning') : t('words.bulkAssignApply')}
            </button>
          </div>
        </div>
      )}

      {/* Advanced options panel */}
      {showAdvanced && (
        <div className="card space-y-3 animate-slide-up">
          {/* Sort controls */}
          <p className="text-xs text-slate-500 uppercase tracking-widest">{t('words.sortBy')}</p>
          <div className="flex flex-wrap gap-2">
            {([
              ['palabra',        t('words.wordOrigin')],
              ['significado',    t('words.meaning')],
              ['box_level',      t('words.sortBox')],
              ['tema',           t('words.sortTema')],
              ['added',          t('words.sortAdded')],
              ['times_reviewed', t('words.sortReviewed')],
              ['times_incorrect',t('words.sortErrors')],
            ] as [SortField, string][]).map(([field, label]) => (
              <button
                key={field}
                onClick={() => handleSort(field)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-0.5 ${
                  sortField === field
                    ? 'border-blue-500 bg-blue-600/20 text-blue-300'
                    : 'border-slate-600 bg-slate-700 text-slate-400 hover:border-slate-500'
                }`}
              >
                {label}{sortIndicator(field)}
              </button>
            ))}
          </div>

          {/* Toggles row */}
          <div className="flex items-center gap-5 pt-1 border-t border-slate-700/60 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">{t('words.showStats')}</span>
              <button
                onClick={() => setShowStats((v) => !v)}
                className={`relative w-10 h-5 rounded-full transition-colors ${showStats ? 'bg-blue-600' : 'bg-slate-600'}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${showStats ? 'left-5' : 'left-0.5'}`} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">{t('words.expandAll')}</span>
              <button
                onClick={() => setExpandAll((v) => !v)}
                className={`relative w-10 h-5 rounded-full transition-colors ${expandAll ? 'bg-blue-600' : 'bg-slate-600'}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${expandAll ? 'left-5' : 'left-0.5'}`} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audio review panel */}
      {showAudioPanel && (
        <AudioReviewPanel
          filteredWords={filtered}
          onClose={() => setShowAudioPanel(false)}
        />
      )}

      {/* Flashcard side toggle */}
      {viewMode === 'flashcard' && !isLoading && filtered.length > 0 && (
        <div className="flex items-center gap-1 text-xs">
          <span className="text-slate-500 mr-1">{t('words.show')}</span>
          <button
            onClick={() => { setFlashSide('palabra'); setRevealed(new Set()) }}
            className={`px-3 py-1 rounded-lg transition-colors ${
              flashSide === 'palabra' ? 'bg-slate-600 text-white' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {t('words.showWord')}
          </button>
          <button
            onClick={() => { setFlashSide('significado'); setRevealed(new Set()) }}
            className={`px-3 py-1 rounded-lg transition-colors ${
              flashSide === 'significado' ? 'bg-slate-600 text-white' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {t('words.showTranslation')}
          </button>
        </div>
      )}

      {/* ── Subtitle search results ── */}
      {subtitleSearchEnabled && filterSearch.trim().length >= 2 && (
        <div className="card space-y-2 border-purple-500/30 bg-slate-800/60">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-purple-300 uppercase tracking-wide">
              🎬 {t('words.subtitleSearch')}
              {isSubtitleSearching && (
                <span className="inline-block w-3 h-3 ml-2 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin" />
              )}
            </p>
            {subtitleSearchResults !== null && subtitleSearchResults.length > 0 && (
              <button
                onClick={() => setSubtitleSearchModal(subtitleSearchResults)}
                className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
              >
                {t('import.subtitleSearchOpenAll')} ▶
              </button>
            )}
          </div>

          {subtitleSearchResults === null && !isSubtitleSearching && (
            <p className="text-xs text-slate-500">{t('import.subtitleSearchEmpty')}</p>
          )}
          {subtitleSearchResults !== null && subtitleSearchResults.length === 0 && (
            <p className="text-xs text-slate-500">{t('import.subtitleSearchEmpty')}</p>
          )}
          {subtitleSearchResults !== null && subtitleSearchResults.length > 0 && (
            <>
              <p className="text-xs text-slate-500">
                {t('import.subtitleSearchResults', { n: subtitleSearchResults.length })}
              </p>
              <div className="divide-y divide-slate-700/50 border border-slate-700/60 rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                {subtitleSearchResults.map((ref) => (
                  <button
                    key={ref.id}
                    onClick={() => setSubtitleSearchModal([ref])}
                    className="w-full text-left px-3 py-2 hover:bg-slate-700/50 transition-colors"
                  >
                    <p className="text-xs text-slate-200 line-clamp-2">{ref.segment.text}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {ref.segment.file.filename} · {Math.floor(ref.segment.start_ms / 60000)}:{String(Math.floor((ref.segment.start_ms % 60000) / 1000)).padStart(2, '0')}–{Math.floor(ref.segment.end_ms / 60000)}:{String(Math.floor((ref.segment.end_ms % 60000) / 1000)).padStart(2, '0')}
                    </p>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Result count + page size */}
      {!isLoading && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-xs text-slate-500">
            {t('words.word', { count: filtered.length })}
            {(filterBox !== null || filterSearch || filterTema !== null || filterCategory !== null) && ` · ${t('words.filtered')}`}
          </p>
          {filtered.length > pageSizeOptions[0] && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">{t('words.perPage')}</span>
              {pageSizeOptions.map((n) => (
                <button
                  key={n}
                  onClick={() => { setPageSize(n); resetPage() }}
                  className={`text-xs px-2 py-0.5 rounded-lg transition-colors ${
                    pageSize === n ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Delete-all confirmation */}
      {showDeleteAll && (
        <div className="card border border-red-500/40 space-y-3 animate-slide-up">
          <p className="text-sm text-slate-300">
            {t('words.deleteAllTitle')} <br />
            <span className="text-xs text-slate-500">{t('words.deleteAllDesc')}</span>
          </p>
          <div className="flex gap-3">
            <button onClick={() => setShowDeleteAll(false)} className="btn-secondary flex-1">
              {t('words.cancel')}
            </button>
            <button
              onClick={handleDeleteAll}
              disabled={isBusy}
              className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-xl px-4 py-2.5 font-medium transition-colors"
            >
              {isBusy ? t('words.deleting') : t('words.deleteAll')}
            </button>
          </div>
        </div>
      )}

      {/* Add form */}
      {isAdding && (
        <WordEditForm
          word={{
            word_id: 0,
            palabra: '',
            significado: '',
            idioma_origen: 'de',
            idioma_destino: 'es',
            tema_id: null,
          }}
          onSaved={() => { setIsAdding(false); load() }}
          onCancel={() => setIsAdding(false)}
        />
      )}

      {/* Content */}
      {isLoading ? (
        <div className="text-center text-slate-400 py-12">{t('common.loading')}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-5xl mb-3">{userWords.length === 0 ? '📭' : '🔍'}</div>
          <p className="text-slate-400">
            {userWords.length === 0 ? t('words.noWords') : t('words.noResults')}
          </p>
          {userWords.length > 0 && (
            <button
              onClick={() => { setFilterSearch(''); setFilterBox(null); setFilterTema(null); setFilterCategory(null); setFilterLastErrors(false) }}
              className="mt-3 text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              {t('words.clearFilters')}
            </button>
          )}
        </div>
      ) : viewMode === 'flashcard' ? (

        /* ── Flashcard mode ─────────────────────────────────────────────────── */
        <div className="flex flex-wrap gap-2">
          {paginated.map((uw) => {
            const isRevealed = revealed.has(uw.word.id)
            return isRevealed ? (
              <div key={uw.word.id} className="w-full">
                <WordCard
                  uw={uw}
                  showStats={showStats}
                  t={t as (key: string, opts?: Record<string, unknown>) => string}
                  boxPrefix={t('box.prefix')}
                  onSpeak={() => speak(uw.word.palabra, uw.word.idioma_origen, uw.word.audio_url)}
                  onEdit={() => setEditId(uw.word.id)}
                  onCollapse={() => toggleReveal(uw)}
                  onToggleExpand={() => toggleExpand(uw.word.id)}
                  isExpanded={expandAll || expandedId === uw.word.id}
                  isEditing={editId === uw.word.id}
                  onSaved={(updated) => {
                    setEditId(null)
                    setUserWords((prev) => prev.map((item) =>
                      item.word.id === uw.word.id ? { ...item, word: { ...item.word, ...updated } as Word } : item
                    ))
                  }}
                  onCancelEdit={() => setEditId(null)}
                  onDeleted={() => { setEditId(null); load() }}
                  clipCount={wordRefCounts.get(uw.word.id)}
                  onVideoRefs={() => setVideoRefsWord(uw)}
                />
              </div>
            ) : (
              <button
                key={uw.word.id}
                onClick={() => toggleReveal(uw)}
                className={`px-3 py-1.5 bg-slate-800 border rounded-lg text-sm transition-colors active:scale-95 ${
                  seen.has(uw.word.id)
                    ? 'border-slate-700 text-slate-500 line-through hover:bg-slate-700 hover:border-slate-600'
                    : 'border-slate-600 hover:bg-slate-700 hover:border-slate-500'
                }`}
              >
                {flashSide === 'palabra' ? uw.word.palabra : uw.word.significado}
              </button>
            )
          })}
        </div>

      ) : (

        /* ── List mode ──────────────────────────────────────────────────────── */
        <div className="space-y-2">
          {paginated.map((uw) => (
            <WordCard
              key={uw.word.id}
              uw={uw}
              showStats={showStats}
              t={t as (key: string, opts?: Record<string, unknown>) => string}
              boxPrefix={t('box.prefix')}
              onSpeak={() => speak(uw.word.palabra, uw.word.idioma_origen, uw.word.audio_url)}
              onEdit={() => setEditId(uw.word.id)}
              onToggleExpand={() => toggleExpand(uw.word.id)}
              isExpanded={expandAll || expandedId === uw.word.id}
              isEditing={editId === uw.word.id}
              onSaved={(updated) => {
                setEditId(null)
                setUserWords((prev) => prev.map((item) =>
                  item.word.id === uw.word.id ? { ...item, word: { ...item.word, ...updated } as Word } : item
                ))
              }}
              onCancelEdit={() => setEditId(null)}
              onDeleted={() => { setEditId(null); load() }}
              clipCount={wordRefCounts.get(uw.word.id)}
              onVideoRefs={() => setVideoRefsWord(uw)}
            />
          ))}
        </div>
      )}

      {/* Video refs modal — word clips */}
      {videoRefsWord && (
        <VideoRefsModal
          wordId={videoRefsWord.word.id}
          palabra={videoRefsWord.word.palabra}
          significado={videoRefsWord.word.significado}
          audioText={videoRefsWord.word.audio_text ?? undefined}
          onClose={() => setVideoRefsWord(null)}
        />
      )}

      {/* Video refs modal — subtitle search results */}
      {subtitleSearchModal && (
        <VideoRefsModal
          wordId={0}
          palabra={filterSearch.trim()}
          significado=""
          overrideRefs={subtitleSearchModal}
          onClose={() => setSubtitleSearchModal(null)}
        />
      )}

      {/* ── Pagination bar ── */}
      {!isLoading && totalPages > 1 && (
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-700/60">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage === 1}
            className="btn-secondary py-1.5 px-4 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ← {t('words.prev')}
          </button>
          <span className="text-xs text-slate-500">
            {t('words.page', { current: safePage, total: totalPages })}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage === totalPages}
            className="btn-secondary py-1.5 px-4 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t('words.next')} →
          </button>
        </div>
      )}
    </div>

      {/* ── Word Drill Modal ── */}
      {showDrill && (
        <WordDrillModal
          words={filtered}
          uiLang={uiLang}
          onClose={() => setShowDrill(false)}
        />
      )}

      {/* ── Grammar Words Modal ── */}
      {showGrammarWords && (
        <div className="fixed inset-0 z-50 bg-slate-900 flex flex-col">
          <div className="flex items-center justify-between px-4 pt-5 pb-2">
            <p className="text-sm font-medium text-slate-300">
              ✏️ {uiLang === 'en' ? 'Grammar' : uiLang === 'de' ? 'Grammatik' : 'Gramática'} — {filtered.length} {uiLang === 'en' ? 'words' : 'palabras'}
            </p>
            <button onClick={() => setShowGrammarWords(false)} className="text-slate-400 hover:text-white text-xl">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            <GrammarSession
              words={filtered.map(userWordToReviewWord)}
              uiLang={uiLang}
              onDone={() => setShowGrammarWords(false)}
            />
          </div>
        </div>
      )}
    </>
  )
}
