/**
 * GrammarWorkshop — AI-powered German grammar exercise generator.
 *
 * Three panels:
 *   1. Generate: topic, mode selector, grammar focus, AI suggestions, custom instructions, prose checker
 *   2. Solve: fill-in-the-blank player with per-blank inline feedback
 *   3. Saved: list of persisted exercises with score history
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { grammarApi, leoApi, wordsApi, type GrammarExerciseData, type GrammarSegment, type SavedGrammarExercise } from '../api/client'
import { useSettingsStore } from '../stores/settingsStore'
import { useUserProfileStore } from '../stores/userProfileStore'
import { getTip } from '../data/germanGrammarTips'
import GrammarTipModal from '../components/GrammarTipModal'
import type { TipLang } from '../data/germanGrammarTips'
import type { LeoEntry, LeoResult } from '../types'

type Panel = 'generate' | 'solve' | 'saved'

const GRAMMAR_FOCUS_OPTIONS = [
  { key: 'articles', label: { es: 'Artículos y declinación', en: 'Articles & declension', de: 'Artikel & Deklination', fr: 'Articles & déclinaison' } },
  { key: 'prepositions', label: { es: 'Preposiciones', en: 'Prepositions', de: 'Präpositionen', fr: 'Prépositions' } },
  { key: 'word_order', label: { es: 'Orden de palabras (Haupt/Nebensatz)', en: 'Word order (Haupt/Nebensatz)', de: 'Wortstellung (Haupt/Nebensatz)', fr: 'Ordre des mots' } },
  { key: 'verb_prepositions', label: { es: 'Verbos + preposición fija', en: 'Verb + fixed preposition', de: 'Verb + feste Präposition', fr: 'Verbe + préposition fixe' } },
  { key: 'adjective_endings', label: { es: 'Declinación de adjetivos', en: 'Adjective endings', de: 'Adjektivendungen', fr: 'Terminaisons adj.' } },
  { key: 'cases', label: { es: 'Casos (Nom/Akk/Dat/Gen)', en: 'Cases (Nom/Akk/Dat/Gen)', de: 'Kasus (Nom/Akk/Dat/Gen)', fr: 'Cas grammaticaux' } },
  { key: 'modal_verbs', label: { es: 'Verbos modales (können, müssen...)', en: 'Modal verbs (können, müssen...)', de: 'Modalverben (können, müssen...)', fr: 'Verbes modaux (können, müssen...)' } },
]

// ── Shuffle helper ────────────────────────────────────────────────────────────

function shuffleSegments(segments: GrammarSegment[] | undefined): GrammarSegment[] {
  if (!segments) return []
  return segments.map((seg) => {
    if (seg.t !== 'blank' || !seg.options || seg.options.length < 2) return seg
    const correctValue = seg.options[seg.correct ?? 0]
    const shuffled = [...seg.options].sort(() => Math.random() - 0.5)
    return { ...seg, options: shuffled, correct: shuffled.indexOf(correctValue) }
  })
}

// ── Sentence grouping ─────────────────────────────────────────────────────────

type SentenceGroup = { segs: GrammarSegment[]; rules: string[] }

/**
 * Group segments into "sentences" for visual separation.
 * A sentence ends when a text segment ends with . ! ? or a newline.
 */
function groupBySentence(segments: GrammarSegment[]): SentenceGroup[] {
  const groups: SentenceGroup[] = []
  let current: GrammarSegment[] = []
  let rules: string[] = []

  const flush = () => {
    if (current.length > 0) {
      groups.push({ segs: current, rules })
      current = []
      rules = []
    }
  }

  for (const seg of segments) {
    current.push(seg)
    if (seg.t === 'blank' && seg.rule) {
      rules.push(seg.rule)
    }
    if (seg.t === 'text' && seg.v) {
      const trimmed = seg.v.trimEnd()
      if (/[.!?\n]$/.test(trimmed)) {
        flush()
      }
    }
  }
  flush()
  return groups
}

/** Reconstruct plain German text from segments, replacing blanks with the correct answer. */
function resolveSegments(segments: GrammarSegment[] | undefined): string {
  if (!segments) return ''
  return segments.map((seg) => {
    if (seg.t === 'text') return seg.v ?? ''
    if (seg.t === 'blank' && seg.options) return seg.options[seg.correct ?? 0] ?? ''
    return ''
  }).join('')
}

// ── Exercise Player ───────────────────────────────────────────────────────────

interface BlankState {
  selected: string | null
  locked: boolean
}

interface RuleToast {
  rule: string
  correct: boolean
}

function ExercisePlayer({
  exercise,
  uiLang,
  savedId,
  onSave,
  onNew,
}: {
  exercise: GrammarExerciseData
  uiLang: TipLang
  savedId: number | null
  onSave: (id: number) => void
  onNew: () => void
}) {
  // Shuffle options once on mount
  const shuffledSegments = useMemo(() => shuffleSegments(exercise.segments), [exercise])
  const blanks = shuffledSegments.filter((s) => s.t === 'blank')
  const sentences = useMemo(() => groupBySentence(shuffledSegments), [shuffledSegments])

  const [blankStates, setBlankStates] = useState<Record<number, BlankState>>(() => {
    const init: Record<number, BlankState> = {}
    blanks.forEach((b) => { if (b.id !== undefined) init[b.id] = { selected: null, locked: false } })
    return init
  })
  const [showSolution, setShowSolution] = useState(false)
  const [showTip, setShowTip] = useState<string | null>(null)
  const [toast, setToast] = useState<RuleToast | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [saving, setSaving] = useState(false)
  // LEO vocabulary lookup (vocabulary panel)
  const [leoWord, setLeoWord] = useState<string | null>(null)
  const [leoResults, setLeoResults] = useState<LeoResult | null>(null)
  const [leoLoading, setLeoLoading] = useState(false)
  const [leoError, setLeoError] = useState<string | null>(null)
  const [leoAdded, setLeoAdded] = useState<Set<string>>(new Set())
  // LEO inline popup (click on text word)
  const [textPopupWord, setTextPopupWord] = useState<string | null>(null)
  const [textPopupResults, setTextPopupResults] = useState<LeoResult | null>(null)
  const [textPopupLoading, setTextPopupLoading] = useState(false)
  const [textPopupAdded, setTextPopupAdded] = useState<Set<string>>(new Set())
  const textPopupRef = useRef<HTMLDivElement | null>(null)
  const leoDropdownRef = useRef<HTMLDivElement | null>(null)
  const [saved, setSaved] = useState(savedId !== null)
  const [currentSavedId, setCurrentSavedId] = useState<number | null>(savedId)

  // Close LEO dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (textPopupRef.current && !textPopupRef.current.contains(e.target as Node)) {
        setTextPopupWord(null)
        setTextPopupResults(null)
      }
      if (leoDropdownRef.current && !leoDropdownRef.current.contains(e.target as Node)) {
        setLeoWord(null)
        setLeoResults(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const correctCount = blanks.filter((b) => {
    const bs = b.id !== undefined ? blankStates[b.id] : null
    return bs && bs.selected !== null && b.options && bs.selected === b.options[b.correct ?? 0]
  }).length
  const answeredCount = blanks.filter((b) => b.id !== undefined && blankStates[b.id]?.locked).length
  const allDone = answeredCount === blanks.length && blanks.length > 0

  const pick = (blankId: number, option: string, blank: GrammarSegment) => {
    const bs = blankStates[blankId]
    if (!bs || bs.locked) return
    const correct = blank.options?.[blank.correct ?? 0] ?? ''
    const isCorrect = option === correct
    setBlankStates((prev) => ({ ...prev, [blankId]: { selected: option, locked: true } }))
    if (answeredCount + 1 === blanks.length && currentSavedId) {
      const newCorrect = correctCount + (isCorrect ? 1 : 0)
      grammarApi.updateScore(currentSavedId, newCorrect, blanks.length).catch(() => {})
    }
    // Show rule toast
    if (blank.rule) {
      if (toastTimer.current) clearTimeout(toastTimer.current)
      setToast({ rule: blank.rule, correct: isCorrect })
      toastTimer.current = setTimeout(() => setToast(null), 4000)
    }
  }

  const handleSave = async () => {
    if (saved) return
    setSaving(true)
    try {
      const res = await grammarApi.saveExercise({
        title: exercise.title,
        topic: exercise.topic,
        segments_json: JSON.stringify(exercise.segments),
        grammar_notes_json: JSON.stringify(exercise.grammar_notes),
        vocabulary_used_json: JSON.stringify(exercise.vocabulary_used),
        score_correct: allDone ? correctCount : undefined,
        score_total: allDone ? blanks.length : undefined,
      })
      setCurrentSavedId(res.data.id)
      onSave(res.data.id)
      setSaved(true)
    } catch { /* ignore */ } finally {
      setSaving(false)
    }
  }

  const resetExercise = () => {
    setShowSolution(false)
    const init: Record<number, BlankState> = {}
    blanks.forEach((b) => { if (b.id !== undefined) init[b.id] = { selected: null, locked: false } })
    setBlankStates(init)
    setToast(null)
  }

  const revealSolution = () => {
    setShowSolution(true)
    setBlankStates((prev) => {
      const next = { ...prev }
      blanks.forEach((b) => {
        if (b.id !== undefined && !next[b.id]?.locked) {
          const correct = b.options?.[b.correct ?? 0] ?? ''
          next[b.id] = { selected: correct, locked: true }
        }
      })
      return next
    })
  }

  const chipClass = (blankId: number, option: string, blank: GrammarSegment) => {
    const bs = blankStates[blankId]
    const correct = blank.options?.[blank.correct ?? 0] ?? ''
    if (!bs || !bs.locked) {
      return 'border-slate-500 bg-slate-700/60 hover:bg-slate-600/80 hover:border-slate-400 cursor-pointer text-slate-200'
    }
    if (option === correct) return 'border-green-500 bg-green-500/20 text-green-200 cursor-default'
    if (option === bs.selected) return 'border-red-500 bg-red-500/20 text-red-300 cursor-default'
    return 'border-slate-600 bg-slate-800/40 text-slate-500 opacity-30 cursor-default'
  }

  const tipKey = (rule: string | undefined): string | null => {
    if (!rule) return null
    const lower = rule.toLowerCase()
    if (lower.includes('dativ') && lower.includes('akkusativ')) return 'dativ_vor_akkusativ'
    if (lower.includes('dativ') || lower.includes('dat')) return 'dative'
    if (lower.includes('akkusativ') || lower.includes('akk')) return 'accusative'
    if (lower.includes('genitiv') || lower.includes('gen')) return 'genitive'
    if (lower.includes('nominativ') || lower.includes('nom')) return 'nominative'
    if (lower.includes('wechsel')) return 'wechselpraep'
    if (lower.includes('nebensatz') || lower.includes('hauptsatz')) return 'hauptsatz_order'
    if (lower.includes('verb') && lower.includes('prä')) return 'verb_preps'
    if (lower.includes('adjektiv') || lower.includes('adjective')) return 'adj_weak'
    return null
  }

  const tip = showTip ? getTip(showTip) : null

  // Collect all blanks with their ids for footnote index
  const blankFootnotes = blanks.filter((b) => b.rule)

  // LEO lookup
  const lookupLeo = async (word: string) => {
    if (leoWord === word) { setLeoWord(null); setLeoResults(null); return }
    setLeoWord(word)
    setLeoResults(null)
    setLeoError(null)
    setLeoLoading(true)
    try {
      const { data } = await leoApi.lookup(word, 'esde', 5)
      if (!data.entries?.length) setLeoError('Sin resultados')
      else setLeoResults(data)
    } catch { setLeoError('Error LEO') }
    finally { setLeoLoading(false) }
  }

  const addWordFromLeo = async (entry: LeoEntry) => {
    const deSide = entry.sides.find((s) => s.lang === 'de') ?? entry.sides[1]
    const esSide = entry.sides.find((s) => s.lang === 'es') ?? entry.sides[0]
    if (!deSide || !esSide) return
    try {
      await wordsApi.create({
        palabra: deSide.text,
        significado: esSide.text,
        idioma_origen: 'de',
        idioma_destino: 'es',
        audio_url: deSide.audio?.[0]?.mp3_url ?? null,
        audio_url_translation: esSide.audio?.[0]?.mp3_url ?? null,
        audio_text: deSide.audio?.[0]?.label ?? deSide.text,
        audio_text_translation: esSide.audio?.[0]?.label ?? esSide.text,
        category: entry.category ?? null,
        source: 'leo',
      })
      setLeoAdded((prev) => new Set(prev).add(deSide.text))
    } catch { /* ignore */ }
  }

  // Click on a text word in the exercise
  const lookupTextWord = async (word: string) => {
    const clean = word.replace(/[.,!?;:()"""''«»]/g, '').trim()
    if (!clean || clean.length < 2) return
    if (textPopupWord === clean) { setTextPopupWord(null); setTextPopupResults(null); return }
    setTextPopupWord(clean)
    setTextPopupResults(null)
    setTextPopupLoading(true)
    try {
      const { data } = await leoApi.lookup(clean, 'esde', 4)
      setTextPopupResults(data.entries?.length ? data : null)
    } catch { /* silent */ }
    finally { setTextPopupLoading(false) }
  }

  const addFromTextPopup = async (entry: LeoEntry) => {
    const deSide = entry.sides.find((s) => s.lang === 'de') ?? entry.sides[1]
    const esSide = entry.sides.find((s) => s.lang === 'es') ?? entry.sides[0]
    if (!deSide || !esSide) return
    try {
      await wordsApi.create({
        palabra: deSide.text, significado: esSide.text,
        idioma_origen: 'de', idioma_destino: 'es',
        audio_url: deSide.audio?.[0]?.mp3_url ?? null,
        audio_url_translation: esSide.audio?.[0]?.mp3_url ?? null,
        audio_text: deSide.audio?.[0]?.label ?? deSide.text,
        audio_text_translation: esSide.audio?.[0]?.label ?? esSide.text,
        category: entry.category ?? null, source: 'leo',
      })
      setTextPopupAdded((prev) => new Set(prev).add(deSide.text))
    } catch { /* ignore */ }
  }

  return (
    <div className="space-y-5">
      {tip && <GrammarTipModal tip={tip} lang={uiLang} onClose={() => setShowTip(null)} />}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl border shadow-lg text-sm max-w-sm text-center transition-all duration-300 ${
            toast.correct
              ? 'bg-green-900/90 border-green-500/50 text-green-200'
              : 'bg-red-900/90 border-red-500/50 text-red-200'
          }`}
        >
          <span className="font-semibold mr-1">{toast.correct ? '✓' : '✗'}</span>
          {toast.rule}
        </div>
      )}

      {/* Title + progress */}
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-lg text-white">{exercise.title}</h2>
        <span className="text-xs text-slate-400">{answeredCount}/{blanks.length}</span>
      </div>

      {/* Progress bar */}
      <div className="bg-slate-700 rounded-full h-1.5">
        <div
          className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
          style={{ width: blanks.length > 0 ? `${(answeredCount / blanks.length) * 100}%` : '0%' }}
        />
      </div>

      {/* Exercise — one sentence per line */}
      <div className="card space-y-5 relative">
        {/* Text word LEO popup */}
        {textPopupWord && (
          <div
            ref={textPopupRef}
            className="absolute z-40 top-0 left-0 right-0 mx-auto max-w-xs bg-slate-800 border border-slate-600 rounded-xl shadow-xl overflow-hidden"
          >
            <div className="px-3 py-2 border-b border-slate-700 flex items-center justify-between">
              <span className="text-xs text-slate-400">LEO · <span className="text-yellow-300 font-medium">{textPopupWord}</span></span>
              <button onClick={() => { setTextPopupWord(null); setTextPopupResults(null) }} className="text-slate-500 hover:text-slate-300 text-xs">✕</button>
            </div>
            {textPopupLoading && <p className="text-xs text-slate-400 px-3 py-3">Buscando...</p>}
            {!textPopupLoading && !textPopupResults && <p className="text-xs text-slate-500 px-3 py-3">Sin resultados</p>}
            {textPopupResults && (
              <div className="divide-y divide-slate-700/50 max-h-48 overflow-y-auto">
                {textPopupResults.entries.map((entry, i) => {
                  const deSide = entry.sides.find((s) => s.lang === 'de') ?? entry.sides[1]
                  const esSide = entry.sides.find((s) => s.lang === 'es') ?? entry.sides[0]
                  if (!deSide || !esSide) return null
                  const added = textPopupAdded.has(deSide.text)
                  return (
                    <div key={entry.aiid || i} className="px-3 py-2 flex items-center gap-2 hover:bg-slate-700/50 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-100 truncate">{deSide.text}</p>
                        <p className="text-xs text-slate-400 truncate">{esSide.text}</p>
                      </div>
                      <button
                        onClick={() => addFromTextPopup(entry)}
                        disabled={added}
                        className={`text-xs px-2 py-0.5 rounded shrink-0 transition-colors ${added ? 'bg-green-900/40 text-green-400 cursor-default' : 'bg-slate-700 hover:bg-green-700 text-slate-300 hover:text-white'}`}
                      >
                        {added ? '✓' : '+'}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {sentences.map((group, gi) => (
          <div key={gi}>
            <p className="text-white text-base leading-relaxed">
              {group.segs.map((seg, si) => {
                if (seg.t === 'text') {
                  // Split text into clickable words
                  const words = (seg.v ?? '').split(/(\s+)/)
                  return (
                    <span key={si}>
                      {words.map((token, ti) =>
                        /^\s+$/.test(token) ? (
                          <span key={ti}>{token}</span>
                        ) : (
                          <span
                            key={ti}
                            onClick={() => lookupTextWord(token)}
                            className="italic text-slate-200 cursor-pointer hover:text-white hover:underline decoration-dotted underline-offset-2 transition-colors"
                          >
                            {token}
                          </span>
                        )
                      )}
                    </span>
                  )
                }
                if (seg.t === 'blank' && seg.id !== undefined) {
                  const blankId = seg.id
                  const bs = blankStates[blankId]
                  const isLocked = bs?.locked ?? false
                  const footnoteIdx = blankFootnotes.findIndex((b) => b.id === blankId)

                  return (
                    <span key={si} className="inline-flex items-baseline gap-1 flex-wrap mx-0.5">
                      {seg.options?.map((opt) => (
                        <button
                          key={opt}
                          onClick={() => pick(blankId, opt, seg)}
                          disabled={isLocked}
                          className={`px-2 py-0.5 rounded-md border text-sm font-medium transition-all duration-200 ${chipClass(blankId, opt, seg)}`}
                        >
                          {opt}
                        </button>
                      ))}
                      {footnoteIdx >= 0 && (
                        <sup className="text-[9px] text-slate-500 leading-none ml-0.5">{footnoteIdx + 1}</sup>
                      )}
                    </span>
                  )
                }
                return null
              })}
            </p>
          </div>
        ))}
      </div>

      {/* Merged notes section — footnotes (per blank) + general grammar notes */}
      {(blankFootnotes.some((b) => b.id !== undefined && blankStates[b.id]?.locked) || (allDone && exercise.grammar_notes.length > 0)) && (
        <div className="card border border-slate-700/60 space-y-1.5">
          <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-2">
            {uiLang === 'en' ? 'Grammar notes' : uiLang === 'de' ? 'Grammatiknotizen' : uiLang === 'fr' ? 'Notes de grammaire' : 'Notas gramaticales'}
          </p>
          {/* Per-blank footnotes — only answered ones */}
          {blankFootnotes.map((b, i) => {
            const bs = b.id !== undefined ? blankStates[b.id] : null
            const answered = bs?.locked ?? false
            if (!answered) return null
            const correct = b.options?.[b.correct ?? 0] ?? ''
            const isCorrect = bs?.selected === correct
            const tk = tipKey(b.rule)
            return (
              <div key={i} className="flex items-start gap-2">
                <sup className="text-[9px] text-slate-500 mt-1 shrink-0">{i + 1}</sup>
                <span className={`text-[11px] leading-snug flex-1 ${isCorrect ? 'text-green-300' : 'text-red-300'}`}>
                  {!isCorrect && <span className="font-semibold mr-1">→ {correct}.</span>}
                  {b.rule}
                </span>
                {tk && (
                  <button onClick={() => setShowTip(tk)} className="text-yellow-400 hover:text-yellow-300 text-xs shrink-0" title="Ver regla">💡</button>
                )}
              </div>
            )
          })}
          {/* General grammar notes — only when all done */}
          {allDone && exercise.grammar_notes.map((note, i) => (
            <p key={`gn-${i}`} className="text-xs text-slate-300 ml-3">• {note}</p>
          ))}
        </div>
      )}

      {/* Score summary when done */}
      {allDone && (
        <div className="card text-center border border-blue-500/30 bg-blue-500/5">
          <p className="text-xl font-bold text-white">
            {correctCount}/{blanks.length} ({blanks.length > 0 ? Math.round((correctCount / blanks.length) * 100) : 0}%)
          </p>
          <p className="text-slate-400 text-sm mt-1">
            {uiLang === 'de' ? 'Übung abgeschlossen' : uiLang === 'en' ? 'Exercise completed' : uiLang === 'fr' ? 'Exercice terminé' : 'Ejercicio completado'}
          </p>
        </div>
      )}

      {/* Vocabulary panel with LEO lookup */}
      {exercise.vocabulary_used.length > 0 && (
        <div className="card border border-slate-700/60 space-y-2">
          <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
            {uiLang === 'en' ? 'Vocabulary' : uiLang === 'de' ? 'Vokabular' : uiLang === 'fr' ? 'Vocabulaire' : 'Vocabulario'}
          </p>
          <p className="text-sm text-slate-300 leading-relaxed">
            {exercise.vocabulary_used.map((word, i) => (
              <span key={word}>
                <button
                  onClick={() => lookupLeo(word)}
                  className={`hover:underline transition-colors ${leoWord === word ? 'text-yellow-300' : 'text-blue-300 hover:text-blue-200'}`}
                  title={`Buscar "${word}" en LEO`}
                >
                  {word}
                </button>
                {i < exercise.vocabulary_used.length - 1 && (
                  <span className="text-slate-600">, </span>
                )}
              </span>
            ))}
          </p>

          {/* LEO results dropdown */}
          {leoWord && (
            <div ref={leoDropdownRef} className="mt-2 rounded-xl border border-slate-600 bg-slate-800 overflow-hidden">
              <div className="px-3 py-2 border-b border-slate-700 flex items-center justify-between">
                <span className="text-xs text-slate-400">LEO · <span className="text-yellow-300 font-medium">{leoWord}</span></span>
                <button onClick={() => { setLeoWord(null); setLeoResults(null) }} className="text-slate-500 hover:text-slate-300 text-xs">✕</button>
              </div>
              {leoLoading && <p className="text-xs text-slate-400 px-3 py-3">Buscando...</p>}
              {leoError && <p className="text-xs text-red-400 px-3 py-3">{leoError}</p>}
              {leoResults && (
                <div className="divide-y divide-slate-700/50 max-h-60 overflow-y-auto">
                  {leoResults.entries.map((entry, i) => {
                    const deSide = entry.sides.find((s) => s.lang === 'de') ?? entry.sides[1]
                    const esSide = entry.sides.find((s) => s.lang === 'es') ?? entry.sides[0]
                    if (!deSide || !esSide) return null
                    const added = leoAdded.has(deSide.text)
                    return (
                      <div key={entry.aiid || i} className="px-3 py-2.5 flex items-center gap-2 hover:bg-slate-700/50 transition-colors">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-100 truncate">{deSide.text}</p>
                          <p className="text-xs text-slate-400 truncate">{esSide.text}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {deSide.audio?.length > 0 && <span className="text-blue-400 text-xs">🔊</span>}
                          <button
                            onClick={() => addWordFromLeo(entry)}
                            disabled={added}
                            className={`text-xs px-2 py-0.5 rounded transition-colors ${added ? 'bg-green-900/40 text-green-400 cursor-default' : 'bg-slate-700 hover:bg-green-700 text-slate-300 hover:text-white'}`}
                            title={added ? 'Ya agregada' : 'Agregar a mis palabras'}
                          >
                            {added ? '✓' : '+'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="space-y-2">
        {/* Ver solución — only when not all done */}
        {!allDone && !showSolution && (
          <button
            onClick={revealSolution}
            className="w-full py-2 rounded-xl border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 text-sm transition-colors"
          >
            {uiLang === 'de' ? 'Lösung anzeigen' : uiLang === 'en' ? 'Show solution' : uiLang === 'fr' ? 'Voir la solution' : 'Ver solución'}
          </button>
        )}
        <div className="flex gap-3">
          {(allDone || showSolution) && (
            <button
              onClick={resetExercise}
              className="flex-1 py-2.5 rounded-xl border border-slate-600 text-slate-300 hover:border-slate-500 hover:text-white text-sm font-medium transition-colors"
            >
              {uiLang === 'de' ? '↺ Neu starten' : uiLang === 'en' ? '↺ Restart' : uiLang === 'fr' ? '↺ Recommencer' : '↺ Reiniciar'}
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saved || saving}
            className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
              saved
                ? 'border-green-500/40 text-green-400 bg-green-500/10'
                : 'border-slate-600 text-slate-300 hover:border-blue-500/40 hover:text-blue-300'
            }`}
          >
            {saving ? '...' : saved ? `✓ ${uiLang === 'de' ? 'Gespeichert' : uiLang === 'en' ? 'Saved' : uiLang === 'fr' ? 'Enregistré' : 'Guardado'}` : uiLang === 'de' ? 'Speichern' : uiLang === 'en' ? 'Save exercise' : uiLang === 'fr' ? 'Enregistrer' : 'Guardar'}
          </button>
          <button onClick={onNew} className="flex-1 btn-primary py-2.5 text-sm">
            {uiLang === 'de' ? 'Neu generieren' : uiLang === 'en' ? 'New exercise' : uiLang === 'fr' ? 'Nouvel exercice' : 'Nuevo ejercicio'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Prose Checker ─────────────────────────────────────────────────────────────

function ProseChecker({
  model,
  timeout,
  uiLang,
  initialText = '',
  onGenerateFromText,
}: {
  model: string
  timeout: number
  uiLang: TipLang
  initialText?: string
  onGenerateFromText?: (text: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(initialText)
  const [checking, setChecking] = useState(false)
  const [showFeedback, setShowFeedback] = useState(true)

  useEffect(() => {
    if (initialText) setText(initialText)
  }, [initialText])
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const check = async () => {
    if (!text.trim() || !model) return
    setChecking(true)
    setFeedback(null)
    setError(null)
    try {
      const res = await grammarApi.checkProse({ text: text.trim(), interface_lang: uiLang, model, timeout })
      setFeedback(res.data.feedback)
      setShowFeedback(true)
    } catch {
      setError('Error al contactar el modelo')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1"
      >
        {open ? '▼' : '▶'}
        {uiLang === 'en' ? 'Check German text with AI' : 'Corregir texto alemán con IA'}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder={uiLang === 'en' ? 'Paste or type German text here...' : 'Pegá o escribí aquí el texto en alemán...'}
            className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500 resize-none"
          />
          <div className="flex gap-2">
            <button
              onClick={check}
              disabled={!text.trim() || checking || !model}
              className="flex-1 btn-primary py-2 text-sm disabled:opacity-50"
            >
              {checking ? '⏳ Revisando...' : uiLang === 'en' ? 'Check grammar →' : 'Revisar gramática →'}
            </button>
            {onGenerateFromText && (
              <button
                onClick={() => onGenerateFromText(text.trim())}
                disabled={!text.trim() || checking || !model}
                className="flex-1 py-2 rounded-xl border border-blue-500/50 text-blue-300 hover:bg-blue-500/10 text-sm transition-colors disabled:opacity-50"
              >
                {uiLang === 'en' ? 'Generate exercise →' : 'Generar ejercicio →'}
              </button>
            )}
          </div>
          {error && (
            <p className="text-xs text-red-400">✗ {error}</p>
          )}
          {feedback && (
            <div className="card border border-slate-600 bg-slate-800/60 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                  {uiLang === 'en' ? 'AI feedback' : uiLang === 'de' ? 'KI-Korrektur' : uiLang === 'fr' ? 'Correction IA' : 'Corrección de la IA'}
                </p>
                <button
                  onClick={() => setShowFeedback((v) => !v)}
                  className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showFeedback
                    ? (uiLang === 'en' ? 'Hide' : uiLang === 'de' ? 'Verstecken' : uiLang === 'fr' ? 'Masquer' : 'Ocultar')
                    : (uiLang === 'en' ? 'Show' : uiLang === 'de' ? 'Anzeigen' : uiLang === 'fr' ? 'Afficher' : 'Mostrar')}
                </button>
              </div>
              {showFeedback && (
                <p className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">{feedback}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Saved Exercises List ──────────────────────────────────────────────────────

function SavedList({
  exercises,
  onLoad,
  onDelete,
  uiLang,
}: {
  exercises: SavedGrammarExercise[]
  onLoad: (ex: SavedGrammarExercise) => void
  onDelete: (id: number) => void
  uiLang: TipLang
}) {
  if (exercises.length === 0) {
    return (
      <p className="text-center text-slate-500 text-sm py-8">
        {uiLang === 'de' ? 'Noch keine gespeicherten Übungen.' : uiLang === 'en' ? 'No saved exercises yet.' : uiLang === 'fr' ? 'Aucun exercice sauvegardé.' : 'No hay ejercicios guardados.'}
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {exercises.map((ex) => {
        const pct = ex.score_total ? Math.round(((ex.score_correct ?? 0) / ex.score_total) * 100) : null
        return (
          <div
            key={ex.id}
            className="card flex items-center justify-between gap-3 cursor-pointer hover:border-blue-500/40 transition-colors"
            onClick={() => onLoad(ex)}
          >
            <div className="flex-1 min-w-0">
              <p className="font-medium text-white text-sm truncate">{ex.title}</p>
              <p className="text-xs text-slate-400 truncate">{ex.topic}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {pct !== null && (
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${pct >= 80 ? 'bg-green-500/20 text-green-300' : pct >= 50 ? 'bg-yellow-500/20 text-yellow-300' : 'bg-red-500/20 text-red-300'}`}>
                  {pct}%
                </span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(ex.id) }}
                className="text-slate-600 hover:text-red-400 transition-colors text-sm"
              >
                ✕
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Main Workshop Page ────────────────────────────────────────────────────────

export default function GrammarWorkshop() {
  const {
    ollamaTranslationModel, ollamaTimeout, ollamaPromptGrammar,
    grammarTemperature, grammarNumPredict, grammarTopP,
    grammarMode, grammarRollingSentences, grammarDoubleCorrect, grammarMaxBlanks,
    setGrammarMode, setGrammarRollingSentences,
  } = useSettingsStore()
  const { uiLanguage } = useUserProfileStore()
  const uiLang = (uiLanguage as TipLang) ?? 'es'

  const [panel, setPanel] = useState<Panel>('generate')
  const [topic, setTopic] = useState('')
  const [customInstructions, setCustomInstructions] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [grammarFocus, setGrammarFocus] = useState<string[]>(['articles', 'prepositions', 'word_order'])
  const [customFocusList, setCustomFocusList] = useState<string[]>([])
  const [customFocusInput, setCustomFocusInput] = useState('')
  const [editingCustomFocus, setEditingCustomFocus] = useState<number | null>(null)
  const [editingCustomFocusValue, setEditingCustomFocusValue] = useState('')
  const [generating, setGenerating] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [lastProse, setLastProse] = useState('')
  const [loadingPrompt, setLoadingPrompt] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [exercise, setExercise] = useState<GrammarExerciseData | null>(null)
  const [currentSavedId, setCurrentSavedId] = useState<number | null>(null)
  const [savedExercises, setSavedExercises] = useState<SavedGrammarExercise[]>([])
  const [loadingSaved, setLoadingSaved] = useState(false)

  const model = ollamaTranslationModel
  const timeout = ollamaTimeout
  const noModel = !model

  const labelFor = (option: { label: Record<string, string> }) =>
    option.label[uiLang] ?? option.label.en

  const toggleFocus = (key: string) => {
    setGrammarFocus((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    )
  }

  const _doGenerate = async (proseOverride?: string) => {
    if (!model) return
    setGenerating(true)
    setElapsed(0)
    setError(null)
    setExercise(null)
    setCurrentSavedId(null)
    elapsedRef.current = setInterval(() => setElapsed((s) => s + 1), 1000)
    try {
      const effectiveMode = proseOverride
        ? 'two_phase'
        : grammarMode === 'custom' && !customInstructions.trim() ? 'two_phase' : grammarMode
      const prompt = !proseOverride && grammarMode === 'custom'
        ? (customInstructions.trim() || ollamaPromptGrammar || undefined)
        : undefined
      const res = await grammarApi.generate({
        topic: topic.trim() || 'German text',
        interface_lang: uiLang,
        grammar_focus: customFocusList.length > 0 ? [...grammarFocus, ...customFocusList] : grammarFocus,
        vocabulary: [],
        model,
        timeout,
        custom_prompt: prompt,
        temperature: grammarTemperature ?? undefined,
        num_predict: grammarNumPredict ?? undefined,
        top_p: grammarTopP ?? undefined,
        mode: effectiveMode,
        rolling_sentences: grammarRollingSentences,
        prose_override: proseOverride,
        double_correct: grammarDoubleCorrect,
        max_blanks: grammarMaxBlanks,
      })
      setExercise(res.data)
      setLastProse(resolveSegments(res.data.segments))
      setPanel('solve')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Error al generar el ejercicio'
      setError(msg)
    } finally {
      if (elapsedRef.current) clearInterval(elapsedRef.current)
      setGenerating(false)
    }
  }

  const generate = () => {
    if (!topic.trim() || !model) return
    _doGenerate()
  }

  const generateFromProse = (prose: string) => {
    _doGenerate(prose)
  }

  const loadDefaultPrompt = async () => {
    setLoadingPrompt(true)
    try {
      const res = await grammarApi.getDefaultPrompt(grammarMode)
      setCustomInstructions(res.data.prompt)
      setShowCustom(true)
    } catch { /* ignore */ } finally {
      setLoadingPrompt(false)
    }
  }

  const suggestTopics = async () => {
    if (!model) return
    setSuggesting(true)
    try {
      const res = await grammarApi.suggestTopics({ interface_lang: uiLang, model, timeout })
      setSuggestions(res.data.topics ?? [])
    } catch { /* ignore */ } finally {
      setSuggesting(false)
    }
  }

  const loadSaved = async () => {
    setLoadingSaved(true)
    try {
      const res = await grammarApi.listExercises()
      setSavedExercises(res.data)
    } catch { /* ignore */ } finally {
      setLoadingSaved(false)
    }
  }

  const deleteExercise = async (id: number) => {
    try {
      await grammarApi.deleteExercise(id)
      setSavedExercises((prev) => prev.filter((e) => e.id !== id))
    } catch { /* ignore */ }
  }

  const loadExerciseFromSaved = async (ex: SavedGrammarExercise) => {
    try {
      // listExercises returns summary without segments — fetch full exercise
      const res = await grammarApi.getExercise(ex.id)
      const full = res.data
      const parsed: GrammarExerciseData = {
        title: full.title,
        topic: full.topic,
        segments: full.segments ?? [],
        grammar_notes: full.grammar_notes ?? [],
        vocabulary_used: full.vocabulary_used ?? [],
      }
      setExercise(parsed)
      setCurrentSavedId(ex.id)
      setPanel('solve')
    } catch {
      setError('No se pudo cargar el ejercicio guardado')
    }
  }

  useEffect(() => {
    if (panel === 'saved') loadSaved()
  }, [panel])

  const tabs: { key: Panel; label: string }[] = [
    { key: 'generate', label: uiLang === 'de' ? 'Generieren' : uiLang === 'en' ? 'Generate' : uiLang === 'fr' ? 'Générer' : 'Generar' },
    { key: 'solve', label: uiLang === 'de' ? 'Lösen' : uiLang === 'en' ? 'Solve' : uiLang === 'fr' ? 'Résoudre' : 'Resolver' },
    { key: 'saved', label: uiLang === 'de' ? 'Gespeichert' : uiLang === 'en' ? 'Saved' : uiLang === 'fr' ? 'Sauvegardés' : 'Guardados' },
  ]

  // Mode labels — Rolling first (default)
  const modeOptions: { key: 'two_phase' | 'rolling' | 'custom'; label: string; desc: string }[] = [
    {
      key: 'rolling',
      label: uiLang === 'en' ? 'Rolling (iterative)' : uiLang === 'de' ? 'Iterativ' : uiLang === 'fr' ? 'Itératif' : 'Iterativo',
      desc: uiLang === 'en' ? 'Build sentence by sentence with context' : uiLang === 'de' ? 'Satz für Satz mit akkumuliertem Kontext' : uiLang === 'fr' ? 'Construit phrase par phrase avec contexte' : 'Construye oración a oración con contexto acumulado',
    },
    {
      key: 'two_phase',
      label: uiLang === 'en' ? 'Two-Phase' : uiLang === 'de' ? 'Zweiphasig' : uiLang === 'fr' ? 'Deux phases' : 'Dos fases',
      desc: uiLang === 'en' ? 'Generate prose first, then convert to exercise' : uiLang === 'de' ? 'Erst Prosa, dann Übung' : uiLang === 'fr' ? 'Prose d\'abord, puis exercice' : 'Genera prosa primero, luego convierte a ejercicio',
    },
    {
      key: 'custom',
      label: uiLang === 'en' ? 'Custom prompt' : uiLang === 'de' ? 'Eigener Prompt' : uiLang === 'fr' ? 'Prompt personnalisé' : 'Prompt propio',
      desc: uiLang === 'en' ? 'Use your own prompt template' : uiLang === 'de' ? 'Eigenes Prompt-Template' : uiLang === 'fr' ? 'Votre propre template de prompt' : 'Usa tu propio template de prompt',
    },
  ]

  return (
    <div className="p-4 pt-6 max-w-lg mx-auto min-h-screen">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl font-bold text-white">
          📝 {uiLang === 'de' ? 'Grammatik-Workshop' : uiLang === 'en' ? 'Grammar Workshop' : uiLang === 'fr' ? 'Atelier de grammaire' : 'Taller de Gramática'}
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          {uiLang === 'de' ? 'KI generiert deutsche Grammatikübungen für dich' : uiLang === 'en' ? 'AI generates German grammar exercises for you' : uiLang === 'fr' ? "L'IA génère des exercices de grammaire allemande" : 'La IA genera ejercicios de gramática alemana'}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-5 bg-slate-800 rounded-xl p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => {
              if (tab.key === 'solve' && !exercise) return
              setPanel(tab.key)
            }}
            disabled={tab.key === 'solve' && !exercise}
            className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${
              panel === tab.key
                ? 'bg-blue-600 text-white'
                : tab.key === 'solve' && !exercise
                ? 'text-slate-600 cursor-not-allowed'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Panel: Generate */}
      <div className={panel === 'generate' ? 'space-y-5' : 'hidden'}>
          {noModel && (
            <div className="card border border-amber-500/40 bg-amber-500/10 text-amber-300 text-sm">
              ⚠ {uiLang === 'de' ? 'Kein Ollama-Modell konfiguriert. Gehe zu Einstellungen → Ollama.' : uiLang === 'en' ? 'No Ollama model configured. Go to Settings → Ollama.' : 'No hay modelo Ollama configurado. Ve a Configuración → Ollama.'}
            </div>
          )}

          {/* Topic */}
          <div>
            <label className="text-xs font-medium text-slate-400 block mb-1">
              {uiLang === 'de' ? 'Thema' : uiLang === 'en' ? 'Topic' : uiLang === 'fr' ? 'Thème' : 'Tema'}
            </label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={uiLang === 'de' ? 'z.B. Im Restaurant' : uiLang === 'en' ? 'e.g. At the restaurant' : 'p.ej. En el restaurante'}
              className="input w-full"
              onKeyDown={(e) => { if (e.key === 'Enter') generate() }}
            />
          </div>

          {/* AI suggestions */}
          <div>
            <button
              onClick={suggestTopics}
              disabled={suggesting || noModel}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-50"
            >
              {suggesting ? '⏳ ' : '💡 '}
              {uiLang === 'de' ? 'KI-Ideen →' : uiLang === 'en' ? 'Get AI ideas →' : uiLang === 'fr' ? "Idées de l'IA →" : 'Pedir ideas a la IA →'}
            </button>
            {suggestions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => setTopic(s)}
                    className="text-xs px-2.5 py-1 rounded-lg border border-slate-600 text-slate-300 hover:border-blue-500/50 hover:text-blue-300 transition-colors text-left shrink-0"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Generation mode selector */}
          <div>
            <p className="text-xs font-medium text-slate-400 mb-2">
              {uiLang === 'en' ? 'Generation mode' : 'Modo de generación'}
            </p>
            <div className="space-y-1.5">
              {modeOptions.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setGrammarMode(opt.key)}
                  className={`w-full text-left px-3 py-2 rounded-xl border text-xs transition-colors ${
                    grammarMode === opt.key
                      ? 'border-blue-500 bg-blue-500/10 text-blue-200'
                      : 'border-slate-700 text-slate-400 hover:border-slate-600'
                  }`}
                >
                  <span className="font-medium text-sm">{opt.label}</span>
                  <span className="text-slate-500 ml-2">— {opt.desc}</span>
                </button>
              ))}
            </div>

            {/* Rolling sentences count */}
            {grammarMode === 'rolling' && (
              <div className="mt-3 flex items-center gap-3">
                <span className="text-xs text-slate-400">
                  {uiLang === 'en' ? 'Sentences:' : 'Oraciones:'}
                </span>
                <button
                  onClick={() => setGrammarRollingSentences(grammarRollingSentences - 1)}
                  disabled={grammarRollingSentences <= 2}
                  className="w-7 h-7 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm font-bold disabled:opacity-30"
                >−</button>
                <span className="text-white font-mono text-sm w-4 text-center">{grammarRollingSentences}</span>
                <button
                  onClick={() => setGrammarRollingSentences(grammarRollingSentences + 1)}
                  disabled={grammarRollingSentences >= 12}
                  className="w-7 h-7 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm font-bold disabled:opacity-30"
                >+</button>
              </div>
            )}
          </div>

          {/* Grammar focus */}
          <div>
            <p className="text-xs font-medium text-slate-400 mb-2">
              {uiLang === 'de' ? 'Grammatikschwerpunkte' : uiLang === 'en' ? 'Grammar focus' : uiLang === 'fr' ? 'Points de grammaire' : 'Enfoque gramatical'}
            </p>
            <div className="flex flex-wrap gap-2">
              {GRAMMAR_FOCUS_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => toggleFocus(opt.key)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    grammarFocus.includes(opt.key)
                      ? 'border-blue-500 bg-blue-500/20 text-blue-200'
                      : 'border-slate-600 text-slate-400 hover:border-slate-500'
                  }`}
                >
                  {labelFor(opt)}
                </button>
              ))}
              {/* Custom focus chips */}
              {customFocusList.map((label, idx) => (
                <span key={idx} className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full border border-purple-500 bg-purple-500/20 text-purple-200">
                  {editingCustomFocus === idx ? (
                    <input
                      autoFocus
                      value={editingCustomFocusValue}
                      onChange={(e) => setEditingCustomFocusValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const v = editingCustomFocusValue.trim()
                          if (v) setCustomFocusList((prev) => prev.map((x, i) => i === idx ? v : x))
                          setEditingCustomFocus(null)
                        }
                        if (e.key === 'Escape') setEditingCustomFocus(null)
                      }}
                      onBlur={() => {
                        const v = editingCustomFocusValue.trim()
                        if (v) setCustomFocusList((prev) => prev.map((x, i) => i === idx ? v : x))
                        setEditingCustomFocus(null)
                      }}
                      className="bg-transparent outline-none w-24 text-purple-100"
                    />
                  ) : (
                    <span
                      onClick={() => { setEditingCustomFocus(idx); setEditingCustomFocusValue(label) }}
                      className="cursor-text"
                      title={uiLang === 'en' ? 'Click to rename' : 'Click para renombrar'}
                    >
                      {label}
                    </span>
                  )}
                  <button
                    onClick={() => setCustomFocusList((prev) => prev.filter((_, i) => i !== idx))}
                    className="text-purple-400 hover:text-red-400 transition-colors ml-0.5"
                    title={uiLang === 'en' ? 'Remove' : 'Eliminar'}
                  >×</button>
                </span>
              ))}
            </div>
            {/* Add custom focus */}
            <div className="mt-2 flex items-center gap-2">
              <input
                type="text"
                value={customFocusInput}
                onChange={(e) => setCustomFocusInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && customFocusInput.trim()) {
                    setCustomFocusList((prev) => [...prev, customFocusInput.trim()])
                    setCustomFocusInput('')
                  }
                }}
                placeholder={uiLang === 'en' ? '+ Custom focus (Enter to add)' : uiLang === 'de' ? '+ Eigener Fokus (Enter)' : '+ Foco personalizado (Enter)'}
                className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-1 text-xs text-slate-200 focus:outline-none focus:border-purple-500 placeholder-slate-600"
              />
              {customFocusInput.trim() && (
                <button
                  onClick={() => { setCustomFocusList((prev) => [...prev, customFocusInput.trim()]); setCustomFocusInput('') }}
                  className="text-xs px-2.5 py-1 rounded-lg border border-purple-500 text-purple-300 hover:bg-purple-500/10 transition-colors shrink-0"
                >
                  +
                </button>
              )}
            </div>
          </div>

          {/* Custom instructions — visible in all modes */}
          <div>
            <div className="flex items-center justify-between">
              <button
                onClick={() => setShowCustom((v) => !v)}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1"
              >
                {showCustom ? '▼' : '▶'}
                {uiLang === 'en' ? 'Prompt instructions' : 'Instrucciones del prompt'}
              </button>
              <button
                onClick={loadDefaultPrompt}
                disabled={loadingPrompt}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-50"
                title={uiLang === 'en' ? 'Load default prompt for current mode' : 'Cargar prompt predeterminado del modo actual'}
              >
                {loadingPrompt ? '⏳' : '⬇'}{' '}
                {uiLang === 'de' ? 'Standard laden' : uiLang === 'en' ? 'Load default' : uiLang === 'fr' ? 'Charger défaut' : 'Cargar predeterminado'}
              </button>
            </div>
            {showCustom && (
              <textarea
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                rows={5}
                placeholder={
                  grammarMode === 'two_phase'
                    ? (uiLang === 'en' ? 'Override Phase 2 analysis prompt. Leave empty to use default.' : 'Reemplaza el prompt de análisis (Fase 2). Vacío = usar predeterminado.')
                    : grammarMode === 'rolling'
                    ? (uiLang === 'en' ? 'Override the rolling sentence prompt. Leave empty to use default.' : 'Reemplaza el prompt de generación iterativa. Vacío = usar predeterminado.')
                    : (uiLang === 'en' ? 'Full custom prompt. Leave empty to use default.' : 'Prompt propio completo. Vacío = usar predeterminado.')
                }
                className="mt-2 w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500 resize-none font-mono"
              />
            )}
          </div>

          {/* Prose checker */}
          <ProseChecker
            model={model}
            timeout={timeout}
            uiLang={uiLang}
            initialText={lastProse}
            onGenerateFromText={generateFromProse}
          />

          {error && (
            <div className="card border border-red-500/40 bg-red-500/10 text-red-300 text-sm">
              ✗ {error}
            </div>
          )}

          <button
            onClick={generate}
            disabled={!topic.trim() || generating || noModel}
            className="btn-primary w-full py-3 disabled:opacity-50"
          >
            {generating ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin">⏳</span>
                <span>
                  {uiLang === 'de' ? 'Generiere...' : uiLang === 'en' ? 'Generating...' : uiLang === 'fr' ? 'Génération...' : 'Generando...'}
                  {' '}<span className="font-mono text-blue-200">{elapsed}s</span>
                </span>
              </span>
            ) : (
              uiLang === 'de' ? 'Übung generieren →' : uiLang === 'en' ? 'Generate exercise →' : uiLang === 'fr' ? "Générer l'exercice →" : 'Generar ejercicio →'
            )}
          </button>
      </div>

      {/* Panel: Solve */}
      <div className={panel === 'solve' ? '' : 'hidden'}>
        {exercise ? (
          <ExercisePlayer
            key={exercise.title + (exercise.segments?.length ?? 0)}
            exercise={exercise}
            uiLang={uiLang}
            savedId={currentSavedId}
            onSave={(id) => setCurrentSavedId(id)}
            onNew={() => setPanel('generate')}
          />
        ) : (
          <div className="text-center py-12">
            <p className="text-slate-400 text-sm">
              {uiLang === 'de' ? 'Noch keine Übung generiert.' : uiLang === 'en' ? 'No exercise generated yet.' : 'No hay ejercicio generado aún.'}
            </p>
            <button onClick={() => setPanel('generate')} className="btn-primary mt-4">
              {uiLang === 'de' ? 'Generieren' : uiLang === 'en' ? 'Generate one' : 'Generar uno'}
            </button>
          </div>
        )}
      </div>

      {/* Panel: Saved */}
      <div className={panel === 'saved' ? '' : 'hidden'}>
        {loadingSaved ? (
          <div className="text-center py-8 text-slate-400">⏳</div>
        ) : (
          <SavedList
            exercises={savedExercises}
            onLoad={loadExerciseFromSaved}
            onDelete={deleteExercise}
            uiLang={uiLang}
          />
        )}
      </div>
    </div>
  )
}
