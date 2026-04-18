import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RoundType } from '../stores/settingsStore'
import { useSettingsStore } from '../stores/settingsStore'
import { aiProvidersApi, grammarApi, ollamaApi, temasApi } from '../api/client'
import type { AIProviderInfo } from '../api/client'
import AIProvidersModal from '../components/AIProvidersModal'
import Import from './Import'
import type { Tema } from '../types'
import { TtsVoiceSettings } from '../components/TtsVoiceSettings'
import { TtsFiltersEditor } from '../components/TtsFiltersEditor'

// ─── Shared Toggle ────────────────────────────────────────────────────────────

function Toggle({ value, onChange, label, description }: {
  value: boolean
  onChange: (v: boolean) => void
  label: string
  description?: string
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="w-full flex items-center justify-between p-4 rounded-xl border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700/40 hover:border-slate-400 dark:hover:border-slate-500 transition-all text-left"
    >
      <div>
        <div className="font-medium text-slate-900 dark:text-white text-sm">{label}</div>
        {description && <div className="text-xs text-slate-400 dark:text-slate-500 dark:text-slate-400 mt-0.5">{description}</div>}
      </div>
      <div className={`w-11 h-6 rounded-full transition-colors shrink-0 ml-3 relative ${value ? 'bg-blue-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
        <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${value ? 'left-6' : 'left-1'}`} />
      </div>
    </button>
  )
}

// ─── Round Selector ───────────────────────────────────────────────────────────

const ROUND_EXERCISE_KEYS: RoundType[] = [
  'pair_match', 'first_letter', 'anagram', 'write', 'multiple_choice', 'random',
]

function RoundSelector({ label, value, onChange }: {
  label: string
  value: RoundType
  onChange: (v: RoundType) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {ROUND_EXERCISE_KEYS.map((key) => (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
              value === key
                ? 'border-blue-500 bg-blue-500/15 text-blue-300'
                : 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/40 text-slate-500 dark:text-slate-400 hover:border-slate-400 dark:hover:border-slate-500'
            }`}
          >
            {t(`settings.exercises.${key}`)}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Leitner Days Editor ──────────────────────────────────────────────────────

const BOX_COLORS = [
  'text-red-400 border-red-500/40 bg-red-500/10',
  'text-orange-400 border-orange-500/40 bg-orange-500/10',
  'text-yellow-400 border-yellow-500/40 bg-yellow-500/10',
  'text-lime-400 border-lime-500/40 bg-lime-500/10',
  'text-cyan-400 border-cyan-500/40 bg-cyan-500/10',
  'text-blue-400 border-blue-500/40 bg-blue-500/10',
  'text-purple-400 border-purple-500/40 bg-purple-500/10',
]

function LeitnerEditor() {
  const { t } = useTranslation()
  const { leitnerDays, setLeitnerDay } = useSettingsStore()

  const change = (box: number, delta: number) => {
    const next = Math.min(360, Math.max(0, leitnerDays[box] + delta))
    setLeitnerDay(box, next)
  }

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="font-semibold text-slate-800 dark:text-slate-200">{t('settings.leitnerBoxDays')}</h2>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{t('settings.leitnerBoxDaysDesc')}</p>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {leitnerDays.map((days, box) => (
          <div key={box} className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border ${BOX_COLORS[box]}`}>
            <span className="text-[10px] font-semibold opacity-70">{box}</span>
            <span className="text-lg font-bold leading-none">{days}</span>
            <span className="text-[9px] opacity-60">{t('settings.days', { count: days })}</span>
            <div className="flex flex-col gap-0.5 w-full mt-0.5">
              <button
                onClick={() => change(box, 1)}
                disabled={days >= 360}
                className="w-full h-6 rounded-md bg-white/5 hover:bg-white/15 transition-colors text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed"
              >
                +
              </button>
              <button
                onClick={() => change(box, -1)}
                disabled={days <= 0}
                className="w-full h-6 rounded-md bg-white/5 hover:bg-white/15 transition-colors text-xs font-bold disabled:opacity-30 disabled:cursor-not-allowed"
              >
                −
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Themes CRUD ──────────────────────────────────────────────────────────────

const THEME_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280', '#14b8a6',
]

function ThemesManager() {
  const { t } = useTranslation()
  const [temas, setTemas] = useState<Tema[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)

  const [formName, setFormName] = useState('')
  const [formColor, setFormColor] = useState(THEME_COLORS[0])

  const loadTemas = async () => {
    setLoading(true)
    try {
      const { data } = await temasApi.list()
      setTemas(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadTemas() }, [])

  const openAdd = () => {
    setFormName('')
    setFormColor(THEME_COLORS[0])
    setEditingId(null)
    setAdding(true)
  }

  const openEdit = (tema: Tema) => {
    setFormName(tema.nombre)
    setFormColor(tema.color)
    setEditingId(tema.id)
    setAdding(true)
  }

  const handleSave = async () => {
    if (!formName.trim()) return
    try {
      if (editingId !== null) {
        await temasApi.update(editingId, formName.trim(), formColor)
      } else {
        await temasApi.create(formName.trim(), formColor)
      }
      await loadTemas()
      setAdding(false)
    } catch { /* ignore */ }
  }

  const handleDelete = async (id: number) => {
    try {
      await temasApi.delete(id)
      setTemas((prev) => prev.filter((t) => t.id !== id))
    } catch { /* ignore */ }
  }

  return (
    <div className="card space-y-4">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="font-semibold text-slate-800 dark:text-slate-200">{t('settings.themes')}</h2>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{t('settings.themesDesc')}</p>
        </div>
        <button
          onClick={openAdd}
          className="px-3 py-1.5 rounded-lg bg-blue-500/15 border border-blue-500/40 text-blue-300 text-xs font-medium hover:bg-blue-500/25 transition-colors"
        >
          + {t('settings.addTheme')}
        </button>
      </div>

      {/* Add/Edit form */}
      {adding && (
        <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/40 space-y-3">
          <input
            type="text"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder={t('settings.themeName')}
            className="input w-full text-sm"
            autoFocus
          />
          <div>
            <p className="text-xs text-slate-400 mb-2">{t('settings.themeColor')}</p>
            <div className="flex gap-2 flex-wrap">
              {THEME_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => setFormColor(color)}
                  style={{ backgroundColor: color }}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${
                    formColor === color ? 'border-white scale-110' : 'border-transparent'
                  }`}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} className="btn-primary flex-1 py-2 text-sm">
              {t('settings.save')}
            </button>
            <button
              onClick={() => setAdding(false)}
              className="flex-1 py-2 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 text-sm hover:border-slate-400 dark:hover:border-slate-500 transition-colors"
            >
              {t('settings.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">…</p>
      ) : temas.length === 0 ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">{t('settings.noThemes')}</p>
      ) : (
        <div className="space-y-2">
          {temas.map((tema) => (
            <div
              key={tema.id}
              className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/40"
            >
              <span
                className="w-4 h-4 rounded-full shrink-0"
                style={{ backgroundColor: tema.color }}
              />
              <span className="flex-1 text-sm text-slate-800 dark:text-slate-200">{tema.nombre}</span>
              <button
                onClick={() => openEdit(tema)}
                className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors px-2"
              >
                {t('settings.edit')}
              </button>
              <button
                onClick={() => handleDelete(tema.id)}
                className="text-xs text-red-400 hover:text-red-300 transition-colors px-2"
              >
                {t('settings.delete')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Pagination Editor ────────────────────────────────────────────────────────

const PAGE_SIZE_PRESETS = [5, 10, 20, 25, 30, 50, 75, 100]

function PaginationEditor() {
  const { t } = useTranslation()
  const { pageSizeOptions, setPageSizeOption } = useSettingsStore()

  const change = (slot: 0 | 1 | 2, delta: number) => {
    const current = pageSizeOptions[slot]
    const idx = PAGE_SIZE_PRESETS.indexOf(current)
    const nextIdx = Math.min(PAGE_SIZE_PRESETS.length - 1, Math.max(0, idx + delta))
    setPageSizeOption(slot, PAGE_SIZE_PRESETS[nextIdx])
  }

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="font-semibold text-slate-800 dark:text-slate-200">{t('settings.pagination')}</h2>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{t('settings.paginationDesc')}</p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {([0, 1, 2] as const).map((slot) => (
          <div key={slot} className="flex flex-col items-center gap-2 p-3 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/40">
            <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">
              {t('settings.paginationSlot', { n: slot + 1 })}
            </span>
            <span className="text-2xl font-bold text-slate-800 dark:text-white">{pageSizeOptions[slot]}</span>
            <div className="flex gap-1 w-full">
              <button
                onClick={() => change(slot, -1)}
                disabled={PAGE_SIZE_PRESETS.indexOf(pageSizeOptions[slot]) === 0}
                className="flex-1 h-7 rounded-lg bg-slate-200 dark:bg-white/5 hover:bg-slate-300 dark:hover:bg-white/15 transition-colors text-sm font-bold disabled:opacity-30 disabled:cursor-not-allowed"
              >
                −
              </button>
              <button
                onClick={() => change(slot, 1)}
                disabled={PAGE_SIZE_PRESETS.indexOf(pageSizeOptions[slot]) === PAGE_SIZE_PRESETS.length - 1}
                className="flex-1 h-7 rounded-lg bg-slate-200 dark:bg-white/5 hover:bg-slate-300 dark:hover:bg-white/15 transition-colors text-sm font-bold disabled:opacity-30 disabled:cursor-not-allowed"
              >
                +
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Ollama Prompts Editor ────────────────────────────────────────────────────

function PromptField({
  label, vars, value, defaultValue, onChange,
}: {
  label: string
  vars: string
  value: string
  defaultValue: string
  onChange: (v: string) => void
}) {
  const { t } = useTranslation()
  const isCustom = value.trim() !== ''

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-600 dark:text-slate-400">{label}</p>
        <div className="flex items-center gap-2">
          {isCustom && (
            <button
              onClick={() => onChange('')}
              className="text-xs text-red-400 hover:text-red-300 transition-colors"
            >
              {t('settings.ollamaPromptReset')}
            </button>
          )}
          {!isCustom && defaultValue && (
            <button
              onClick={() => onChange(defaultValue)}
              className="text-xs text-purple-400 hover:text-purple-300 transition-colors"
            >
              {t('settings.ollamaPromptLoad')}
            </button>
          )}
        </div>
      </div>
      <p className="text-xs text-slate-400 dark:text-slate-500 font-mono break-all">{vars}</p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={defaultValue || t('settings.ollamaPromptPlaceholder')}
        rows={8}
        className={`w-full px-3 py-2 rounded-xl border bg-slate-50 dark:bg-slate-700/40 text-slate-800 dark:text-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-purple-500 resize-y transition-colors ${
          isCustom
            ? 'border-purple-500/50 dark:border-purple-500/40'
            : 'border-slate-300 dark:border-slate-600'
        }`}
      />
      {isCustom && (
        <p className="text-xs text-purple-400">
          {t('settings.ollamaPromptCustomActive')}
        </p>
      )}
    </div>
  )
}

// ── Grammar model parameter presets ──────────────────────────────────────────

const MODEL_PRESETS = [
  {
    id: 'small',
    label: { es: 'Modelo pequeño', en: 'Small model', de: 'Kleines Modell', fr: 'Petit modèle' },
    desc: { es: '≤7B params — menos creatividad, más obediente', en: '≤7B params — less creative, more obedient', de: '≤7B — weniger kreativ, gehorsamer', fr: '≤7B — moins créatif, plus obéissant' },
    temperature: 0.2,
    numPredict: 2048,
    topP: 0.85,
  },
  {
    id: 'medium',
    label: { es: 'Modelo mediano', en: 'Medium model', de: 'Mittleres Modell', fr: 'Modèle moyen' },
    desc: { es: '8–14B params — equilibrio calidad/velocidad', en: '8–14B params — quality/speed balance', de: '8–14B — Qualität/Geschwindigkeit', fr: '8–14B — équilibre qualité/vitesse' },
    temperature: 0.4,
    numPredict: 4096,
    topP: 0.9,
  },
  {
    id: 'large',
    label: { es: 'Modelo grande', en: 'Large model', de: 'Großes Modell', fr: 'Grand modèle' },
    desc: { es: '≥30B params — más creatividad, respuestas largas', en: '≥30B params — more creative, longer answers', de: '≥30B — kreativer, längere Antworten', fr: '≥30B — plus créatif, réponses longues' },
    temperature: 0.6,
    numPredict: 6144,
    topP: 0.95,
  },
] as const

function GrammarModelParams({
  temperature, numPredict, topP,
  onTemperature, onNumPredict, onTopP,
}: {
  temperature: number | null
  numPredict: number | null
  topP: number | null
  onTemperature: (v: number | null) => void
  onNumPredict: (v: number | null) => void
  onTopP: (v: number | null) => void
}) {
  const [open, setOpen] = useState(false)
  const isCustom = temperature !== null || numPredict !== null || topP !== null

  const applyPreset = (preset: typeof MODEL_PRESETS[number]) => {
    onTemperature(preset.temperature)
    onNumPredict(preset.numPredict)
    onTopP(preset.topP)
  }

  const reset = () => {
    onTemperature(null)
    onNumPredict(null)
    onTopP(null)
  }

  const lang = 'es' // fallback — good enough for this internal component

  return (
    <div>
      <div className="flex items-center justify-between">
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1"
        >
          {open ? '▼' : '▶'}
          <span>Parámetros del modelo (gramática)</span>
          {isCustom && <span className="ml-1 text-blue-400">●</span>}
        </button>
        {isCustom && (
          <button onClick={reset} className="text-xs text-slate-500 hover:text-red-400 transition-colors">
            Reset
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-4">
          {/* Presets */}
          <div className="space-y-1.5">
            <p className="text-xs text-slate-400 font-medium">Presets por tamaño</p>
            <div className="grid grid-cols-3 gap-2">
              {MODEL_PRESETS.map((preset) => {
                const active =
                  temperature === preset.temperature &&
                  numPredict === preset.numPredict &&
                  topP === preset.topP
                return (
                  <button
                    key={preset.id}
                    onClick={() => applyPreset(preset)}
                    className={`text-xs px-2 py-2 rounded-xl border transition-colors text-left ${
                      active
                        ? 'border-blue-500 bg-blue-500/20 text-blue-200'
                        : 'border-slate-600 text-slate-400 hover:border-slate-500'
                    }`}
                  >
                    <div className="font-medium">{preset.label[lang]}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5 leading-tight">
                      {preset.desc[lang]}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Manual sliders */}
          <div className="space-y-3 pt-2 border-t border-slate-700">
            {/* Temperature */}
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <p className="text-xs text-slate-400">Temperatura</p>
                <span className="text-xs font-mono text-white">{temperature ?? '0.4 (def)'}</span>
              </div>
              <p className="text-[10px] text-slate-500">Creatividad. Bajo = obediente, alto = creativo pero impreciso.</p>
              <input
                type="range"
                min={0} max={1} step={0.05}
                value={temperature ?? 0.4}
                onChange={(e) => onTemperature(parseFloat(e.target.value))}
                className="w-full accent-blue-500"
              />
              <div className="flex justify-between text-[10px] text-slate-600">
                <span>0 (obediente)</span><span>1 (creativo)</span>
              </div>
            </div>

            {/* num_predict */}
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <p className="text-xs text-slate-400">Tokens máx (num_predict)</p>
                <span className="text-xs font-mono text-white">{numPredict ?? '4096 (def)'}</span>
              </div>
              <p className="text-[10px] text-slate-500">Modelos chicos necesitan menos, modelos grandes aguantan más.</p>
              <input
                type="range"
                min={1024} max={8192} step={256}
                value={numPredict ?? 4096}
                onChange={(e) => onNumPredict(parseInt(e.target.value))}
                className="w-full accent-blue-500"
              />
              <div className="flex justify-between text-[10px] text-slate-600">
                <span>1024</span><span>8192</span>
              </div>
            </div>

            {/* top_p */}
            <div className="space-y-1">
              <div className="flex justify-between items-center">
                <p className="text-xs text-slate-400">Top-P (nucleus sampling)</p>
                <span className="text-xs font-mono text-white">{topP ?? '0.9 (def)'}</span>
              </div>
              <p className="text-[10px] text-slate-500">Vocabulario considerado. Bajo = conservador, alto = diverso.</p>
              <input
                type="range"
                min={0.5} max={1} step={0.05}
                value={topP ?? 0.9}
                onChange={(e) => onTopP(parseFloat(e.target.value))}
                className="w-full accent-blue-500"
              />
              <div className="flex justify-between text-[10px] text-slate-600">
                <span>0.5</span><span>1.0</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function OllamaPromptsEditor({
  promptTranslate, promptEnhance, promptGrammar,
  onChangeTranslate, onChangeEnhance, onChangeGrammar,
  defaultTranslate, defaultEnhance, defaultGrammar,
}: {
  promptTranslate: string
  promptEnhance: string
  promptGrammar: string
  onChangeTranslate: (v: string) => void
  onChangeEnhance: (v: string) => void
  onChangeGrammar: (v: string) => void
  defaultTranslate: string
  defaultEnhance: string
  defaultGrammar: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <div className="border-t border-slate-200 dark:border-slate-600 pt-3 space-y-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
      >
        <span>{t('settings.ollamaPrompts')}</span>
        <span className="text-slate-400 text-xs">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="space-y-4 pt-2">
          <p className="text-xs text-slate-400 dark:text-slate-500">{t('settings.ollamaPromptsDesc')}</p>
          <PromptField
            label={t('settings.ollamaPromptTranslate')}
            vars={t('settings.ollamaPromptTranslateVars')}
            value={promptTranslate}
            defaultValue={defaultTranslate}
            onChange={onChangeTranslate}
          />
          <PromptField
            label={t('settings.ollamaPromptEnhance')}
            vars={t('settings.ollamaPromptEnhanceVars')}
            value={promptEnhance}
            defaultValue={defaultEnhance}
            onChange={onChangeEnhance}
          />
          <PromptField
            label="Prompt: ejercicios de gramática"
            vars="{topic}, {interface_lang}, {grammar_focus}, {vocabulary_line}"
            value={promptGrammar}
            defaultValue={defaultGrammar}
            onChange={onChangeGrammar}
          />
        </div>
      )}
    </div>
  )
}

// ─── Main Settings Page ───────────────────────────────────────────────────────

const WORDS_OPTIONS = [5, 10, 15, 20, 30]
const DELAY_OPTIONS = [1, 2, 3, 5]

export default function Settings() {
  const { t } = useTranslation()
  const {
    reviewMode, wordsPerSession, transitionDelay, transitionType,
    safeRound1, safeRound2, safeRound3, autoPlayAudio, autoPlayAudioReversed, wordsOnly, reviewDirection,
    useTtsInAudioReview, leoAutoFetchExtras, leoExtraLangs,
    audioReviewExtraLangs, ollamaTranslationModel,
    ollamaTimeout, ollamaPromptTranslate, ollamaPromptEnhance,
    videoClipPauseSec, videoClipContext, videoClipAutoPlay, videoClipPlaybackRate, maxRefsPerWord,
    subtitleIndexPalabra, subtitleIndexAudioText, subtitleIndexSignificado,
    germanArticleChoice, grammarReviewEnabled, grammarOptions, ollamaPromptGrammar,
    grammarTemperature, grammarNumPredict, grammarTopP, grammarDoubleCorrect, grammarMaxBlanks,
    setReviewMode, setWordsPerSession, setTransitionDelay, setTransitionType,
    setSafeRound, setAutoPlayAudio, setAutoPlayAudioReversed, setWordsOnly, setReviewDirection,
    setUseTtsInAudioReview, setLeoAutoFetchExtras, setLeoExtraLangs,
    setAudioReviewExtraLangs, setOllamaTranslationModel,
    setOllamaTimeout, setOllamaPromptTranslate, setOllamaPromptEnhance, setOllamaPromptGrammar,
    setGrammarTemperature, setGrammarNumPredict, setGrammarTopP, setGrammarDoubleCorrect, setGrammarMaxBlanks,
    setVideoClipPauseSec, setVideoClipContext, setVideoClipAutoPlay, setVideoClipPlaybackRate, setMaxRefsPerWord,
    setSubtitleIndexPalabra, setSubtitleIndexAudioText, setSubtitleIndexSignificado,
    setGermanArticleChoice, setGrammarReviewEnabled, setGrammarOption,
  } = useSettingsStore()

  // Ollama status + default prompts
  const [ollamaStatus, setOllamaStatus] = useState<{ running: boolean; models: string[] } | null>(null)
  const [defaultPrompts, setDefaultPrompts] = useState<{ translate: string; enhance: string } | null>(null)
  const [defaultGrammarPrompt, setDefaultGrammarPrompt] = useState('')
  const [activeProvider, setActiveProvider] = useState<AIProviderInfo | null | undefined>(undefined)
  const [showAIProviders, setShowAIProviders] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const ollamaChecked = useRef(false)
  useEffect(() => {
    if (ollamaChecked.current) return
    ollamaChecked.current = true
    ollamaApi.getDefaultPrompts()
      .then((r) => setDefaultPrompts(r.data))
      .catch(() => {})
    grammarApi.getDefaultPrompt()
      .then((r) => setDefaultGrammarPrompt(r.data.prompt))
      .catch(() => {})
    aiProvidersApi.active()
      .then((r) => setActiveProvider(r.data))
      .catch(() => setActiveProvider(null))
    ollamaApi.getStatus()
      .then((r) => {
        setOllamaStatus(r.data)
        if (!ollamaTranslationModel && r.data.running && r.data.models.length > 0) {
          const match = r.data.models.find((m: string) => m.toLowerCase().startsWith('translate'))
          if (match) setOllamaTranslationModel(match)
        }
      })
      .catch(() => setOllamaStatus({ running: false, models: [] }))
  }, [])

  // Languages that LEO supports for auto-fetch (non-DE side)
  const LEO_EXTRA_LANGS = [
    { code: 'es', label: t('languages.es') },
    { code: 'en', label: t('languages.en') },
    { code: 'fr', label: t('languages.fr') },
    { code: 'it', label: t('languages.it') },
    { code: 'pt', label: t('languages.pt') },
  ]

  function toggleExtraLang(code: string) {
    if (leoExtraLangs.includes(code)) {
      setLeoExtraLangs(leoExtraLangs.filter((l) => l !== code))
    } else {
      setLeoExtraLangs([...leoExtraLangs, code])
    }
  }

  return (
    <>
    <div className="p-4 pt-8 space-y-6">
      <h1 className="text-2xl font-bold">{t('settings.title')}</h1>

      {/* Review mode */}
      <div className="card space-y-3">
        <h2 className="font-semibold text-slate-800 dark:text-slate-200">{t('settings.reviewMode')}</h2>
        <button
          onClick={() => setReviewMode('simple')}
          className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
            reviewMode === 'simple'
              ? 'border-blue-500 bg-blue-500/10'
              : 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/40 hover:border-slate-400 dark:hover:border-slate-500'
          }`}
        >
          <div className="font-medium text-slate-900 dark:text-white">{t('settings.simpleMode')}</div>
          <div className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{t('settings.simpleModeDesc')}</div>
        </button>
        <button
          onClick={() => setReviewMode('safe')}
          className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
            reviewMode === 'safe'
              ? 'border-blue-500 bg-blue-500/10'
              : 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/40 hover:border-slate-400 dark:hover:border-slate-500'
          }`}
        >
          <div className="font-medium text-slate-900 dark:text-white">{t('settings.safeMode')}</div>
          <div className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{t('settings.safeModeDesc')}</div>
        </button>
      </div>

      {/* Safe mode rounds */}
      {reviewMode === 'safe' && (
        <div className="card space-y-4">
          <h2 className="font-semibold text-slate-800 dark:text-slate-200">{t('settings.exercisePerRound')}</h2>
          <p className="text-xs text-slate-400 dark:text-slate-500">{t('settings.exercisePerRoundDesc')}</p>
          <RoundSelector label={t('settings.round', { n: 1 })} value={safeRound1} onChange={(v) => setSafeRound(1, v)} />
          <RoundSelector label={t('settings.round', { n: 2 })} value={safeRound2} onChange={(v) => setSafeRound(2, v)} />
          <RoundSelector label={t('settings.round', { n: 3 })} value={safeRound3} onChange={(v) => setSafeRound(3, v)} />
        </div>
      )}

      {/* Review direction */}
      <div className="card space-y-3">
        <h2 className="font-semibold text-slate-800 dark:text-slate-200">{t('settings.reviewDirection')}</h2>
        <p className="text-xs text-slate-400 dark:text-slate-500">{t('settings.reviewDirectionDesc')}</p>
        {(['forward', 'reverse', 'both'] as const).map((dir) => (
          <button
            key={dir}
            onClick={() => setReviewDirection(dir)}
            className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
              reviewDirection === dir
                ? 'border-blue-500 bg-blue-500/10'
                : 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/40 hover:border-slate-400 dark:hover:border-slate-500'
            }`}
          >
            <div className="font-medium text-slate-900 dark:text-white">{t(`settings.direction_${dir}`)}</div>
            <div className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{t(`settings.direction_${dir}Desc`)}</div>
          </button>
        ))}
      </div>

      {/* Words per session */}
      <div className="card space-y-3">
        <h2 className="font-semibold text-slate-800 dark:text-slate-200">{t('settings.wordsPerSession')}</h2>
        <div className="flex gap-2 flex-wrap">
          {WORDS_OPTIONS.map((n) => (
            <button
              key={n}
              onClick={() => setWordsPerSession(n)}
              className={`px-5 py-2.5 rounded-xl border-2 font-medium transition-all ${
                wordsPerSession === n
                  ? 'border-blue-500 bg-blue-500/10 text-white'
                  : 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/40 text-slate-500 dark:text-slate-400 hover:border-slate-400 dark:hover:border-slate-500'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {reviewMode === 'safe'
            ? t('settings.wordsPerSessionSafe', { count: wordsPerSession * 3 })
            : t('settings.wordsPerSessionSimple', { count: wordsPerSession })}
        </p>
      </div>

      {/* Audio */}
      <div className="card space-y-3">
        <h2 className="font-semibold text-slate-800 dark:text-slate-200">{t('settings.audio')}</h2>
        <Toggle
          value={autoPlayAudio}
          onChange={setAutoPlayAudio}
          label={t('settings.autoPlayAudio')}
          description={t('settings.autoPlayAudioDesc')}
        />
        <Toggle
          value={autoPlayAudioReversed}
          onChange={setAutoPlayAudioReversed}
          label={t('settings.autoPlayAudioReversed')}
          description={t('settings.autoPlayAudioReversedDesc')}
        />
        <Toggle
          value={useTtsInAudioReview}
          onChange={setUseTtsInAudioReview}
          label={t('settings.useTtsInAudioReview')}
          description={t('settings.useTtsInAudioReviewDesc')}
        />
        {useTtsInAudioReview && (
          <div className="pt-2 border-t border-slate-200 dark:border-slate-600">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
              {t('settings.ttsVoices')}
            </p>
            <TtsVoiceSettings />
          </div>
        )}
      </div>

      {/* TTS Filters */}
      {useTtsInAudioReview && (
        <div className="card space-y-3">
          <h2 className="font-semibold text-slate-800 dark:text-slate-200">{t('settings.ttsFilters')}</h2>
          <p className="text-xs text-slate-400 dark:text-slate-500">{t('settings.ttsFiltersDesc')}</p>
          <TtsFiltersEditor />
        </div>
      )}

      {/* LEO Dictionary */}
      <div className="card space-y-3">
        <h2 className="font-semibold text-slate-800 dark:text-slate-200">{t('settings.leoTitle')}</h2>
        <Toggle
          value={leoAutoFetchExtras}
          onChange={setLeoAutoFetchExtras}
          label={t('settings.leoAutoFetch')}
          description={t('settings.leoAutoFetchDesc')}
        />
        {leoAutoFetchExtras && (
          <div className="pt-2 border-t border-slate-200 dark:border-slate-600">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              {t('settings.leoExtraLangs')}
            </p>
            <div className="flex flex-wrap gap-2">
              {LEO_EXTRA_LANGS.map(({ code, label }) => (
                <button
                  key={code}
                  onClick={() => toggleExtraLang(code)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border-2 transition-all ${
                    leoExtraLangs.includes(code)
                      ? 'border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                      : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-slate-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* AI Providers */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-800 dark:text-slate-200">🤖 Proveedores de IA</h2>
          <button
            onClick={() => setShowAIProviders(true)}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            Gestionar →
          </button>
        </div>
        <div className="text-sm">
          {activeProvider === undefined && (
            <span className="text-slate-400 text-xs">Cargando…</span>
          )}
          {activeProvider === null && (
            <span className="text-slate-400 text-xs">
              Sin proveedor externo activo — usando Ollama (configuración abajo)
            </span>
          )}
          {activeProvider && (
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-green-400 shrink-0" />
              <span className="text-slate-300 text-xs font-medium">{activeProvider.name}</span>
              <span className="text-slate-500 text-xs">· {activeProvider.model_name}</span>
              <button
                onClick={() => setShowAIProviders(true)}
                className="ml-auto text-xs text-slate-500 hover:text-slate-300"
              >
                Cambiar
              </button>
            </div>
          )}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-500">
          El proveedor activo se usa para gramática, mejorar palabras y sugerencias de temas.
          Si ninguno está activo, se usa Ollama.
        </p>
      </div>

      {/* Ollama */}
      <div className="card space-y-4">
        <h2 className="font-semibold text-slate-800 dark:text-slate-200">{t('settings.ollamaTitle')}</h2>
        {ollamaStatus === null && (
          <p className="text-xs text-slate-400">{t('common.loading')}</p>
        )}
        {ollamaStatus && !ollamaStatus.running && (
          <p className="text-xs text-amber-400">{t('settings.ollamaNotDetected')}</p>
        )}
        {ollamaStatus?.running && (
          <>
            {/* Model select — always visible when running */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {t('settings.ollamaModel')}
              </p>
              <select
                value={ollamaTranslationModel}
                onChange={(e) => setOllamaTranslationModel(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/40 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="">{t('settings.ollamaNoModel')}</option>
                {ollamaStatus.models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            {/* Timeout */}
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {t('settings.ollamaTimeout')}
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500">{t('settings.ollamaTimeoutDesc')}</p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setOllamaTimeout(ollamaTimeout - 5)}
                  disabled={ollamaTimeout <= 10}
                  className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-white/5 hover:bg-slate-300 dark:hover:bg-white/15 transition-colors text-sm font-bold disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  −
                </button>
                <span className="text-lg font-bold text-slate-800 dark:text-white w-16 text-center">
                  {ollamaTimeout}{t('settings.ollamaTimeoutSuffix')}
                </span>
                <button
                  onClick={() => setOllamaTimeout(ollamaTimeout + 5)}
                  disabled={ollamaTimeout >= 900}
                  className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-white/5 hover:bg-slate-300 dark:hover:bg-white/15 transition-colors text-sm font-bold disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  +
                </button>
              </div>
            </div>

            {/* Audio review extra languages */}
            <Toggle
              value={audioReviewExtraLangs}
              onChange={setAudioReviewExtraLangs}
              label={t('settings.audioReviewExtraLangs')}
              description={t('settings.audioReviewExtraLangsDesc')}
            />

            {/* Grammar: double correction pass */}
            <div className="flex items-center justify-between py-1">
              <div>
                <p className="text-sm text-slate-200">Segunda pasada de corrección</p>
                <p className="text-xs text-slate-500">Aplica una segunda corrección al texto generado antes de crear el ejercicio</p>
              </div>
              <button
                onClick={() => setGrammarDoubleCorrect(!grammarDoubleCorrect)}
                className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${grammarDoubleCorrect ? 'bg-blue-500' : 'bg-slate-600'}`}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${grammarDoubleCorrect ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>

            {/* Grammar: max blanks */}
            <div className="flex items-center justify-between py-1">
              <div>
                <p className="text-sm text-slate-200">Máximo de blancos por ejercicio</p>
                <p className="text-xs text-slate-500">Número máximo de blancos que genera el ejercicio (3–20)</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={3}
                  max={20}
                  value={grammarMaxBlanks}
                  onChange={(e) => setGrammarMaxBlanks(Number(e.target.value))}
                  className="w-24 accent-blue-500"
                />
                <span className="text-sm text-slate-300 w-6 text-right">{grammarMaxBlanks}</span>
              </div>
            </div>

            {/* Grammar model parameters */}
            <GrammarModelParams
              temperature={grammarTemperature}
              numPredict={grammarNumPredict}
              topP={grammarTopP}
              onTemperature={setGrammarTemperature}
              onNumPredict={setGrammarNumPredict}
              onTopP={setGrammarTopP}
            />

            {/* Custom prompts — collapsible */}
            <OllamaPromptsEditor
              promptTranslate={ollamaPromptTranslate}
              promptEnhance={ollamaPromptEnhance}
              promptGrammar={ollamaPromptGrammar}
              onChangeTranslate={setOllamaPromptTranslate}
              onChangeEnhance={setOllamaPromptEnhance}
              onChangeGrammar={setOllamaPromptGrammar}
              defaultTranslate={defaultPrompts?.translate ?? ''}
              defaultEnhance={defaultPrompts?.enhance ?? ''}
              defaultGrammar={defaultGrammarPrompt}
            />
          </>
        )}
      </div>

      {/* Content */}
      <div className="card space-y-3">
        <h2 className="font-semibold text-slate-800 dark:text-slate-200">{t('settings.content')}</h2>
        <Toggle
          value={wordsOnly}
          onChange={setWordsOnly}
          label={t('settings.wordsOnly')}
          description={t('settings.wordsOnlyDesc')}
        />
      </div>

      {/* German Grammar */}
      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-slate-800 dark:text-slate-200">🇩🇪 {t('settings.germanGrammar')}</h2>
        </div>
        <Toggle
          value={germanArticleChoice}
          onChange={setGermanArticleChoice}
          label={t('settings.germanGrammarArticleChoice')}
          description={t('settings.germanGrammarArticleChoiceDesc')}
        />
        <Toggle
          value={grammarReviewEnabled}
          onChange={setGrammarReviewEnabled}
          label={t('settings.germanGrammarSession')}
          description={t('settings.germanGrammarSessionDesc')}
        />
        {grammarReviewEnabled && (
          <div className="space-y-2 pt-1 border-t border-slate-200 dark:border-slate-600">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{t('settings.germanGrammarTypes')}</p>
            {([
              { key: 'articleDeclension', label: t('settings.exercises.articleDeclension') },
              { key: 'adjDeclension', label: t('settings.exercises.adjDeclension') },
              { key: 'verbConjugation', label: t('settings.exercises.verbConjugation') },
              { key: 'prepositions', label: t('settings.exercises.prepositions') },
              { key: 'verbPrepositions', label: t('settings.exercises.verbPrepositions') },
            ] as const).map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={grammarOptions[key]}
                  onChange={(e) => setGrammarOption(key, e.target.checked)}
                  className="w-4 h-4 rounded accent-blue-500 cursor-pointer"
                />
                <span className="text-sm text-slate-600 dark:text-slate-300 group-hover:text-slate-800 dark:group-hover:text-slate-100 transition-colors">
                  {label}
                </span>
              </label>
            ))}
          </div>
        )}
        <div className="pt-1 border-t border-slate-200 dark:border-slate-600 space-y-2">
          <a href="/grammar" className="text-xs text-blue-400 hover:text-blue-300 transition-colors block">
            ✏️ {t('settings.germanGrammarOpenWorkshop')}
          </a>
          <p className="text-[10px] text-slate-500 italic">
            🚧 {t('settings.germanGrammarModerationPending', 'Pendiente: configuración de moderación para ejercicios globales (admin-only)')}
          </p>
        </div>
      </div>

      {/* Transition */}
      <div className="card space-y-3">
        <h2 className="font-semibold text-slate-800 dark:text-slate-200">{t('settings.transition')}</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setTransitionType('auto')}
            className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${
              transitionType === 'auto'
                ? 'border-blue-500 bg-blue-500/10 text-white'
                : 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/40 text-slate-500 dark:text-slate-400 hover:border-slate-400 dark:hover:border-slate-500'
            }`}
          >
            {t('settings.auto')}
          </button>
          <button
            onClick={() => setTransitionType('button')}
            className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${
              transitionType === 'button'
                ? 'border-blue-500 bg-blue-500/10 text-white'
                : 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/40 text-slate-500 dark:text-slate-400 hover:border-slate-400 dark:hover:border-slate-500'
            }`}
          >
            {t('settings.buttonContinue')}
          </button>
        </div>
        {transitionType === 'auto' && (
          <div className="space-y-1.5">
            <p className="text-xs text-slate-400">{t('settings.waitTime')}</p>
            <div className="flex gap-2">
              {DELAY_OPTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setTransitionDelay(s)}
                  className={`flex-1 py-2 rounded-xl border-2 text-sm font-medium transition-all ${
                    transitionDelay === s
                      ? 'border-blue-500 bg-blue-500/10 text-white'
                      : 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/40 text-slate-500 dark:text-slate-400 hover:border-slate-400 dark:hover:border-slate-500'
                  }`}
                >
                  {s}s
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {transitionType === 'button'
            ? t('settings.transitionButton')
            : t('settings.transitionAuto', { count: transitionDelay })}
        </p>
      </div>

      {/* Leitner box days */}
      <LeitnerEditor />

      {/* Pagination options */}
      <PaginationEditor />

      {/* Themes CRUD */}
      <ThemesManager />

      {/* Video Clips */}
      <div className="card space-y-4">
        <div>
          <h2 className="font-semibold text-slate-800 dark:text-slate-200">{t('settings.videoClips')}</h2>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{t('settings.videoClipsDesc')}</p>
        </div>

        {/* Auto-play toggle */}
        <Toggle
          value={videoClipAutoPlay}
          onChange={setVideoClipAutoPlay}
          label={t('settings.videoClipAutoPlay')}
          description={t('settings.videoClipAutoPlayDesc')}
        />

        {/* Pause between clips */}
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('settings.videoClipPause')}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">{t('settings.videoClipPauseDesc')}</p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setVideoClipPauseSec(videoClipPauseSec - 1)}
              disabled={videoClipPauseSec <= 0}
              className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-white/5 hover:bg-slate-300 dark:hover:bg-white/15 transition-colors text-sm font-bold disabled:opacity-30 disabled:cursor-not-allowed"
            >−</button>
            <span className="text-lg font-bold text-slate-800 dark:text-white w-16 text-center">
              {videoClipPauseSec === 0 ? t('settings.videoClipNone') : `${videoClipPauseSec}s`}
            </span>
            <button
              onClick={() => setVideoClipPauseSec(videoClipPauseSec + 1)}
              disabled={videoClipPauseSec >= 10}
              className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-white/5 hover:bg-slate-300 dark:hover:bg-white/15 transition-colors text-sm font-bold disabled:opacity-30 disabled:cursor-not-allowed"
            >+</button>
          </div>
        </div>

        {/* Context lines */}
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('settings.videoClipContext')}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">{t('settings.videoClipContextDesc')}</p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setVideoClipContext(videoClipContext - 1)}
              disabled={videoClipContext <= 0}
              className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-white/5 hover:bg-slate-300 dark:hover:bg-white/15 transition-colors text-sm font-bold disabled:opacity-30 disabled:cursor-not-allowed"
            >−</button>
            <span className="text-lg font-bold text-slate-800 dark:text-white w-16 text-center">
              {videoClipContext === 0 ? '0' : `±${videoClipContext}`}
            </span>
            <button
              onClick={() => setVideoClipContext(videoClipContext + 1)}
              disabled={videoClipContext >= 5}
              className="w-8 h-8 rounded-lg bg-slate-200 dark:bg-white/5 hover:bg-slate-300 dark:hover:bg-white/15 transition-colors text-sm font-bold disabled:opacity-30 disabled:cursor-not-allowed"
            >+</button>
          </div>
        </div>

        {/* Playback rate */}
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('settings.videoClipPlaybackRate')}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">{t('settings.videoClipPlaybackRateDesc')}</p>
          <div className="flex gap-1.5 flex-wrap">
            {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((rate) => (
              <button
                key={rate}
                onClick={() => setVideoClipPlaybackRate(rate)}
                className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                  videoClipPlaybackRate === rate
                    ? 'border-blue-500 bg-blue-500/15 text-blue-300'
                    : 'border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/40 text-slate-500 dark:text-slate-400 hover:border-slate-400 dark:hover:border-slate-500'
                }`}
              >
                {rate}x
              </button>
            ))}
          </div>
        </div>

        {/* Max refs per word */}
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('settings.maxRefsPerWord')}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">{t('settings.maxRefsPerWordDesc')}</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMaxRefsPerWord(maxRefsPerWord - 1)}
              className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 font-medium transition-colors"
            >−</button>
            <span className="w-10 text-center font-medium text-slate-700 dark:text-slate-200">{maxRefsPerWord}</span>
            <button
              onClick={() => setMaxRefsPerWord(maxRefsPerWord + 1)}
              className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 font-medium transition-colors"
            >+</button>
          </div>
        </div>

        {/* Subtitle index fields */}
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{t('settings.subtitleIndexFields')}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">{t('settings.subtitleIndexFieldsDesc')}</p>
          <div className="flex flex-col gap-1.5 pt-0.5">
            {([
              { key: 'palabra', label: t('settings.subtitleIndexPalabra'), checked: subtitleIndexPalabra, set: setSubtitleIndexPalabra },
              { key: 'audioText', label: t('settings.subtitleIndexAudioText'), checked: subtitleIndexAudioText, set: setSubtitleIndexAudioText },
              { key: 'significado', label: t('settings.subtitleIndexSignificado'), checked: subtitleIndexSignificado, set: setSubtitleIndexSignificado },
            ] as const).map(({ key, label, checked, set }) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => set(e.target.checked)}
                  className="w-4 h-4 rounded accent-blue-500 cursor-pointer"
                />
                <span className="text-sm text-slate-600 dark:text-slate-300 group-hover:text-slate-800 dark:group-hover:text-slate-100 transition-colors">
                  {label}
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-600">{t('settings.subtitleIndexFieldsHint')}</p>
        </div>
      </div>
    </div>

      {/* ── Import ─────────────────────────────────────────────────────────── */}
      <div className="card space-y-4">
        <button
          onClick={() => setShowImport(v => !v)}
          className="w-full flex items-center justify-between text-left"
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">📥</span>
            <span className="font-semibold text-slate-800 dark:text-slate-100">
              {t('settings.import', 'Importar')}
            </span>
          </div>
          <span className="text-slate-400 text-sm">{showImport ? '▲' : '▼'}</span>
        </button>
        {showImport && (
          <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
            <Import />
          </div>
        )}
      </div>

      {/* AI Providers Modal */}
      {showAIProviders && (
        <AIProvidersModal
          onClose={() => setShowAIProviders(false)}
          onActiveChanged={() => {
            aiProvidersApi.active()
              .then((r) => setActiveProvider(r.data))
              .catch(() => setActiveProvider(null))
          }}
        />
      )}
    </>
  )
}
