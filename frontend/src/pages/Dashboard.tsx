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

export default function Dashboard() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    statsApi.get().then((r) => setStats(r.data)).catch(() => {})
  }, [])

  const maxCount = stats ? Math.max(...stats.boxes.map((b) => b.count), 1) : 1

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
          <div className="text-4xl font-bold text-blue-400">{stats?.pending_today ?? '—'}</div>
          <div className="text-slate-400 text-sm mt-1">Para repasar hoy</div>
        </div>
        <div className="card text-center">
          <div className="text-4xl font-bold text-green-400">{stats?.total_words ?? '—'}</div>
          <div className="text-slate-400 text-sm mt-1">Total palabras</div>
        </div>
      </div>

      {/* CTA */}
      {stats && stats.pending_today > 0 && (
        <button onClick={() => navigate('/review')} className="btn-primary w-full text-lg py-4">
          Repasar {stats.pending_today} palabra{stats.pending_today !== 1 ? 's' : ''}
        </button>
      )}

      {stats && stats.pending_today === 0 && (
        <div className="card text-center py-8">
          <div className="text-5xl mb-2">🎉</div>
          <p className="text-slate-300 font-medium">Todo al día por hoy</p>
          <p className="text-slate-500 text-sm mt-1">Vuelve más tarde</p>
        </div>
      )}

      {/* Box distribution */}
      {stats && (
        <div className="card">
          <h2 className="font-semibold text-slate-300 mb-4">Distribución por cajas</h2>
          <div className="space-y-2">
            {stats.boxes.map(({ box, count }) => (
              <div
                key={box}
                className="flex items-center gap-3 cursor-pointer hover:opacity-75 transition-opacity"
                onClick={() => navigate(`/words?box=${box}`)}
                title={`Ver palabras en caja ${box}`}
              >
                <span className="text-xs text-slate-500 w-12 shrink-0">Caja {box}</span>
                <div className="flex-1 bg-slate-700 rounded-full h-3 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${BOX_COLORS[box]}`}
                    style={{ width: `${(count / maxCount) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-slate-400 w-5 text-right shrink-0">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
