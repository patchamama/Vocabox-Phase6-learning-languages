import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import api, { subtitlesApi } from '../api/client'
import VideoRefsModal from './VideoRefsModal'
import { useSettingsStore } from '../stores/settingsStore'
import type { SubtitleFile, WordVideoRef } from '../types'

interface ReindexState {
  status: 'running' | 'done' | 'error'
  progress: number
  total: number
  refs_created: number
  error?: string | null
}

interface UploadResults {
  successes: number
  totalFiles: number
  segments: number
  errors: string[]
}

export default function SubtitleManager() {
  const { t } = useTranslation()
  const { maxRefsPerWord, subtitleIndexPalabra, subtitleIndexAudioText, subtitleIndexSignificado } = useSettingsStore()

  // ── State ────────────────────────────────────────────────────────────────────
  const [files, setFiles] = useState<SubtitleFile[]>([])
  const [isLoadingFiles, setIsLoadingFiles] = useState(true)
  // file_id → ref count
  const [fileRefCounts, setFileRefCounts] = useState<Map<number, number>>(new Map())

  // Upload
  const [uploadFiles, setUploadFiles] = useState<File[]>([])
  const [youtubeId, setYoutubeId] = useState('')
  const [language, setLanguage] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadResults, setUploadResults] = useState<UploadResults | null>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)

  // Delete
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [deleteAllRefsConfirm, setDeleteAllRefsConfirm] = useState(false)
  const [isBusy, setIsBusy] = useState(false)

  // Reindex
  const [reindexState, setReindexState] = useState<ReindexState | null>(null)
  const [reindexPartial, setReindexPartial] = useState(false)
  const [reindexMinRefs, setReindexMinRefs] = useState(3)
  const wsRef = useRef<WebSocket | null>(null)

  // Search
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<WordVideoRef[] | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchModal, setSearchModal] = useState<{ query: string; refs: WordVideoRef[] } | null>(null)

  // ── Load ─────────────────────────────────────────────────────────────────────
  const loadFileCounts = useCallback(async () => {
    try {
      const r = await subtitlesApi.getFileRefCounts()
      setFileRefCounts(new Map(r.data.map((x) => [x.file_id, x.count])))
    } catch {
      // non-critical
    }
  }, [])

  const load = useCallback(() => {
    setIsLoadingFiles(true)
    Promise.all([subtitlesApi.list(), subtitlesApi.getFileRefCounts()])
      .then(([fRes, cRes]) => {
        setFiles(fRes.data)
        setFileRefCounts(new Map(cRes.data.map((x) => [x.file_id, x.count])))
      })
      .catch(() => {})
      .finally(() => setIsLoadingFiles(false))
  }, [])

  useEffect(() => {
    load()
    return () => { wsRef.current?.close() }
  }, [load])

  // ── File selection ────────────────────────────────────────────────────────────
  const handleFilesSelected = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    const valid = Array.from(fileList).filter((f) => {
      const ext = f.name.split('.').pop()?.toLowerCase()
      return ext === 'vtt' || ext === 'srt'
    })
    if (valid.length === 0) {
      setUploadError(t('import.subtitleOnlyFormats'))
      return
    }
    setUploadFiles(valid)
    setUploadError(valid.length < fileList.length ? t('import.subtitleOnlyFormats') : null)
    setUploadResults(null)
  }

  // ── Upload ────────────────────────────────────────────────────────────────────
  const handleUpload = async () => {
    if (uploadFiles.length === 0) return
    setIsUploading(true)
    setUploadError(null)
    setUploadResults(null)

    const results: UploadResults = { successes: 0, totalFiles: uploadFiles.length, segments: 0, errors: [] }

    for (let i = 0; i < uploadFiles.length; i++) {
      setUploadProgress({ current: i + 1, total: uploadFiles.length })
      const file = uploadFiles[i]
      try {
        const res = await subtitlesApi.upload(
          file,
          uploadFiles.length === 1 ? youtubeId.trim() || undefined : undefined,
          language.trim() || undefined,
        )
        results.successes++
        results.segments += res.data.total_segments
      } catch (err: unknown) {
        const msg =
          (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
          ?? file.name
        results.errors.push(msg)
      }
    }

    setUploadResults(results)
    setUploadFiles([])
    setYoutubeId('')
    setLanguage('')
    if (uploadInputRef.current) uploadInputRef.current.value = ''
    setUploadProgress(null)
    setIsUploading(false)
    load()
  }

  // ── Delete subtitle ───────────────────────────────────────────────────────────
  const handleDelete = async (id: number) => {
    setDeletingId(id)
    try {
      await subtitlesApi.delete(id)
      setDeleteConfirmId(null)
      load()
    } finally {
      setDeletingId(null)
    }
  }

  // ── Delete all refs ───────────────────────────────────────────────────────────
  const handleDeleteAllRefs = async () => {
    setIsBusy(true)
    try {
      await subtitlesApi.deleteAllRefs()
      setDeleteAllRefsConfirm(false)
      loadFileCounts()
    } finally {
      setIsBusy(false)
    }
  }

  // ── Reindex ───────────────────────────────────────────────────────────────────
  const handleReindex = async () => {
    wsRef.current?.close()
    setReindexState({ status: 'running', progress: 0, total: 0, refs_created: 0 })

    const res = await subtitlesApi.startReindex({
      minRefs: reindexPartial ? reindexMinRefs : 0,
      maxRefs: maxRefsPerWord,
      usePalabra: subtitleIndexPalabra,
      useAudioText: subtitleIndexAudioText,
      useSignificado: subtitleIndexSignificado,
    })
    const jobId = res.data.job_id
    const token = localStorage.getItem('token') ?? ''
    const baseUrl = ((api.defaults.baseURL as string) ?? '').replace(/\/$/, '')
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const wsUrl = `${proto}://${window.location.host}${baseUrl}/subtitles/ws/reindex/${jobId}?token=${encodeURIComponent(token)}`

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as ReindexState
        setReindexState(data)
        if (data.status === 'done' || data.status === 'error') {
          ws.close()
          if (data.status === 'done') loadFileCounts()
        }
      } catch {
        // ignore
      }
    }
    ws.onerror = () => {
      setReindexState((s) => s ? { ...s, status: 'error', error: 'WebSocket error' } : null)
    }
  }

  // ── Subtitle search ───────────────────────────────────────────────────────────
  const handleSearch = async () => {
    const q = searchQuery.trim()
    if (q.length < 2) return
    setIsSearching(true)
    setSearchError(null)
    setSearchResults(null)
    try {
      const res = await subtitlesApi.searchSegments(q)
      setSearchResults(subtitlesApi.segmentsToVideoRefs(res.data.results))
    } catch {
      setSearchError(t('import.subtitleSearchError'))
    } finally {
      setIsSearching(false)
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────
  const dropZoneLabel = () => {
    if (uploadFiles.length === 0) return t('import.dropZone')
    if (uploadFiles.length === 1) return uploadFiles[0].name
    return t('import.subtitleFilesSelected', { count: uploadFiles.length })
  }

  const dropZoneSub = () => {
    if (uploadFiles.length === 0) return t('import.subtitleAccepted')
    if (uploadFiles.length === 1) return `${(uploadFiles[0].size / 1024).toFixed(1)} KB · ${t('import.dropZoneChange')}`
    const totalKb = (uploadFiles.reduce((s, f) => s + f.size, 0) / 1024).toFixed(1)
    return `${totalKb} KB · ${t('import.dropZoneChange')}`
  }

  function fmtTime(ms: number) {
    const s = Math.floor(ms / 1000)
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* ── Upload section ── */}
      <div className="card space-y-3">
        <h3 className="font-medium text-slate-200">{t('import.subtitleUploadTitle')}</h3>
        <p className="text-xs text-slate-400">{t('import.subtitlesDesc')}</p>

        {/* Drop zone */}
        <div
          onClick={() => uploadInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFilesSelected(e.dataTransfer.files) }}
          className={`cursor-pointer border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
            isDragging ? 'border-blue-400 bg-blue-500/10' : 'border-slate-600 hover:border-slate-400'
          }`}
        >
          <div className="text-3xl mb-2">🎬</div>
          <p className="text-slate-300 text-sm font-medium">{dropZoneLabel()}</p>
          <p className="text-slate-500 text-xs mt-0.5">{dropZoneSub()}</p>
          <input
            ref={uploadInputRef}
            type="file"
            accept=".vtt,.srt"
            multiple
            className="hidden"
            onChange={(e) => handleFilesSelected(e.target.files)}
          />
        </div>

        {/* YouTube ID — only when single file */}
        {uploadFiles.length <= 1 && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-slate-400 block mb-1">{t('import.subtitleYoutubeId')}</label>
              <input
                type="text"
                value={youtubeId}
                onChange={(e) => setYoutubeId(e.target.value)}
                placeholder={t('import.subtitleYoutubeIdPlaceholder')}
                className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              />
              <p className="text-xs text-slate-500 mt-0.5">{t('import.subtitleYoutubeIdHint')}</p>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">{t('import.subtitleLanguage')}</label>
              <input
                type="text"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                placeholder="de, es, en…"
                className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              />
            </div>
          </div>
        )}

        {/* Language only — when multiple files */}
        {uploadFiles.length > 1 && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-slate-400 block mb-1">{t('import.subtitleLanguage')}</label>
              <input
                type="text"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                placeholder="de, es, en…"
                className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              />
            </div>
            <div className="flex items-end pb-1">
              <p className="text-xs text-slate-500">{t('import.subtitleYoutubeIdHint')}</p>
            </div>
          </div>
        )}

        {/* Upload progress bar */}
        {uploadProgress && (
          <div className="space-y-1">
            <div className="w-full bg-slate-700 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all"
                style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
              />
            </div>
            <p className="text-xs text-slate-400">
              {t('import.subtitleUploadingProgress', { current: uploadProgress.current, total: uploadProgress.total })}
            </p>
          </div>
        )}

        {uploadError && (
          <p className="text-red-400 text-xs">{uploadError}</p>
        )}

        {/* Upload results */}
        {uploadResults && (
          <div className="space-y-0.5">
            <p className="text-green-400 text-xs">
              {uploadResults.totalFiles === 1
                ? t('import.subtitleSuccess', { count: uploadResults.segments })
                : t('import.subtitleMultipleDone', {
                    successes: uploadResults.successes,
                    total: uploadResults.totalFiles,
                    segments: uploadResults.segments,
                  })}
            </p>
            {uploadResults.errors.map((e, i) => (
              <p key={i} className="text-red-400 text-xs">{e}</p>
            ))}
          </div>
        )}

        <button
          onClick={handleUpload}
          disabled={uploadFiles.length === 0 || isUploading}
          className="btn-primary w-full"
        >
          {isUploading
            ? t('import.subtitleUploading')
            : uploadFiles.length > 1
              ? t('import.subtitleUploadN', { count: uploadFiles.length })
              : t('import.subtitleUpload')}
        </button>
      </div>

      {/* ── Search section ── */}
      <div className="card space-y-3">
        <h3 className="font-medium text-slate-200">{t('import.subtitleSearch')}</h3>
        <p className="text-xs text-slate-400">{t('import.subtitleSearchDesc')}</p>

        <div className="flex gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
            placeholder={t('import.subtitleSearchPlaceholder')}
            className="flex-1 bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
          />
          <button
            onClick={handleSearch}
            disabled={isSearching || searchQuery.trim().length < 2}
            className="btn-secondary text-sm px-4 disabled:opacity-40"
          >
            {isSearching
              ? <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : '🔍'}
          </button>
        </div>

        {searchError && <p className="text-red-400 text-xs">{searchError}</p>}

        {searchResults !== null && (
          <div className="space-y-1">
            {searchResults.length === 0 ? (
              <p className="text-slate-500 text-xs">{t('import.subtitleSearchEmpty')}</p>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-400">
                    {t('import.subtitleSearchResults', { n: searchResults.length })}
                  </p>
                  <button
                    onClick={() => setSearchModal({ query: searchQuery.trim(), refs: searchResults })}
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    {t('import.subtitleSearchOpenAll')} ▶
                  </button>
                </div>

                <div className="divide-y divide-slate-700/50 border border-slate-700 rounded-xl overflow-hidden max-h-64 overflow-y-auto">
                  {searchResults.map((ref) => (
                    <button
                      key={ref.id}
                      onClick={() => setSearchModal({ query: searchQuery.trim(), refs: [ref] })}
                      className="w-full text-left px-3 py-2 hover:bg-slate-700/50 transition-colors"
                    >
                      <p className="text-xs text-slate-200 line-clamp-2">{ref.segment.text}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {ref.segment.file.filename} · {fmtTime(ref.segment.start_ms)}–{fmtTime(ref.segment.end_ms)}
                      </p>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Reindex section ── */}
      <div className="card space-y-2">
        <h3 className="font-medium text-slate-200">{t('import.subtitleReindex')}</h3>
        <p className="text-xs text-slate-400">{t('import.subtitleReindexDesc')}</p>

        {/* Partial reindex toggle */}
        <div className="space-y-2 pt-1">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setReindexPartial(false)}
              className={`text-xs px-3 py-1 rounded-lg border transition-colors ${
                !reindexPartial
                  ? 'border-blue-500 bg-blue-500/20 text-blue-300'
                  : 'border-slate-600 text-slate-500 hover:border-slate-400 hover:text-slate-300'
              }`}
            >
              {t('import.subtitleReindexFull')}
            </button>
            <button
              onClick={() => setReindexPartial(true)}
              className={`text-xs px-3 py-1 rounded-lg border transition-colors ${
                reindexPartial
                  ? 'border-blue-500 bg-blue-500/20 text-blue-300'
                  : 'border-slate-600 text-slate-500 hover:border-slate-400 hover:text-slate-300'
              }`}
            >
              {t('import.subtitleReindexPartial')}
            </button>
          </div>

          {reindexPartial && (
            <div className="flex items-center gap-2 pl-1">
              <p className="text-xs text-slate-400 shrink-0">{t('import.subtitleReindexMinRefs')}</p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setReindexMinRefs((n) => Math.max(1, n - 1))}
                  className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm"
                >−</button>
                <span className="w-8 text-center text-sm text-slate-200">{reindexMinRefs}</span>
                <button
                  onClick={() => setReindexMinRefs((n) => Math.min(50, n + 1))}
                  className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm"
                >+</button>
              </div>
              <p className="text-xs text-slate-500">{t('import.subtitleReindexMinRefsHint', { n: reindexMinRefs })}</p>
            </div>
          )}
        </div>

        {reindexState && (
          <div className="space-y-1">
            {reindexState.status === 'running' && (
              <>
                <div className="w-full bg-slate-700 rounded-full h-2">
                  <div
                    className="bg-blue-500 h-2 rounded-full transition-all"
                    style={{ width: reindexState.total > 0 ? `${(reindexState.progress / reindexState.total) * 100}%` : '0%' }}
                  />
                </div>
                <p className="text-xs text-slate-400">
                  {t('import.subtitleReindexing', { done: reindexState.progress, total: reindexState.total })}
                </p>
              </>
            )}
            {reindexState.status === 'done' && (
              <p className="text-xs text-green-400">
                {t('import.subtitleReindexDone', { refs: reindexState.refs_created, total: reindexState.total })}
              </p>
            )}
            {reindexState.status === 'error' && (
              <p className="text-xs text-red-400">{reindexState.error ?? 'Error'}</p>
            )}
          </div>
        )}

        <button
          onClick={handleReindex}
          disabled={reindexState?.status === 'running' || files.length === 0}
          className="btn-secondary w-full text-sm disabled:opacity-40"
        >
          {reindexState?.status === 'running'
            ? '⟳ ' + t('import.subtitleReindexing', { done: reindexState.progress, total: reindexState.total })
            : '⟳ ' + (reindexPartial ? t('import.subtitleReindexPartialBtn') : t('import.subtitleReindex'))}
        </button>

        {/* Delete all refs */}
        {!deleteAllRefsConfirm ? (
          <button
            onClick={() => setDeleteAllRefsConfirm(true)}
            className="w-full text-xs text-slate-500 hover:text-red-400 transition-colors py-1"
          >
            {t('import.subtitleDeleteAllRefs')}
          </button>
        ) : (
          <div className="flex gap-2">
            <button onClick={() => setDeleteAllRefsConfirm(false)} className="btn-secondary flex-1 text-sm">
              {t('words.bulkCancel')}
            </button>
            <button
              onClick={handleDeleteAllRefs}
              disabled={isBusy}
              className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-xl px-3 py-2 text-sm font-medium transition-colors"
            >
              {t('import.subtitleDeleteAllRefs')}
            </button>
          </div>
        )}
      </div>

      {/* ── Subtitle file list ── */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700 text-xs text-slate-400 uppercase tracking-wide">
          {t('import.subtitleList')} · {files.length}
        </div>

        {isLoadingFiles ? (
          <div className="px-4 py-4 text-slate-500 text-sm">{t('common.loading')}</div>
        ) : files.length === 0 ? (
          <div className="px-4 py-4 text-slate-500 text-sm">{t('import.subtitleNoFiles')}</div>
        ) : (
          <div className="divide-y divide-slate-700/50">
            {files.map((f) => {
              const refCount = fileRefCounts.get(f.id)
              return (
                <div key={f.id} className="px-4 py-3">
                  {deleteConfirmId === f.id ? (
                    <div className="space-y-2">
                      <p className="text-xs text-slate-300">{t('import.subtitleDeleteConfirm')}</p>
                      <div className="flex gap-2">
                        <button onClick={() => setDeleteConfirmId(null)} className="btn-secondary flex-1 text-xs py-1.5">
                          {t('words.bulkCancel')}
                        </button>
                        <button
                          onClick={() => handleDelete(f.id)}
                          disabled={deletingId === f.id}
                          className="flex-1 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-xl px-3 py-1.5 text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
                        >
                          {deletingId === f.id ? (
                            <>
                              <span className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                              <span>{t('common.loading')}</span>
                            </>
                          ) : t('import.subtitleDelete')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm text-slate-200 truncate" title={f.filename}>{f.filename}</p>
                          {refCount !== undefined && refCount > 0 && (
                            <span className="text-xs font-medium bg-purple-600/30 text-purple-300 border border-purple-500/40 px-1.5 py-0.5 rounded-full shrink-0">
                              {refCount} refs
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-0.5">
                          {f.youtube_id ? (
                            <a
                              href={`https://www.youtube.com/watch?v=${f.youtube_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-xs text-blue-400 font-mono hover:text-blue-300 hover:underline transition-colors"
                              title={`YouTube: ${f.youtube_id}`}
                            >
                              ▶ {f.youtube_id}
                            </a>
                          ) : (
                            <span className="text-xs text-slate-600">{t('import.subtitleNoId')}</span>
                          )}
                          <span className="text-xs text-slate-500">
                            {t('import.subtitleSegments', { count: f.total_segments })}
                          </span>
                          {f.language && (
                            <span className="text-xs bg-slate-700 px-1.5 py-0.5 rounded-full">{f.language}</span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => setDeleteConfirmId(f.id)}
                        className="text-slate-500 hover:text-red-400 transition-colors text-sm shrink-0"
                        title={t('import.subtitleDelete')}
                      >
                        🗑
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Search result viewer modal ── */}
      {searchModal && (
        <VideoRefsModal
          wordId={0}
          palabra={searchModal.query}
          significado=""
          overrideRefs={searchModal.refs}
          onClose={() => setSearchModal(null)}
        />
      )}
    </div>
  )
}
