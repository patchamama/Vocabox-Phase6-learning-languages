import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { statsApi } from '../api/client'
import type { Stats } from '../types'
import { useAuthStore } from '../stores/authStore'

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

  useEffect(() => {
    statsApi.get().then((r) => setStats(r.data)).catch(() => {})
  }, [])

  const toggleBox = (box: number) => {
    setSelectedBoxes((prev) => {
      const next = new Set(prev)
      if (next.has(box)) {
        // Don't allow deselecting the last one
        if (next.size === 1) return prev
        next.delete(box)
      } else {
        next.add(box)
      }
      return next
    })
  }

  const maxCount = stats ? Math.max(...stats.boxes.map((b) => b.count), 1) : 1

  // Pending count for the currently selected boxes
  const pendingInSelected = stats
    ? stats.boxes
        .filter((b) => selectedBoxes.has(b.box))
        .reduce((sum, b) => sum + b.pending_today, 0)
    : 0

  const startReview = () => {
    const allSelected = selectedBoxes.size === ALL_BOXES.length
    if (allSelected) {
      navigate('/review')
    } else {
      navigate(`/review?boxes=${[...selectedBoxes].sort().join(',')}`)
    }
  }

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
            <div className="text-xs text-slate-600 mt-1">
              ({stats.pending_today} total)
            </div>
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

      {/* Box distribution with selection */}
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
                    new Set(
                      stats.boxes
                        .filter((b) => b.pending_today > 0)
                        .map((b) => b.box)
                    )
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
                  className={`flex items-center gap-3 transition-opacity ${
                    !isSelected ? 'opacity-40' : ''
                  }`}
                >
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleBox(box)}
                    className="w-3.5 h-3.5 rounded accent-blue-500 shrink-0 cursor-pointer"
                  />

                  {/* Box label */}
                  <span
                    className="text-xs text-slate-500 w-10 shrink-0 cursor-pointer"
                    onClick={() => navigate(`/words?box=${box}`)}
                    title="Ver palabras en esta caja"
                  >
                    Caja {box}
                  </span>

                  {/* Progress bar */}
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

                  {/* Counts: total + pending */}
                  <div className="flex items-center gap-1 shrink-0 min-w-[52px] justify-end">
                    <span className="text-xs text-slate-400">{count}</span>
                    {pending_today > 0 && (
                      <span className="text-xs text-blue-400 font-medium">
                        +{pending_today}
                      </span>
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
    </div>
  )
}
