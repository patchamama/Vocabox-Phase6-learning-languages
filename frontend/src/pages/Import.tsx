import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { importApi, temasApi } from '../api/client'
import TemaSelect from '../components/TemaSelect'
import type { ImportPreview, ImportResult, Tema } from '../types'

type Step = 'upload' | 'preview' | 'result'
type Tab = 'files' | 'pdf'

const ACCEPTED_FILES = '.csv,.xlsx'
const ACCEPTED_PDF = '.pdf'

// LEO language pairs available for PDF import
const LEO_PAIRS = [
  { lp: 'esde', src: 'de', tgt: 'es', label: 'Alemán → Español' },
  { lp: 'ende', src: 'de', tgt: 'en', label: 'Alemán → Inglés' },
  { lp: 'frde', src: 'de', tgt: 'fr', label: 'Alemán → Francés' },
  { lp: 'itde', src: 'de', tgt: 'it', label: 'Alemán → Italiano' },
  { lp: 'ptde', src: 'de', tgt: 'pt', label: 'Alemán → Portugués' },
]

export default function Import() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<Tab>('files')
  const [step, setStep] = useState<Step>('upload')
  const [isDragging, setIsDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [temaId, setTemaId] = useState<string>('')
  const [temas, setTemas] = useState<Tema[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pdfPair, setPdfPair] = useState(LEO_PAIRS[0])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    temasApi.list().then((r) => setTemas(r.data)).catch(() => {})
  }, [])

  // ── File selection ──────────────────────────────────────────────────────────

  const handleFile = (f: File) => {
    const name = f.name.toLowerCase()
    if (tab === 'files') {
      if (!name.endsWith('.csv') && !name.endsWith('.xlsx')) {
        setError(t('import.onlyFormats'))
        return
      }
    } else {
      if (!name.endsWith('.pdf')) {
        setError(t('import.onlyPdf'))
        return
      }
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
      const { data } = tab === 'pdf'
        ? await importApi.pdfPreview(file, pdfPair.src, pdfPair.tgt)
        : await importApi.preview(file)
      setPreview(data)
      setStep('preview')
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? t('import.errorAnalyze')
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
      setError(t('import.errorImport'))
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

  const switchTab = (t: Tab) => {
    setTab(t)
    setFile(null)
    setError(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 pt-8 space-y-5 animate-slide-up">
      <h1 className="text-2xl font-bold">{t('import.title')}</h1>

      {/* ── STEP 1: Upload ── */}
      {step === 'upload' && (
        <div className="space-y-4">
          {/* Tab selector */}
          <div className="flex rounded-xl overflow-hidden border border-slate-700 text-sm">
            <button
              type="button"
              onClick={() => switchTab('files')}
              className={`flex-1 py-2 font-medium transition-colors ${
                tab === 'files'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {t('import.tabFiles')}
            </button>
            <button
              type="button"
              onClick={() => switchTab('pdf')}
              className={`flex-1 py-2 font-medium transition-colors ${
                tab === 'pdf'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {t('import.tabPdf')}
            </button>
          </div>

          <p className="text-slate-400 text-sm">
            {tab === 'pdf' ? t('import.pdfDescription') : t('import.description')}
          </p>

          {/* PDF lang pair selector */}
          {tab === 'pdf' && (
            <div>
              <label className="text-xs text-slate-400 block mb-1">{t('import.pdfLangPair')}</label>
              <select
                className="input text-sm w-full"
                value={pdfPair.lp}
                onChange={(e) => setPdfPair(LEO_PAIRS.find((p) => p.lp === e.target.value)!)}
              >
                {LEO_PAIRS.map((p) => (
                  <option key={p.lp} value={p.lp}>{p.label}</option>
                ))}
              </select>
            </div>
          )}

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
            <div className="text-4xl mb-3">{tab === 'pdf' ? '📄' : '📥'}</div>
            <p className="text-slate-300 font-medium">
              {file ? file.name : t('import.dropZone')}
            </p>
            <p className="text-slate-500 text-sm mt-1">
              {file
                ? `${(file.size / 1024).toFixed(1)} KB · ${t('import.dropZoneChange')}`
                : tab === 'pdf'
                  ? t('import.dropZoneOrPdf')
                  : t('import.dropZoneOr')}
            </p>
            <input
              ref={inputRef}
              type="file"
              accept={tab === 'pdf' ? ACCEPTED_PDF : ACCEPTED_FILES}
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
            {isLoading ? t('import.analyzing') : t('import.analyze')}
          </button>
        </div>
      )}

      {/* ── STEP 2: Preview ── */}
      {step === 'preview' && preview && (
        <div className="space-y-4">
          {/* Summary card */}
          <div className="card space-y-3">
            <div className="flex items-center gap-2 text-slate-300 font-medium">
              <span className="text-lg">{tab === 'pdf' ? '📄' : '📂'}</span>
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
                <div className="text-xs text-slate-400">{t('import.found')}</div>
              </div>
              <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-2">
                <div className="text-xl font-bold text-green-400">{preview.new_count}</div>
                <div className="text-xs text-slate-400">{t('import.new')}</div>
              </div>
              <div className="bg-slate-700/30 rounded-xl p-2">
                <div className="text-xl font-bold text-slate-500">{preview.duplicate_count}</div>
                <div className="text-xs text-slate-400">{t('import.duplicates')}</div>
              </div>
            </div>

            {/* Optional tema */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">{t('import.assignTheme')}</label>
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
              {t('import.preview')} · {preview.rows.length} {t('import.words')}
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
                  {row.box_level != null && !row.is_duplicate && (
                    <span className="text-xs bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded-full shrink-0">
                      {t('box.prefix')}{row.box_level}
                    </span>
                  )}
                  {row.is_duplicate && (
                    <span className="text-xs text-slate-600 shrink-0">{t('import.duplicate')}</span>
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
              {t('import.cancel')}
            </button>
            <button
              onClick={confirmImport}
              disabled={isLoading || preview.new_count === 0}
              className="btn-primary flex-1"
            >
              {isLoading
                ? t('import.importing')
                : preview.new_count === 0
                ? t('import.noNewWords')
                : t('import.import', { count: preview.new_count })}
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Result ── */}
      {step === 'result' && result && (
        <div className="card text-center space-y-4 animate-slide-up py-8">
          <div className="text-6xl">{result.imported > 0 ? '🎉' : '👌'}</div>
          <h2 className="text-xl font-bold">{t('import.successTitle')}</h2>

          <div className="flex justify-center gap-8">
            <div>
              <div className="text-3xl font-bold text-green-400">{result.imported}</div>
              <div className="text-xs text-slate-400 mt-1">{t('import.imported')}</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-slate-500">{result.skipped}</div>
              <div className="text-xs text-slate-400 mt-1">{t('import.skipped')}</div>
            </div>
          </div>

          <p className="text-slate-400 text-sm">{t('import.importedNote')}</p>

          <div className="flex gap-3 pt-2">
            <button onClick={reset} className="btn-secondary flex-1">
              {t('import.importMore')}
            </button>
            <a href="/review" className="btn-primary flex-1 text-center">
              {t('import.goReview')}
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
