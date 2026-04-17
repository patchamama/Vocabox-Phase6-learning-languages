/**
 * GrammarWorkshop — AI-powered German grammar exercise generator.
 *
 * Three panels:
 *   1. Generate: topic input, grammar focus options, AI idea suggestions, custom instructions
 *   2. Solve: fill-in-the-blank player with per-blank feedback and tips
 *   3. Saved: list of persisted exercises with score history
 */

import { useEffect, useState } from 'react'
import { grammarApi, type GrammarExerciseData, type GrammarSegment, type SavedGrammarExercise } from '../api/client'
import { useSettingsStore } from '../stores/settingsStore'
import { useUserProfileStore } from '../stores/userProfileStore'
import { getTip } from '../data/germanGrammarTips'
import GrammarTipModal from '../components/GrammarTipModal'
import type { TipLang } from '../data/germanGrammarTips'

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

// ── Exercise Player ─────────────────────────────────────────────────────────

interface BlankState {
  selected: string | null
  locked: boolean
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
  const blanks = exercise.segments.filter((s) => s.t === 'blank')
  const [blankStates, setBlankStates] = useState<Record<number, BlankState>>(() => {
    const init: Record<number, BlankState> = {}
    blanks.forEach((b) => { if (b.id !== undefined) init[b.id] = { selected: null, locked: false } })
    return init
  })
  const [showTip, setShowTip] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(savedId !== null)
  const [currentSavedId, setCurrentSavedId] = useState<number | null>(savedId)

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
    setBlankStates((prev) => ({
      ...prev,
      [blankId]: { selected: option, locked: true },
    }))
    // Auto-save score when all done
    if (answeredCount + 1 === blanks.length && currentSavedId) {
      const newCorrect = correctCount + (option === correct ? 1 : 0)
      grammarApi.updateScore(currentSavedId, newCorrect, blanks.length).catch(() => {})
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
    } catch {
      // ignore
    } finally {
      setSaving(false)
    }
  }

  const blankClass = (blankId: number, option: string, blank: GrammarSegment) => {
    const bs = blankStates[blankId]
    const correct = blank.options?.[blank.correct ?? 0] ?? ''
    if (!bs || !bs.locked) return 'bg-slate-700 hover:bg-slate-600 border-slate-600 cursor-pointer'
    if (option === correct) return 'bg-green-500/20 border-green-500 text-green-200'
    if (option === bs.selected) return 'bg-red-500/20 border-red-500 text-red-200'
    return 'bg-slate-700 border-slate-600 opacity-40'
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

  return (
    <div className="space-y-5">
      {tip && <GrammarTipModal tip={tip} lang={uiLang} onClose={() => setShowTip(null)} />}

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

      {/* Exercise text with inline blanks */}
      <div className="card text-white text-base leading-loose">
        {exercise.segments.map((seg, i) => {
          if (seg.t === 'text') {
            return <span key={i}>{seg.v}</span>
          }
          if (seg.t === 'blank' && seg.id !== undefined) {
            const blankId = seg.id
            const bs = blankStates[blankId]
            const correct = seg.options?.[seg.correct ?? 0] ?? ''
            const isLocked = bs?.locked ?? false
            const selected = bs?.selected ?? null

            return (
              <span key={i} className="inline-flex flex-col items-center mx-1 align-middle">
                {/* Options */}
                <span className="inline-flex gap-1 flex-wrap justify-center">
                  {seg.options?.map((opt) => (
                    <button
                      key={opt}
                      onClick={() => pick(blankId, opt, seg)}
                      disabled={isLocked}
                      className={`px-2 py-0.5 rounded-lg border text-sm font-medium transition-all duration-200 ${blankClass(blankId, opt, seg)}`}
                    >
                      {opt}
                    </button>
                  ))}
                </span>
                {/* Rule + tip (shown after answer) */}
                {isLocked && seg.rule && (
                  <span className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                    {selected === correct ? '✓' : `✗ ${correct}`} · {seg.rule}
                    {tipKey(seg.rule) && (
                      <button
                        onClick={() => setShowTip(tipKey(seg.rule))}
                        className="text-yellow-400 hover:text-yellow-300"
                      >
                        💡
                      </button>
                    )}
                  </span>
                )}
              </span>
            )
          }
          return null
        })}
      </div>

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

      {/* Grammar notes */}
      {exercise.grammar_notes.length > 0 && (
        <div className="card border border-slate-700 space-y-1">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
            {uiLang === 'de' ? 'Grammatiknotizen' : uiLang === 'en' ? 'Grammar notes' : uiLang === 'fr' ? 'Notes de grammaire' : 'Notas de gramática'}
          </p>
          {exercise.grammar_notes.map((note, i) => (
            <p key={i} className="text-xs text-slate-300">• {note}</p>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={saved || saving}
          className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition-colors ${
            saved
              ? 'border-green-500/40 text-green-400 bg-green-500/10'
              : 'border-slate-600 text-slate-300 hover:border-blue-500/40 hover:text-blue-300'
          }`}
        >
          {saving ? '...' : saved ? '✓ Guardado' : uiLang === 'de' ? 'Speichern' : uiLang === 'en' ? 'Save exercise' : uiLang === 'fr' ? 'Enregistrer' : 'Guardar'}
        </button>
        <button
          onClick={onNew}
          className="flex-1 btn-primary py-2.5 text-sm"
        >
          {uiLang === 'de' ? 'Neu generieren' : uiLang === 'en' ? 'New exercise' : uiLang === 'fr' ? 'Nouvel exercice' : 'Nuevo ejercicio'}
        </button>
      </div>
    </div>
  )
}

// ── Saved Exercises List ─────────────────────────────────────────────────────

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

// ── Main Workshop Page ───────────────────────────────────────────────────────

export default function GrammarWorkshop() {
  const { ollamaTranslationModel, ollamaTimeout, ollamaPromptGrammar } = useSettingsStore()
  const { uiLanguage } = useUserProfileStore()
  const uiLang = (uiLanguage as TipLang) ?? 'es'

  const [panel, setPanel] = useState<Panel>('generate')
  const [topic, setTopic] = useState('')
  const [customInstructions, setCustomInstructions] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [grammarFocus, setGrammarFocus] = useState<string[]>(['articles', 'prepositions', 'word_order'])
  const [generating, setGenerating] = useState(false)
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

  const generate = async () => {
    if (!topic.trim() || !model) return
    setGenerating(true)
    setError(null)
    setExercise(null)
    setCurrentSavedId(null)
    try {
      const prompt = customInstructions.trim() || ollamaPromptGrammar || undefined
      const res = await grammarApi.generate({
        topic: topic.trim(),
        interface_lang: uiLang,
        grammar_focus: grammarFocus,
        vocabulary: [],
        model,
        timeout,
        custom_prompt: prompt,
      })
      setExercise(res.data)
      setPanel('solve')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Error al generar el ejercicio'
      setError(msg)
    } finally {
      setGenerating(false)
    }
  }

  const loadDefaultPrompt = async () => {
    setLoadingPrompt(true)
    try {
      const res = await grammarApi.getDefaultPrompt()
      setCustomInstructions(res.data.prompt)
      setShowCustom(true)
    } catch {
      // ignore
    } finally {
      setLoadingPrompt(false)
    }
  }

  const suggestTopics = async () => {
    if (!model) return
    setSuggesting(true)
    try {
      const res = await grammarApi.suggestTopics({ interface_lang: uiLang, model, timeout })
      setSuggestions(res.data.topics ?? [])
    } catch {
      // ignore
    } finally {
      setSuggesting(false)
    }
  }

  const loadSaved = async () => {
    setLoadingSaved(true)
    try {
      const res = await grammarApi.listExercises()
      setSavedExercises(res.data)
    } catch {
      // ignore
    } finally {
      setLoadingSaved(false)
    }
  }

  const deleteExercise = async (id: number) => {
    try {
      await grammarApi.deleteExercise(id)
      setSavedExercises((prev) => prev.filter((e) => e.id !== id))
    } catch {
      // ignore
    }
  }

  const loadExerciseFromSaved = (ex: SavedGrammarExercise) => {
    const parsed: GrammarExerciseData = {
      title: ex.title,
      topic: ex.topic,
      segments: ex.segments,
      grammar_notes: ex.grammar_notes,
      vocabulary_used: ex.vocabulary_used,
    }
    setExercise(parsed)
    setCurrentSavedId(ex.id)
    setPanel('solve')
  }

  useEffect(() => {
    if (panel === 'saved') loadSaved()
  }, [panel])

  const tabs: { key: Panel; label: string }[] = [
    { key: 'generate', label: uiLang === 'de' ? 'Generieren' : uiLang === 'en' ? 'Generate' : uiLang === 'fr' ? 'Générer' : 'Generar' },
    { key: 'solve', label: uiLang === 'de' ? 'Lösen' : uiLang === 'en' ? 'Solve' : uiLang === 'fr' ? 'Résoudre' : 'Resolver' },
    { key: 'saved', label: uiLang === 'de' ? 'Gespeichert' : uiLang === 'en' ? 'Saved' : uiLang === 'fr' ? 'Sauvegardés' : 'Guardados' },
  ]

  return (
    <div className="p-4 pt-6 max-w-lg mx-auto min-h-screen">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl font-bold text-white">
          📝 {uiLang === 'de' ? 'Grammatik-Workshop' : uiLang === 'en' ? 'Grammar Workshop' : uiLang === 'fr' ? 'Atelier de grammaire' : 'Taller de Gramática'}
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          {uiLang === 'de' ? 'KI generiert deutsche Grammatikübungen für dich' : uiLang === 'en' ? 'AI generates German grammar exercises for you' : uiLang === 'fr' ? 'L\'IA génère des exercices de grammaire allemande' : 'La IA genera ejercicios de gramática alemana'}
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
      {panel === 'generate' && (
        <div className="space-y-5">
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
              {uiLang === 'de' ? 'KI-Ideen →' : uiLang === 'en' ? 'Get AI ideas →' : uiLang === 'fr' ? 'Idées de l\'IA →' : 'Pedir ideas a la IA →'}
            </button>
            {suggestions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => setTopic(s)}
                    className="text-xs px-3 py-1.5 rounded-full border border-slate-600 text-slate-300 hover:border-blue-500/50 hover:text-blue-300 transition-colors"
                  >
                    {s}
                  </button>
                ))}
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
            </div>
          </div>

          {/* Custom instructions (collapsible) */}
          <div>
            <div className="flex items-center justify-between">
              <button
                onClick={() => setShowCustom((v) => !v)}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1"
              >
                {showCustom ? '▼' : '▶'}
                {uiLang === 'de' ? 'Eigene Anweisungen' : uiLang === 'en' ? 'Custom instructions' : uiLang === 'fr' ? 'Instructions personnalisées' : 'Instrucciones personalizadas'}
              </button>
              <button
                onClick={loadDefaultPrompt}
                disabled={loadingPrompt}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-50"
                title={uiLang === 'en' ? 'Load default prompt from backend' : 'Cargar prompt por defecto del backend'}
              >
                {loadingPrompt ? '⏳' : '⬇'}{' '}
                {uiLang === 'de' ? 'Standard laden' : uiLang === 'en' ? 'Load default' : uiLang === 'fr' ? 'Charger défaut' : 'Cargar predeterminado'}
              </button>
            </div>
            {showCustom && (
              <textarea
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                rows={4}
                placeholder={uiLang === 'en' ? 'Override the default prompt. Leave empty to use the default.' : 'Reemplaza el prompt por defecto. Vacío = usar el predeterminado.'}
                className="mt-2 w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500 resize-none font-mono"
              />
            )}
          </div>

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
                {uiLang === 'de' ? 'Generiere...' : uiLang === 'en' ? 'Generating...' : uiLang === 'fr' ? 'Génération...' : 'Generando...'}
              </span>
            ) : (
              uiLang === 'de' ? 'Übung generieren →' : uiLang === 'en' ? 'Generate exercise →' : uiLang === 'fr' ? 'Générer l\'exercice →' : 'Generar ejercicio →'
            )}
          </button>
        </div>
      )}

      {/* Panel: Solve */}
      {panel === 'solve' && exercise && (
        <ExercisePlayer
          exercise={exercise}
          uiLang={uiLang}
          savedId={currentSavedId}
          onSave={(id) => setCurrentSavedId(id)}
          onNew={() => setPanel('generate')}
        />
      )}

      {panel === 'solve' && !exercise && (
        <div className="text-center py-12">
          <p className="text-slate-400 text-sm">
            {uiLang === 'de' ? 'Noch keine Übung generiert.' : uiLang === 'en' ? 'No exercise generated yet.' : 'No hay ejercicio generado aún.'}
          </p>
          <button onClick={() => setPanel('generate')} className="btn-primary mt-4">
            {uiLang === 'de' ? 'Generieren' : uiLang === 'en' ? 'Generate one' : 'Generar uno'}
          </button>
        </div>
      )}

      {/* Panel: Saved */}
      {panel === 'saved' && (
        loadingSaved ? (
          <div className="text-center py-8 text-slate-400">⏳</div>
        ) : (
          <SavedList
            exercises={savedExercises}
            onLoad={loadExerciseFromSaved}
            onDelete={deleteExercise}
            uiLang={uiLang}
          />
        )
      )}
    </div>
  )
}
