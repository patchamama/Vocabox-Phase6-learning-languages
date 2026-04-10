import { useEffect, useRef, useState } from 'react'
import { importApi, temasApi } from '../api/client'
import TemaSelect from '../components/TemaSelect'
import type { ImportPreview, ImportResult, Tema } from '../types'

type Step = 'upload' | 'preview' | 'result'

const ACCEPTED = '.csv,.xlsx'

export default function Import() {
  const [step, setStep] = useState<Step>('upload')
  const [isDragging, setIsDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [temaId, setTemaId] = useState<string>('')
  const [temas, setTemas] = useState<Tema[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    temasApi.list().then((r) => setTemas(r.data)).catch(() => {})
  }, [])

  // ── File selection ──────────────────────────────────────────────────────────

  const handleFile = (f: File) => {
    const name = f.name.toLowerCase()
    if (!name.endsWith('.csv') && !name.endsWith('.xlsx')) {
      setError('Solo se aceptan archivos .csv y .xlsx')
      return
    }
    setFile(f)
    setError(null)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
  }

  // ── Preview ─────────────────────────────────────────────────────────────────

  const loadPreview = async () => {
    if (!file) return
    setIsLoading(true)
    setError(null)
    try {
      const { data } = await importApi.preview(file)
      setPreview(data)
      setStep('preview')
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? 'Error al analizar el archivo'
      setError(msg)
    } finally {
      setIsLoading(false)
    }
  }

  // ── Confirm ─────────────────────────────────────────────────────────────────

  const confirmImport = async () => {
    if (!preview) return
    setIsLoading(true)
    setError(null)
    try {
      const { data } = await importApi.confirm(
        preview.rows,
        temaId ? parseInt(temaId) : undefined,
      )
      setResult(data)
      setStep('result')
    } catch {
      setError('Error al importar las palabras')
    } finally {
      setIsLoading(false)
    }
  }

  const reset = () => {
    setStep('upload')
    setFile(null)
    setPreview(null)
    setResult(null)
    setTemaId('')
    setError(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 pt-8 space-y-5 animate-slide-up">
      <h1 className="text-2xl font-bold">Importar vocabulario</h1>

      {/* ── STEP 1: Upload ── */}
      {step === 'upload' && (
        <div className="space-y-4">
          <p className="text-slate-400 text-sm">
            Sube un archivo exportado desde Google Translate (.csv o .xlsx).
            Las palabras que ya tengas serán detectadas y omitidas.
          </p>

          {/* Drop zone */}
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            className={`cursor-pointer border-2 border-dashed rounded-2xl p-10 text-center transition-colors ${
              isDragging
                ? 'border-blue-400 bg-blue-500/10'
                : 'border-slate-600 hover:border-slate-400'
            }`}
          >
            <div className="text-4xl mb-3">📥</div>
            <p className="text-slate-300 font-medium">
              {file ? file.name : 'Arrastra tu archivo aquí'}
            </p>
            <p className="text-slate-500 text-sm mt-1">
              {file
                ? `${(file.size / 1024).toFixed(1)} KB · haz clic para cambiar`
                : 'o haz clic para seleccionar · .csv · .xlsx'}
            </p>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED}
              className="hidden"
              onChange={onInputChange}
            />
          </div>

          {error && (
            <div className="bg-red-500/20 border border-red-500/40 text-red-300 rounded-xl p-3 text-sm">
              {error}
            </div>
          )}

          <button
            onClick={loadPreview}
            disabled={!file || isLoading}
            className="btn-primary w-full"
          >
            {isLoading ? 'Analizando...' : 'Analizar archivo'}
          </button>
        </div>
      )}

      {/* ── STEP 2: Preview ── */}
      {step === 'preview' && preview && (
        <div className="space-y-4">
          {/* Summary card */}
          <div className="card space-y-3">
            <div className="flex items-center gap-2 text-slate-300 font-medium">
              <span className="text-lg">📂</span>
              <span className="truncate">{file?.name}</span>
            </div>

            <div className="flex items-center gap-2 text-sm text-slate-400">
              <span className="bg-slate-700 px-2 py-0.5 rounded-full">{preview.source_lang}</span>
              <span>→</span>
              <span className="bg-slate-700 px-2 py-0.5 rounded-full">{preview.target_lang}</span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-slate-700/50 rounded-xl p-2">
                <div className="text-xl font-bold">{preview.total}</div>
                <div className="text-xs text-slate-400">encontradas</div>
              </div>
              <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-2">
                <div className="text-xl font-bold text-green-400">{preview.new_count}</div>
                <div className="text-xs text-slate-400">nuevas</div>
              </div>
              <div className="bg-slate-700/30 rounded-xl p-2">
                <div className="text-xl font-bold text-slate-500">{preview.duplicate_count}</div>
                <div className="text-xs text-slate-400">duplicadas</div>
              </div>
            </div>

            {/* Optional tema */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">Asignar tema (opcional)</label>
              <TemaSelect
                temas={temas}
                value={temaId}
                onChange={setTemaId}
                onTemaCreated={(t) => setTemas((prev) => [...prev, t])}
              />
            </div>
          </div>

          {/* Word list */}
          <div className="card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-700 text-xs text-slate-400 uppercase tracking-wide">
              Vista previa · {preview.rows.length} palabras
            </div>
            <div className="divide-y divide-slate-700/50 max-h-80 overflow-y-auto">
              {preview.rows.map((row, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-3 px-4 py-2.5 ${
                    row.is_duplicate ? 'opacity-40' : ''
                  }`}
                >
                  <span className={`text-sm shrink-0 ${row.is_duplicate ? 'text-slate-500' : 'text-green-400'}`}>
                    {row.is_duplicate ? '⊘' : '✓'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{row.palabra}</span>
                    <span className="text-slate-500 mx-1.5">→</span>
                    <span className="text-slate-300">{row.significado}</span>
                  </div>
                  {row.is_duplicate && (
                    <span className="text-xs text-slate-600 shrink-0">duplicada</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div className="bg-red-500/20 border border-red-500/40 text-red-300 rounded-xl p-3 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={reset} className="btn-secondary flex-1">
              Cancelar
            </button>
            <button
              onClick={confirmImport}
              disabled={isLoading || preview.new_count === 0}
              className="btn-primary flex-1"
            >
              {isLoading
                ? 'Importando...'
                : preview.new_count === 0
                ? 'Sin palabras nuevas'
                : `Importar ${preview.new_count}`}
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Result ── */}
      {step === 'result' && result && (
        <div className="card text-center space-y-4 animate-slide-up py-8">
          <div className="text-6xl">{result.imported > 0 ? '🎉' : '👌'}</div>
          <h2 className="text-xl font-bold">Importación completada</h2>

          <div className="flex justify-center gap-8">
            <div>
              <div className="text-3xl font-bold text-green-400">{result.imported}</div>
              <div className="text-xs text-slate-400 mt-1">importadas</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-slate-500">{result.skipped}</div>
              <div className="text-xs text-slate-400 mt-1">omitidas</div>
            </div>
          </div>

          <p className="text-slate-400 text-sm">
            Las palabras nuevas están en la caja 0 y listas para repasar.
          </p>

          <div className="flex gap-3 pt-2">
            <button onClick={reset} className="btn-secondary flex-1">
              Importar más
            </button>
            <a href="/review" className="btn-primary flex-1 text-center">
              Ir a repasar
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
