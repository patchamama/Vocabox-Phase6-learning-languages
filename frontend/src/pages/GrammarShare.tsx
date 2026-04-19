/**
 * GrammarShare — Public read-only view of a grammar exercise (no login required).
 * Accessed via /grammar/share/:token
 */

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import type { SavedGrammarExercise, GrammarSegment } from '../api/client'

type BlankState = { selected: string | null; locked: boolean }

function groupBySentence(segments: GrammarSegment[]) {
  const groups: { segs: GrammarSegment[] }[] = []
  let current: GrammarSegment[] = []
  const flush = () => { if (current.length > 0) { groups.push({ segs: current }); current = [] } }

  for (const seg of segments) {
    if (seg.t === 'blank') { current.push(seg); continue }
    if (seg.t === 'text') {
      const parts = (seg.v ?? '').split('\n')
      parts.forEach((part, i) => {
        if (part) current.push({ ...seg, v: part })
        if (i < parts.length - 1) flush()
      })
    }
  }
  flush()
  return groups
}

export default function GrammarShare() {
  const { token } = useParams<{ token: string }>()
  const [exercise, setExercise] = useState<SavedGrammarExercise | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [blankStates, setBlankStates] = useState<Record<number, BlankState>>({})
  const [allDone, setAllDone] = useState(false)

  useEffect(() => {
    if (!token) return
    fetch(`${import.meta.env.BASE_URL}api/grammar/share/${token}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((ex: SavedGrammarExercise) => {
        setExercise(ex)
        const init: Record<number, BlankState> = {}
        ex.segments.forEach((s) => {
          if (s.t === 'blank' && s.id !== undefined) init[s.id] = { selected: null, locked: false }
        })
        setBlankStates(init)
      })
      .catch(() => setError('Exercise not found'))
  }, [token])

  const pick = (blankId: number, opt: string, _seg: GrammarSegment) => {
    setBlankStates((prev) => {
      if (prev[blankId]?.locked) return prev
      const next = { ...prev, [blankId]: { selected: opt, locked: true } }
      if (Object.values(next).every((s) => s.locked)) setAllDone(true)
      return next
    })
  }

  const chipClass = (blankId: number, opt: string, seg: GrammarSegment): string => {
    const bs = blankStates[blankId]
    if (!bs?.locked) return 'border-slate-600 text-slate-300 hover:border-blue-500 hover:text-white'
    const correct = seg.options?.[seg.correct ?? 0] ?? ''
    if (opt === correct) return 'border-green-500 text-green-300 bg-green-500/10'
    if (opt === bs.selected) return 'border-red-500 text-red-300 bg-red-500/10'
    return 'border-slate-700 text-slate-500'
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="text-slate-400 text-center">
          <p className="text-4xl mb-4">🔗</p>
          <p className="text-lg font-medium text-white mb-2">Exercise not found</p>
          <p className="text-sm">This link may be invalid or the exercise was deleted.</p>
        </div>
      </div>
    )
  }

  if (!exercise) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-slate-400 text-sm animate-pulse">Loading exercise…</div>
      </div>
    )
  }

  const sentences = groupBySentence(exercise.segments)
  const blanks = exercise.segments.filter((s) => s.t === 'blank')
  const answeredCount = Object.values(blankStates).filter((s) => s.locked).length
  const correctCount = blanks.filter((s) => {
    if (s.t !== 'blank' || s.id === undefined) return false
    const bs = blankStates[s.id]
    return bs?.locked && bs.selected === s.options?.[s.correct ?? 0]
  }).length

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <div className="max-w-lg mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="text-center space-y-1">
          <p className="text-xs text-slate-500 uppercase tracking-wider">Grammar Exercise</p>
          <h1 className="text-xl font-bold">{exercise.title}</h1>
          {exercise.topic && <p className="text-sm text-slate-400 italic">{exercise.topic}</p>}
          {exercise.cefr_level && (
            <span className="inline-block px-2 py-0.5 text-xs font-bold rounded border border-blue-500/40 text-blue-300 bg-blue-500/10">
              {exercise.cefr_level}
            </span>
          )}
        </div>

        {/* Progress */}
        <div className="flex items-center gap-3">
          <div className="flex-1 bg-slate-700 rounded-full h-1.5">
            <div
              className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
              style={{ width: blanks.length > 0 ? `${(answeredCount / blanks.length) * 100}%` : '0%' }}
            />
          </div>
          <span className="text-xs text-slate-400">{answeredCount}/{blanks.length}</span>
        </div>

        {/* Exercise sentences */}
        <div className="space-y-5">
          {sentences.map((group, gi) => (
            <div key={gi} className="flex items-start gap-2">
              <span className="text-[10px] text-slate-500 select-none mt-1.5 w-4 shrink-0 text-right">{gi + 1}</span>
              <p className="flex-1 text-white text-base leading-relaxed">
                {group.segs.map((seg, si) => {
                  if (seg.t === 'text') {
                    return (
                      <span key={si} className="italic text-slate-200">{seg.v}</span>
                    )
                  }
                  if (seg.t === 'blank' && seg.id !== undefined) {
                    const blankId = seg.id
                    const bs = blankStates[blankId]
                    const isLocked = bs?.locked ?? false
                    return (
                      <span key={si} className="inline-flex items-baseline gap-1 flex-wrap mx-0.5">
                        {seg.options?.map((opt) => (
                          <button
                            key={opt}
                            onClick={() => !isLocked && pick(blankId, opt, seg)}
                            className={`px-2 py-0.5 rounded-md border text-sm font-medium transition-all duration-200 ${chipClass(blankId, opt, seg)}`}
                          >
                            {opt}
                          </button>
                        ))}
                      </span>
                    )
                  }
                  return null
                })}
              </p>
            </div>
          ))}
        </div>

        {/* Result */}
        {allDone && (
          <div className="rounded-xl border border-slate-700 p-4 text-center space-y-1">
            <p className="text-2xl font-bold text-white">{correctCount}/{blanks.length}</p>
            <p className="text-sm text-slate-400">
              {correctCount === blanks.length ? '🎉 Perfect score!' : `${Math.round((correctCount / blanks.length) * 100)}% correct`}
            </p>
          </div>
        )}

        {/* Grammar notes */}
        {allDone && exercise.grammar_notes.length > 0 && (
          <div className="space-y-1.5 rounded-xl border border-slate-700/60 p-4">
            <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-2">Grammar notes</p>
            {exercise.grammar_notes.map((note, i) => (
              <p key={i} className="text-xs text-slate-300 leading-snug">{note}</p>
            ))}
          </div>
        )}

        <p className="text-center text-[10px] text-slate-600 pt-4">Powered by Vocabox</p>
      </div>
    </div>
  )
}
