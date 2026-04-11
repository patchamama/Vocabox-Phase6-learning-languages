import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { statsApi } from '../api/client'
import { useSettingsStore } from '../stores/settingsStore'
import type { Stats as StatsType } from '../types'

const BOX_COLORS = ['#ef4444', '#f97316', '#eab308', '#a3e635', '#22d3ee', '#3b82f6', '#a855f7']

export default function Stats() {
  const { t } = useTranslation()
  const { leitnerDays } = useSettingsStore()
  const [stats, setStats] = useState<StatsType | null>(null)

  useEffect(() => {
    statsApi.get().then((r) => setStats(r.data)).catch(() => {})
  }, [])

  if (!stats) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">{t('common.loading')}</div>
    )
  }

  const boxPrefix = t('box.prefix')
  const chartData = stats.boxes.map((b, i) => ({
    name: `${boxPrefix}${b.box}`,
    value: b.count,
    color: BOX_COLORS[i],
  }))

  const boxInterval = (i: number) => {
    const days = leitnerDays[i] ?? 0
    if (days === 0) return t('stats.immediate')
    return t('stats.day', { count: days })
  }

  return (
    <div className="p-4 pt-8 space-y-6 animate-slide-up">
      <h1 className="text-2xl font-bold">{t('stats.title')}</h1>

      <div className="grid grid-cols-2 gap-3">
        <div className="card text-center">
          <div className="text-4xl font-bold text-blue-400">{stats.total_words}</div>
          <div className="text-slate-400 text-sm mt-1">{t('stats.totalWords')}</div>
        </div>
        <div className="card text-center">
          <div className="text-4xl font-bold text-yellow-400">{stats.pending_today}</div>
          <div className="text-slate-400 text-sm mt-1">{t('stats.pendingToday')}</div>
        </div>
        <div className="card text-center">
          <div className="text-4xl font-bold text-orange-400">{stats.streak}</div>
          <div className="text-slate-400 text-sm mt-1">{t('stats.streak')}</div>
        </div>
        <div className="card text-center">
          <div className="text-4xl font-bold text-green-400">
            {stats.accuracy > 0 ? `${Math.round(stats.accuracy * 100)}%` : '—'}
          </div>
          <div className="text-slate-400 text-sm mt-1">{t('stats.accuracy')}</div>
        </div>
      </div>

      <div className="card">
        <h2 className="font-semibold text-slate-300 mb-4">{t('stats.wordsByBox')}</h2>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={chartData} margin={{ top: 0, right: 0, left: -25, bottom: 0 }}>
            <XAxis dataKey="name" stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <YAxis stroke="#475569" tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
                fontSize: '13px',
              }}
              labelStyle={{ color: '#94a3b8' }}
              cursor={{ fill: 'rgba(255,255,255,0.05)' }}
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <h2 className="font-semibold text-slate-300 mb-3">{t('stats.leitnerSystem')}</h2>
        <div className="divide-y divide-slate-700/50">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => {
            const boxStat = stats.boxes.find((b) => b.box === i)
            const count = boxStat?.count ?? 0
            const pending = boxStat?.pending_today ?? 0
            return (
              <div
                key={i}
                className={`flex items-center gap-2 py-2 text-sm ${count === 0 ? 'opacity-40' : ''}`}
              >
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: BOX_COLORS[i] }}
                />
                <span className="text-white font-medium w-14 shrink-0">{t('stats.box', { n: i })}</span>
                <span className="text-slate-500 text-xs flex-1">{boxInterval(i)}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-slate-400 text-xs tabular-nums">{count}</span>
                  {pending > 0 ? (
                    <span className="text-xs font-medium text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded-full tabular-nums">
                      {t('stats.today', { count: pending })}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-700 w-[60px]" />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
