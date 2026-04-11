import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RoundType } from '../stores/settingsStore'
import { useSettingsStore } from '../stores/settingsStore'
import { temasApi } from '../api/client'
import type { Tema } from '../types'

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
      className="w-full flex items-center justify-between p-4 rounded-xl border-2 border-slate-600 bg-slate-700/40 hover:border-slate-500 transition-all text-left"
    >
      <div>
        <div className="font-medium text-white text-sm">{label}</div>
        {description && <div className="text-xs text-slate-400 mt-0.5">{description}</div>}
      </div>
      <div className={`w-11 h-6 rounded-full transition-colors shrink-0 ml-3 relative ${value ? 'bg-blue-500' : 'bg-slate-600'}`}>
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
      <p className="text-xs text-slate-400 font-medium">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {ROUND_EXERCISE_KEYS.map((key) => (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
              value === key
                ? 'border-blue-500 bg-blue-500/15 text-blue-300'
                : 'border-slate-600 bg-slate-700/40 text-slate-400 hover:border-slate-500'
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

const DAY_PRESETS = [0, 1, 2, 3, 4, 5, 7, 10, 14, 21, 30, 60]

function LeitnerEditor() {
  const { t } = useTranslation()
  const { leitnerDays, setLeitnerDay } = useSettingsStore()

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="font-semibold text-slate-200">{t('settings.leitnerBoxDays')}</h2>
        <p className="text-xs text-slate-500 mt-1">{t('settings.leitnerBoxDaysDesc')}</p>
      </div>
      <div className="space-y-3">
        {leitnerDays.map((days, box) => (
          <div key={box} className="flex items-center gap-3">
            <span className="text-xs text-slate-400 w-14 shrink-0">{t('settings.box', { n: box })}</span>
            <div className="flex gap-1.5 flex-wrap flex-1">
              {DAY_PRESETS.map((preset) => (
                <button
                  key={preset}
                  onClick={() => setLeitnerDay(box, preset)}
                  className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-all ${
                    days === preset
                      ? 'border-blue-500 bg-blue-500/15 text-blue-300'
                      : 'border-slate-600 bg-slate-700/40 text-slate-400 hover:border-slate-500'
                  }`}
                >
                  {preset === 0 ? '0' : t('settings.days', { count: preset })}
                </button>
              ))}
            </div>
            <span className="text-xs text-slate-500 w-10 text-right shrink-0">
              {t('settings.days', { count: days })}
            </span>
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
          <h2 className="font-semibold text-slate-200">{t('settings.themes')}</h2>
          <p className="text-xs text-slate-500 mt-1">{t('settings.themesDesc')}</p>
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
        <div className="p-3 rounded-xl border border-slate-600 bg-slate-700/40 space-y-3">
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
              className="flex-1 py-2 rounded-xl border border-slate-600 text-slate-400 text-sm hover:border-slate-500 transition-colors"
            >
              {t('settings.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <p className="text-xs text-slate-500">…</p>
      ) : temas.length === 0 ? (
        <p className="text-xs text-slate-500">{t('settings.noThemes')}</p>
      ) : (
        <div className="space-y-2">
          {temas.map((tema) => (
            <div
              key={tema.id}
              className="flex items-center gap-3 p-3 rounded-xl border border-slate-600 bg-slate-700/40"
            >
              <span
                className="w-4 h-4 rounded-full shrink-0"
                style={{ backgroundColor: tema.color }}
              />
              <span className="flex-1 text-sm text-slate-200">{tema.nombre}</span>
              <button
                onClick={() => openEdit(tema)}
                className="text-xs text-slate-400 hover:text-slate-200 transition-colors px-2"
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

// ─── Main Settings Page ───────────────────────────────────────────────────────

const WORDS_OPTIONS = [5, 10, 15, 20, 30]
const DELAY_OPTIONS = [1, 2, 3, 5]

export default function Settings() {
  const { t } = useTranslation()
  const {
    reviewMode, wordsPerSession, transitionDelay, transitionType,
    safeRound1, safeRound2, safeRound3, autoPlayAudio, wordsOnly,
    setReviewMode, setWordsPerSession, setTransitionDelay, setTransitionType,
    setSafeRound, setAutoPlayAudio, setWordsOnly,
  } = useSettingsStore()

  return (
    <div className="p-4 pt-8 space-y-6">
      <h1 className="text-2xl font-bold">{t('settings.title')}</h1>

      {/* Review mode */}
      <div className="card space-y-3">
        <h2 className="font-semibold text-slate-200">{t('settings.reviewMode')}</h2>
        <button
          onClick={() => setReviewMode('simple')}
          className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
            reviewMode === 'simple'
              ? 'border-blue-500 bg-blue-500/10'
              : 'border-slate-600 bg-slate-700/40 hover:border-slate-500'
          }`}
        >
          <div className="font-medium text-white">{t('settings.simpleMode')}</div>
          <div className="text-sm text-slate-400 mt-0.5">{t('settings.simpleModeDesc')}</div>
        </button>
        <button
          onClick={() => setReviewMode('safe')}
          className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
            reviewMode === 'safe'
              ? 'border-blue-500 bg-blue-500/10'
              : 'border-slate-600 bg-slate-700/40 hover:border-slate-500'
          }`}
        >
          <div className="font-medium text-white">{t('settings.safeMode')}</div>
          <div className="text-sm text-slate-400 mt-0.5">{t('settings.safeModeDesc')}</div>
        </button>
      </div>

      {/* Safe mode rounds */}
      {reviewMode === 'safe' && (
        <div className="card space-y-4">
          <h2 className="font-semibold text-slate-200">{t('settings.exercisePerRound')}</h2>
          <p className="text-xs text-slate-500">{t('settings.exercisePerRoundDesc')}</p>
          <RoundSelector label={t('settings.round', { n: 1 })} value={safeRound1} onChange={(v) => setSafeRound(1, v)} />
          <RoundSelector label={t('settings.round', { n: 2 })} value={safeRound2} onChange={(v) => setSafeRound(2, v)} />
          <RoundSelector label={t('settings.round', { n: 3 })} value={safeRound3} onChange={(v) => setSafeRound(3, v)} />
        </div>
      )}

      {/* Words per session */}
      <div className="card space-y-3">
        <h2 className="font-semibold text-slate-200">{t('settings.wordsPerSession')}</h2>
        <div className="flex gap-2 flex-wrap">
          {WORDS_OPTIONS.map((n) => (
            <button
              key={n}
              onClick={() => setWordsPerSession(n)}
              className={`px-5 py-2.5 rounded-xl border-2 font-medium transition-all ${
                wordsPerSession === n
                  ? 'border-blue-500 bg-blue-500/10 text-white'
                  : 'border-slate-600 bg-slate-700/40 text-slate-400 hover:border-slate-500'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500">
          {reviewMode === 'safe'
            ? t('settings.wordsPerSessionSafe', { count: wordsPerSession * 3 })
            : t('settings.wordsPerSessionSimple', { count: wordsPerSession })}
        </p>
      </div>

      {/* Audio */}
      <div className="card space-y-3">
        <h2 className="font-semibold text-slate-200">{t('settings.audio')}</h2>
        <Toggle
          value={autoPlayAudio}
          onChange={setAutoPlayAudio}
          label={t('settings.autoPlayAudio')}
          description={t('settings.autoPlayAudioDesc')}
        />
      </div>

      {/* Content */}
      <div className="card space-y-3">
        <h2 className="font-semibold text-slate-200">{t('settings.content')}</h2>
        <Toggle
          value={wordsOnly}
          onChange={setWordsOnly}
          label={t('settings.wordsOnly')}
          description={t('settings.wordsOnlyDesc')}
        />
      </div>

      {/* Transition */}
      <div className="card space-y-3">
        <h2 className="font-semibold text-slate-200">{t('settings.transition')}</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setTransitionType('auto')}
            className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${
              transitionType === 'auto'
                ? 'border-blue-500 bg-blue-500/10 text-white'
                : 'border-slate-600 bg-slate-700/40 text-slate-400 hover:border-slate-500'
            }`}
          >
            {t('settings.auto')}
          </button>
          <button
            onClick={() => setTransitionType('button')}
            className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${
              transitionType === 'button'
                ? 'border-blue-500 bg-blue-500/10 text-white'
                : 'border-slate-600 bg-slate-700/40 text-slate-400 hover:border-slate-500'
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
                      : 'border-slate-600 bg-slate-700/40 text-slate-400 hover:border-slate-500'
                  }`}
                >
                  {s}s
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="text-xs text-slate-500">
          {transitionType === 'button'
            ? t('settings.transitionButton')
            : t('settings.transitionAuto', { count: transitionDelay })}
        </p>
      </div>

      {/* Leitner box days */}
      <LeitnerEditor />

      {/* Themes CRUD */}
      <ThemesManager />
    </div>
  )
}
