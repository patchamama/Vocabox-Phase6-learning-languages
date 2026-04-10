import type { RoundType } from '../stores/settingsStore'
import { useSettingsStore } from '../stores/settingsStore'

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

const WORDS_OPTIONS = [5, 10, 15, 20, 30]
const DELAY_OPTIONS = [1, 2, 3, 5]

const ROUND_OPTIONS: { value: RoundType; label: string }[] = [
  { value: 'pair_match',       label: 'Pareo' },
  { value: 'first_letter',     label: 'Letra inicial' },
  { value: 'anagram',          label: 'Anagrama' },
  { value: 'write',            label: 'Escribir' },
  { value: 'multiple_choice',  label: 'Opción múltiple' },
  { value: 'random',           label: 'Aleatorio' },
]

function RoundSelector({
  label,
  value,
  onChange,
}: {
  label: string
  value: RoundType
  onChange: (v: RoundType) => void
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-slate-400 font-medium">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {ROUND_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
              value === opt.value
                ? 'border-blue-500 bg-blue-500/15 text-blue-300'
                : 'border-slate-600 bg-slate-700/40 text-slate-400 hover:border-slate-500'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function Settings() {
  const {
    reviewMode, wordsPerSession, transitionDelay, transitionType,
    safeRound1, safeRound2, safeRound3, autoPlayAudio, wordsOnly,
    setReviewMode, setWordsPerSession, setTransitionDelay, setTransitionType,
    setSafeRound, setAutoPlayAudio, setWordsOnly,
  } = useSettingsStore()

  return (
    <div className="p-4 pt-8 space-y-6">
      <h1 className="text-2xl font-bold">Configuración</h1>

      {/* Review mode */}
      <div className="card space-y-3">
        <h2 className="font-semibold text-slate-200">Modo de repaso</h2>
        <button
          onClick={() => setReviewMode('simple')}
          className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
            reviewMode === 'simple'
              ? 'border-blue-500 bg-blue-500/10'
              : 'border-slate-600 bg-slate-700/40 hover:border-slate-500'
          }`}
        >
          <div className="font-medium text-white">Modo simple</div>
          <div className="text-sm text-slate-400 mt-0.5">
            Una ronda. Cada palabra se ejercita una vez con un tipo aleatorio.
          </div>
        </button>
        <button
          onClick={() => setReviewMode('safe')}
          className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
            reviewMode === 'safe'
              ? 'border-blue-500 bg-blue-500/10'
              : 'border-slate-600 bg-slate-700/40 hover:border-slate-500'
          }`}
        >
          <div className="font-medium text-white">Modo seguro</div>
          <div className="text-sm text-slate-400 mt-0.5">
            3 rondas completas. Todas las palabras pasan por cada ronda antes de avanzar.
            Las frases siempre usan opción múltiple.
          </div>
        </button>
      </div>

      {/* Safe mode rounds */}
      {reviewMode === 'safe' && (
        <div className="card space-y-4">
          <h2 className="font-semibold text-slate-200">Ejercicio por ronda</h2>
          <p className="text-xs text-slate-500">
            Elige qué tipo de ejercicio se usa en cada ronda para palabras cortas (≤2 palabras).
            Las frases siempre usan opción múltiple.
          </p>
          <RoundSelector
            label="Ronda 1"
            value={safeRound1}
            onChange={(v) => setSafeRound(1, v)}
          />
          <RoundSelector
            label="Ronda 2"
            value={safeRound2}
            onChange={(v) => setSafeRound(2, v)}
          />
          <RoundSelector
            label="Ronda 3"
            value={safeRound3}
            onChange={(v) => setSafeRound(3, v)}
          />
        </div>
      )}

      {/* Words per session */}
      <div className="card space-y-3">
        <h2 className="font-semibold text-slate-200">Palabras por sesión</h2>
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
            ? `En modo seguro se harán hasta ${wordsPerSession * 3} ejercicios por sesión.`
            : `Se cargarán hasta ${wordsPerSession} palabras por sesión.`}
        </p>
      </div>

      {/* Audio */}
      <div className="card space-y-3">
        <h2 className="font-semibold text-slate-200">Audio</h2>
        <Toggle
          value={autoPlayAudio}
          onChange={setAutoPlayAudio}
          label="Reproducir audio automáticamente"
          description="Pronuncia la palabra al iniciarse cada ejercicio (opción múltiple y escritura)."
        />
      </div>

      {/* Words only */}
      <div className="card space-y-3">
        <h2 className="font-semibold text-slate-200">Contenido</h2>
        <Toggle
          value={wordsOnly}
          onChange={setWordsOnly}
          label="Solo palabras (sin frases)"
          description="Excluye entradas de más de 2 palabras en el repaso, la lista y las estadísticas."
        />
      </div>

      {/* Transition */}
      <div className="card space-y-3">
        <h2 className="font-semibold text-slate-200">Transición entre ejercicios</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setTransitionType('auto')}
            className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${
              transitionType === 'auto'
                ? 'border-blue-500 bg-blue-500/10 text-white'
                : 'border-slate-600 bg-slate-700/40 text-slate-400 hover:border-slate-500'
            }`}
          >
            Automático
          </button>
          <button
            onClick={() => setTransitionType('button')}
            className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-medium transition-all ${
              transitionType === 'button'
                ? 'border-blue-500 bg-blue-500/10 text-white'
                : 'border-slate-600 bg-slate-700/40 text-slate-400 hover:border-slate-500'
            }`}
          >
            Botón continuar
          </button>
        </div>
        {transitionType === 'auto' && (
          <div className="space-y-1.5">
            <p className="text-xs text-slate-400">Tiempo de espera</p>
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
            ? 'Aparece un botón para continuar al siguiente ejercicio.'
            : `Avance automático tras ${transitionDelay} segundo${transitionDelay > 1 ? 's' : ''}.`}
        </p>
      </div>
    </div>
  )
}
