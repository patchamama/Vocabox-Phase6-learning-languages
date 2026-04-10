import { useSettingsStore } from '../stores/settingsStore'

const WORDS_OPTIONS = [5, 10, 15, 20, 30]

export default function Settings() {
  const { reviewMode, wordsPerSession, setReviewMode, setWordsPerSession } = useSettingsStore()

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
            Cada palabra se repasa una vez por sesión con un solo ejercicio.
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
            Cada palabra debe pasar por al menos 3 tipos de ejercicio distintos sin error.
            Las frases largas solo usan opciones múltiples o pareo.
          </div>
        </button>
      </div>

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
    </div>
  )
}
