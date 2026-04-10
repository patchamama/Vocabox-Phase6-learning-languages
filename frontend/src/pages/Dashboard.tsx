import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { statsApi, testApi } from '../api/client'
import type { Stats } from '../types'
import { useAuthStore } from '../stores/authStore'
import { useSettingsStore } from '../stores/settingsStore'

const BOX_COLORS = [
  'bg-red-500',
  'bg-orange-500',
  'bg-yellow-400',
  'bg-lime-400',
  'bg-cyan-400',
  'bg-blue-500',
  'bg-purple-500',
]

const ALL_BOXES = [0, 1, 2, 3, 4, 5, 6]

export default function Dashboard() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const [stats, setStats] = useState<Stats | null>(null)
  const [selectedBoxes, setSelectedBoxes] = useState<Set<number>>(new Set(ALL_BOXES))
  const { wordsOnly, setWordsOnly } = useSettingsStore()

  // Test-mode state (only rendered for username === 'test')
  const [isSimulating, setIsSimulating] = useState(false)
  const [simMsg, setSimMsg] = useState<{ text: string; ok: boolean } | null>(null)

  const isTestUser = user?.username?.toLowerCase() === 'test'

  const refreshStats = async (wo = wordsOnly) => {
    const r = await statsApi.get(wo)
    setStats(r.data)
  }

  useEffect(() => {
    refreshStats().catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    refreshStats(wordsOnly).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordsOnly])

  const toggleBox = (box: number) => {
    setSelectedBoxes((prev) => {
      const next = new Set(prev)
      if (next.has(box)) {
        if (next.size === 1) return prev   // keep at least one selected
        next.delete(box)
      } else {
        next.add(box)
      }
      return next
    })
  }

  const maxCount = stats ? Math.max(...stats.boxes.map((b) => b.count), 1) : 1

  const pendingInSelected = stats
    ? stats.boxes
        .filter((b) => selectedBoxes.has(b.box))
        .reduce((sum, b) => sum + b.pending_today, 0)
    : 0

  const startReview = () => {
    const allSelected = selectedBoxes.size === ALL_BOXES.length
    navigate(allSelected ? '/review' : `/review?boxes=${[...selectedBoxes].sort().join(',')}`)
  }

  // ── Test mode helpers ─────────────────────────────────────────────────────

  const showMsg = (text: string, ok: boolean) => {
    setSimMsg({ text, ok })
    setTimeout(() => setSimMsg(null), 4000)
  }

  const handleSimulate = async () => {
    setIsSimulating(true)
    setSimMsg(null)
    try {
      const { data } = await testApi.simulate()
      await refreshStats(wordsOnly)
      setSelectedBoxes(new Set(ALL_BOXES))
      showMsg(`Simulado: ${data.words} palabras distribuidas entre cajas`, true)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      showMsg(detail ?? 'Error al simular', false)
    } finally {
      setIsSimulating(false)
    }
  }

  const handleReset = async () => {
    setIsSimulating(true)
    setSimMsg(null)
    try {
      const { data } = await testApi.reset()
      await refreshStats(wordsOnly)
      setSelectedBoxes(new Set(ALL_BOXES))
      showMsg(`Restablecido: ${data.words} palabras en caja 0`, true)
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      showMsg(detail ?? 'Error al restablecer', false)
    } finally {
      setIsSimulating(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 pt-8 space-y-6 animate-slide-up">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">Hola, {user?.username}!</h1>
          <p className="text-slate-400 text-sm">Sigue aprendiendo hoy</p>
        </div>
        <button onClick={logout} className="text-slate-500 hover:text-slate-300 text-sm">
          Salir
        </button>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card text-center">
          <div className="text-4xl font-bold text-blue-400">
            {stats ? pendingInSelected : '—'}
          </div>
          <div className="text-slate-400 text-sm mt-1">Para repasar hoy</div>
          {stats && selectedBoxes.size < ALL_BOXES.length && (
            <div className="text-xs text-slate-600 mt-1">({stats.pending_today} total)</div>
          )}
        </div>
        <div className="card text-center">
          <div className="text-4xl font-bold text-green-400">{stats?.total_words ?? '—'}</div>
          <div className="text-slate-400 text-sm mt-1">Total palabras</div>
        </div>
      </div>

      {/* CTA */}
      {stats && pendingInSelected > 0 && (
        <button onClick={startReview} className="btn-primary w-full text-lg py-4">
          Repasar {pendingInSelected} palabra{pendingInSelected !== 1 ? 's' : ''}
        </button>
      )}

      {stats && pendingInSelected === 0 && (
        <div className="card text-center py-8">
          <div className="text-5xl mb-2">🎉</div>
          <p className="text-slate-300 font-medium">
            {selectedBoxes.size < ALL_BOXES.length
              ? 'Sin pendientes en las cajas seleccionadas'
              : 'Todo al día por hoy'}
          </p>
          <p className="text-slate-500 text-sm mt-1">Vuelve más tarde</p>
        </div>
      )}

      {/* Box distribution */}
      {stats && (
        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-semibold text-slate-300">Distribución por cajas</h2>
            <div className="flex gap-2 text-xs text-slate-500">
              <button
                onClick={() => setSelectedBoxes(new Set(ALL_BOXES))}
                className="hover:text-slate-300 transition-colors"
              >
                Todas
              </button>
              <span>/</span>
              <button
                onClick={() =>
                  setSelectedBoxes(
                    new Set(stats.boxes.filter((b) => b.pending_today > 0).map((b) => b.box))
                  )
                }
                className="hover:text-slate-300 transition-colors"
              >
                Con pendientes
              </button>
            </div>
          </div>

          <div className="space-y-2.5">
            {stats.boxes.map(({ box, count, pending_today }) => {
              const isSelected = selectedBoxes.has(box)
              return (
                <div
                  key={box}
                  className={`flex items-center gap-3 transition-opacity ${!isSelected ? 'opacity-40' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleBox(box)}
                    className="w-3.5 h-3.5 rounded accent-blue-500 shrink-0 cursor-pointer"
                  />
                  <span
                    className="text-xs text-slate-500 w-10 shrink-0 cursor-pointer hover:text-slate-300 transition-colors"
                    onClick={() => navigate(`/words?box=${box}`)}
                    title="Ver palabras en esta caja"
                  >
                    Caja {box}
                  </span>
                  <div
                    className="flex-1 bg-slate-700 rounded-full h-3 overflow-hidden cursor-pointer"
                    onClick={() => navigate(`/words?box=${box}`)}
                    title="Ver palabras en esta caja"
                  >
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${BOX_COLORS[box]}`}
                      style={{ width: count > 0 ? `${(count / maxCount) * 100}%` : '0%' }}
                    />
                  </div>
                  <div className="flex items-center gap-1 shrink-0 min-w-[52px] justify-end">
                    <span className="text-xs text-slate-400">{count}</span>
                    {pending_today > 0 && (
                      <span className="text-xs text-blue-400 font-medium">+{pending_today}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <p className="text-xs text-slate-600 mt-3">
            Pulsa una caja para ver sus palabras · marca/desmarca para filtrar el repaso
          </p>
        </div>
      )}

      {/* Words-only filter */}
      <button
        onClick={() => setWordsOnly(!wordsOnly)}
        className="w-full flex items-center justify-between p-4 rounded-xl border-2 border-slate-600 bg-slate-700/40 hover:border-slate-500 transition-all text-left"
      >
        <div>
          <div className="font-medium text-white text-sm">Solo palabras (sin frases)</div>
          <div className="text-xs text-slate-400 mt-0.5">Excluye entradas de más de 2 palabras</div>
        </div>
        <div className={`w-11 h-6 rounded-full transition-colors shrink-0 ml-3 relative ${wordsOnly ? 'bg-blue-500' : 'bg-slate-600'}`}>
          <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${wordsOnly ? 'left-6' : 'left-1'}`} />
        </div>
      </button>

      {/* ── Test mode panel (only for username 'test') ── */}
      {isTestUser && (
        <div className="card border border-yellow-500/25 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-base">🧪</span>
            <h3 className="text-sm font-semibold text-yellow-400 tracking-wide">
              Herramientas de prueba
            </h3>
          </div>

          <p className="text-xs text-slate-500 leading-relaxed">
            <strong className="text-slate-400">Simular día</strong> redistribuye aleatoriamente
            tus palabras entre las 7 cajas con una mezcla realista de pendientes para hoy.
            <br />
            <strong className="text-slate-400">Resetear</strong> devuelve todo a la caja 0
            con revisión inmediata.
          </p>

          <div className="flex gap-2">
            <button
              onClick={handleSimulate}
              disabled={isSimulating}
              className="flex-1 py-2.5 px-3 bg-yellow-600/20 hover:bg-yellow-600/30 border border-yellow-500/30 text-yellow-300 text-sm rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSimulating ? '…' : 'Simular día'}
            </button>
            <button
              onClick={handleReset}
              disabled={isSimulating}
              className="flex-1 py-2.5 px-3 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSimulating ? '…' : 'Resetear todo'}
            </button>
          </div>

          {simMsg && (
            <p
              className={`text-xs font-medium ${
                simMsg.ok ? 'text-green-400' : 'text-red-400'
              }`}
            >
              {simMsg.ok ? '✓ ' : '✗ '}{simMsg.text}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
