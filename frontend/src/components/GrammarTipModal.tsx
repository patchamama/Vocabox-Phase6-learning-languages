import { useEffect } from 'react'
import type { GrammarTip, TipLang } from '../data/germanGrammarTips'

interface Props {
  tip: GrammarTip
  lang: TipLang
  onClose: () => void
}

export default function GrammarTipModal({ tip, lang, onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const title = tip.title[lang] ?? tip.title.en
  const body = tip.body[lang] ?? tip.body.en

  // Render **bold** markers
  const renderBody = (text: string) =>
    text.split(/(\*\*[^*]+\*\*)/).map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="text-blue-300">{part.slice(2, -2)}</strong>
      }
      return <span key={i}>{part}</span>
    })

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-slate-800 border border-slate-600 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[80vh] overflow-y-auto p-5 space-y-4 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">💡</span>
            <h3 className="font-semibold text-white text-sm">{title}</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <p className="text-sm text-slate-300 whitespace-pre-line leading-relaxed">
          {renderBody(body)}
        </p>

        {/* Optional case table */}
        {tip.table && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr>
                  {(tip.table.headers[lang] ?? tip.table.headers.en).map((h, i) => (
                    <th
                      key={i}
                      className="bg-slate-700 text-slate-300 px-2 py-1 text-left border border-slate-600"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tip.table.rows.map((row, ri) => (
                  <tr key={ri} className={ri % 2 === 0 ? 'bg-slate-800' : 'bg-slate-750'}>
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-2 py-1 border border-slate-600 text-slate-200">
                        {renderBody(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
