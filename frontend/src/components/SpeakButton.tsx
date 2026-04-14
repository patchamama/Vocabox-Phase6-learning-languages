/**
 * SpeakButton — audio play button with two visual modes:
 *   hasMp3=true  → teal, full speaker + wide-range wave  (real MP3 from DB)
 *   hasMp3=false → slate, basic speaker (browser speech synthesis fallback)
 */
interface Props {
  onClick: (e: React.MouseEvent) => void
  hasMp3: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZES = { sm: 'w-4 h-4', md: 'w-5 h-5', lg: 'w-6 h-6' }

export default function SpeakButton({ onClick, hasMp3, size = 'md', className = '' }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hasMp3 ? 'Reproducir audio MP3' : 'Escuchar (síntesis de voz)'}
      className={`transition-colors ${
        hasMp3
          ? 'text-teal-400 hover:text-teal-300 drop-shadow-[0_0_6px_rgba(45,212,191,0.4)]'
          : 'text-slate-400 hover:text-blue-400'
      } ${className}`}
    >
      <svg viewBox="0 0 24 24" className={SIZES[size]} fill="currentColor" aria-hidden>
        {/* Speaker body + near wave (always shown) */}
        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" />
        {/* Far wave — only shown for MP3 */}
        {hasMp3 && (
          <path d="M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
        )}
      </svg>
    </button>
  )
}
