import { FormEvent, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { languagesApi, temasApi, wordsApi } from '../api/client'
import LanguageSelect from '../components/LanguageSelect'
import TemaSelect from '../components/TemaSelect'
import WordEditForm from '../components/WordEditForm'
import { useSettingsStore } from '../stores/settingsStore'
import type { Language, Tema, UserWord } from '../types'

const BOX_COLORS = [
  'bg-red-500',
  'bg-orange-500',
  'bg-yellow-400',
  'bg-lime-400',
  'bg-cyan-400',
  'bg-blue-500',
  'bg-purple-500',
] as const

const EMPTY_FORM = {
  palabra: '',
  significado: '',
  idioma_origen: 'de',
  idioma_destino: 'es',
  tema_id: '',
}

const SELECT_CLASS =
  'bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all'

export default function Words() {
  const [searchParams] = useSearchParams()
  const { autoPlayAudio, wordsOnly } = useSettingsStore()

  const speak = (palabra: string, idioma: string) => {
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(palabra)
    u.lang = idioma
    speechSynthesis.speak(u)
  }

  // ── Data ─────────────────────────────────────────────────────────────────────
  const [userWords, setUserWords] = useState<UserWord[]>([])
  const [temas, setTemas] = useState<Tema[]>([])
  const [languages, setLanguages] = useState<Language[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // ── CRUD ─────────────────────────────────────────────────────────────────────
  const [isAdding, setIsAdding] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editId, setEditId] = useState<number | null>(null)
  const [showDeleteAll, setShowDeleteAll] = useState(false)
  const [isBusy, setIsBusy] = useState(false)

  // ── Filters ──────────────────────────────────────────────────────────────────
  const [filterSearch, setFilterSearch] = useState('')
  const [filterBox, setFilterBox] = useState<number | null>(() => {
    const p = searchParams.get('box')
    return p !== null ? parseInt(p) : null
  })
  const [filterTema, setFilterTema] = useState<number | null>(null)

  // ── View ─────────────────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<'list' | 'flashcard'>('list')
  const [flashSide, setFlashSide] = useState<'palabra' | 'significado'>('palabra')
  const [revealed, setRevealed] = useState<Set<number>>(new Set())

  // ── Load ─────────────────────────────────────────────────────────────────────
  const load = async () => {
    setIsLoading(true)
    const [wRes, tRes, lRes] = await Promise.all([
      wordsApi.myWords(),
      temasApi.list(),
      languagesApi.list(),
    ])
    setUserWords(wRes.data)
    setTemas(tRes.data)
    setLanguages(lRes.data)
    setIsLoading(false)
  }

  useEffect(() => { load() }, [])

  // Sync box filter when navigating from Dashboard with ?box=N
  useEffect(() => {
    const p = searchParams.get('box')
    if (p !== null) setFilterBox(parseInt(p))
  }, [searchParams])

  // ── Derived ──────────────────────────────────────────────────────────────────
  const filtered = userWords.filter((uw) => {
    if (wordsOnly && (uw.word.palabra.split(' ').length > 2 || uw.word.significado.split(' ').length > 2)) return false
    if (filterBox !== null && uw.box_level !== filterBox) return false
    if (filterTema !== null && uw.word.tema_id !== filterTema) return false
    if (filterSearch) {
      const q = filterSearch.toLowerCase()
      return (
        uw.word.palabra.toLowerCase().includes(q) ||
        uw.word.significado.toLowerCase().includes(q)
      )
    }
    return true
  })

  const toggleReveal = (uw: UserWord) => {
    const isCurrentlyRevealed = revealed.has(uw.word.id)
    setRevealed((prev) => {
      const next = new Set(prev)
      if (isCurrentlyRevealed) next.delete(uw.word.id)
      else next.add(uw.word.id)
      return next
    })
    if (!isCurrentlyRevealed && autoPlayAudio) {
      speak(uw.word.palabra, uw.word.idioma_origen)
    }
  }

  const switchViewMode = (mode: 'list' | 'flashcard') => {
    setViewMode(mode)
    setRevealed(new Set())
  }

  // ── Add ──────────────────────────────────────────────────────────────────────
  const handleAdd = async (e: FormEvent) => {
    e.preventDefault()
    setIsBusy(true)
    try {
      await wordsApi.create({
        ...form,
        tema_id: form.tema_id ? parseInt(form.tema_id) : undefined,
      })
      setForm(EMPTY_FORM)
      setIsAdding(false)
      load()
    } finally {
      setIsBusy(false)
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────────
  const handleDelete = async (wordId: number) => {
    await wordsApi.delete(wordId)
    setUserWords((prev) => prev.filter((uw) => uw.word.id !== wordId))
  }

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

  // ── Field helpers ─────────────────────────────────────────────────────────────
  const setAddField = (field: keyof typeof EMPTY_FORM) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }))

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 pt-8 space-y-4">

      {/* Header */}
      <div className="flex justify-between items-center gap-2 flex-wrap">
        <h1 className="text-2xl font-bold">Vocabulario</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {/* View mode toggle */}
          <div className="flex rounded-xl overflow-hidden border border-slate-600">
            <button
              onClick={() => switchViewMode('list')}
              title="Vista lista"
              className={`py-2 px-3 text-sm transition-colors ${
                viewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
              }`}
            >
              ≡
            </button>
            <button
              onClick={() => switchViewMode('flashcard')}
              title="Modo tarjeta"
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
            title="Borrar todo"
            className="btn-secondary py-2 px-3 text-sm text-red-400 hover:text-red-300"
          >
            🗑
          </button>
          <button
            onClick={() => { setIsAdding((v) => !v); setEditId(null) }}
            className="btn-primary py-2 px-4 text-sm"
          >
            {isAdding ? 'Cancelar' : '+ Añadir'}
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex gap-2 flex-wrap">
        <input
          type="search"
          placeholder="Buscar palabra..."
          value={filterSearch}
          onChange={(e) => setFilterSearch(e.target.value)}
          className="flex-1 min-w-[120px] bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
        />
        <select
          value={filterBox ?? ''}
          onChange={(e) => setFilterBox(e.target.value !== '' ? Number(e.target.value) : null)}
          className={SELECT_CLASS}
        >
          <option value="">Todas las cajas</option>
          {[0, 1, 2, 3, 4, 5, 6].map((b) => (
            <option key={b} value={b}>Caja {b}</option>
          ))}
        </select>
        {temas.length > 0 && (
          <select
            value={filterTema ?? ''}
            onChange={(e) => setFilterTema(e.target.value !== '' ? Number(e.target.value) : null)}
            className={SELECT_CLASS}
          >
            <option value="">Todos los temas</option>
            {temas.map((t) => (
              <option key={t.id} value={t.id}>{t.nombre}</option>
            ))}
          </select>
        )}
      </div>

      {/* Flashcard side toggle */}
      {viewMode === 'flashcard' && !isLoading && filtered.length > 0 && (
        <div className="flex items-center gap-1 text-xs">
          <span className="text-slate-500 mr-1">Mostrar:</span>
          <button
            onClick={() => { setFlashSide('palabra'); setRevealed(new Set()) }}
            className={`px-3 py-1 rounded-lg transition-colors ${
              flashSide === 'palabra'
                ? 'bg-slate-600 text-white'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Palabra
          </button>
          <button
            onClick={() => { setFlashSide('significado'); setRevealed(new Set()) }}
            className={`px-3 py-1 rounded-lg transition-colors ${
              flashSide === 'significado'
                ? 'bg-slate-600 text-white'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            Traducción
          </button>
        </div>
      )}

      {/* Result count */}
      {!isLoading && (
        <p className="text-xs text-slate-500">
          {filtered.length} {filtered.length === 1 ? 'palabra' : 'palabras'}
          {(filterBox !== null || filterSearch || filterTema !== null) && ' · filtrado'}
        </p>
      )}

      {/* Delete-all confirmation */}
      {showDeleteAll && (
        <div className="card border border-red-500/40 space-y-3 animate-slide-up">
          <p className="text-sm text-slate-300">
            ¿Eliminar <strong className="text-white">todas las palabras</strong>?
            Esta acción no se puede deshacer.
          </p>
          <div className="flex gap-3">
            <button onClick={() => setShowDeleteAll(false)} className="btn-secondary flex-1">
              Cancelar
            </button>
            <button
              onClick={handleDeleteAll}
              disabled={isBusy}
              className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-xl px-4 py-2.5 font-medium transition-colors"
            >
              {isBusy ? 'Eliminando...' : 'Eliminar todo'}
            </button>
          </div>
        </div>
      )}

      {/* Add form */}
      {isAdding && (
        <form onSubmit={handleAdd} className="card space-y-3 animate-slide-up">
          <div className="grid grid-cols-2 gap-2">
            <input
              className="input"
              placeholder="Palabra (origen)"
              value={form.palabra}
              onChange={(e) => setAddField('palabra')(e.target.value)}
              required
            />
            <input
              className="input"
              placeholder="Significado"
              value={form.significado}
              onChange={(e) => setAddField('significado')(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <LanguageSelect languages={languages} value={form.idioma_origen} onChange={setAddField('idioma_origen')} />
            <LanguageSelect languages={languages} value={form.idioma_destino} onChange={setAddField('idioma_destino')} />
          </div>
          <TemaSelect
            temas={temas}
            value={form.tema_id}
            onChange={setAddField('tema_id')}
            onTemaCreated={(t) => setTemas((prev) => [...prev, t])}
          />
          <button type="submit" disabled={isBusy} className="btn-primary w-full">
            {isBusy ? 'Guardando...' : 'Guardar'}
          </button>
        </form>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="text-center text-slate-400 py-12">Cargando...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-5xl mb-3">{userWords.length === 0 ? '📭' : '🔍'}</div>
          <p className="text-slate-400">
            {userWords.length === 0
              ? 'Sin palabras todavía. ¡Añade la primera!'
              : 'Sin resultados para este filtro'}
          </p>
          {userWords.length > 0 && (
            <button
              onClick={() => { setFilterSearch(''); setFilterBox(null); setFilterTema(null) }}
              className="mt-3 text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      ) : viewMode === 'flashcard' ? (

        /* ── Flashcard mode ─────────────────────────────────────────────────── */
        <div className="flex flex-wrap gap-2">
          {filtered.map((uw) => {
            const isRevealed = revealed.has(uw.word.id)
            return isRevealed ? (
              <button
                key={uw.word.id}
                onClick={() => toggleReveal(uw)}
                className="w-full text-left bg-slate-800 border border-blue-500/40 rounded-2xl px-4 py-3 space-y-1 transition-all active:scale-[0.99]"
              >
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="font-semibold">{uw.word.palabra}</span>
                  <span className="text-slate-300 text-sm">→ {uw.word.significado}</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); speak(uw.word.palabra, uw.word.idioma_origen) }}
                    className="text-slate-400 hover:text-blue-400 transition-colors text-base leading-none"
                    title="Reproducir"
                  >
                    🔊
                  </button>
                  {uw.word.tema && (
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-medium text-white"
                      style={{ backgroundColor: uw.word.tema.color ?? '#64748b' }}
                    >
                      {uw.word.tema.nombre}
                    </span>
                  )}
                </div>
              </button>
            ) : (
              <button
                key={uw.word.id}
                onClick={() => toggleReveal(uw)}
                className="px-3 py-1.5 bg-slate-800 border border-slate-600 rounded-lg text-sm hover:bg-slate-700 hover:border-slate-500 transition-colors active:scale-95"
              >
                {flashSide === 'palabra' ? uw.word.palabra : uw.word.significado}
              </button>
            )
          })}
        </div>

      ) : (

        /* ── List mode ──────────────────────────────────────────────────────── */
        <div className="space-y-2">
          {filtered.map((uw) =>
            editId === uw.word.id ? (
              <WordEditForm
                key={uw.word.id}
                word={{
                  word_id: uw.word.id,
                  palabra: uw.word.palabra,
                  significado: uw.word.significado,
                  idioma_origen: uw.word.idioma_origen,
                  idioma_destino: uw.word.idioma_destino,
                  tema_id: uw.word.tema_id,
                }}
                onSaved={() => { setEditId(null); load() }}
                onCancel={() => setEditId(null)}
              />
            ) : (
              <div key={uw.word.id} className="card flex items-center gap-3 py-3">
                {uw.word.tema && (
                  <div
                    className="w-1.5 h-10 rounded-full shrink-0"
                    style={{ backgroundColor: uw.word.tema.color }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{uw.word.palabra}</p>
                  <p className="text-slate-400 text-sm truncate">{uw.word.significado}</p>
                  {uw.word.tema && (
                    <span
                      className="inline-block text-xs px-2 py-0.5 rounded-full font-medium text-white mt-0.5"
                      style={{ backgroundColor: uw.word.tema.color ?? '#64748b' }}
                    >
                      {uw.word.tema.nombre}
                    </span>
                  )}
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full text-slate-900 font-bold shrink-0 ${BOX_COLORS[uw.box_level]}`}
                >
                  C{uw.box_level}
                </span>
                <button
                  onClick={() => speak(uw.word.palabra, uw.word.idioma_origen)}
                  className="text-slate-500 hover:text-blue-400 transition-colors px-1 shrink-0 text-base"
                  title="Reproducir"
                >
                  🔊
                </button>
                <button
                  onClick={() => setEditId(uw.word.id)}
                  className="text-slate-500 hover:text-blue-400 transition-colors px-2 shrink-0"
                  title="Editar"
                >
                  ✎
                </button>
                <button
                  onClick={() => handleDelete(uw.word.id)}
                  className="text-slate-500 hover:text-red-400 transition-colors px-2 text-lg shrink-0"
                  title="Eliminar"
                >
                  ✕
                </button>
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}
