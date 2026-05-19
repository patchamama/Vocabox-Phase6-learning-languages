import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import api, { subtitlesApi, temasApi } from '../api/client'
import type { YouTubeImportResult } from '../api/client'
import VideoRefsModal from './VideoRefsModal'
import { useSettingsStore } from '../stores/settingsStore'
import type { SubtitleFile, SubtitlePlaylist, Tema, WordVideoRef } from '../types'

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

interface PlaylistDraft {
  title: string
  language: string
  fallback: string
  maxVideos: number
  stars: number
  temaIds: number[]
}

export default function SubtitleManager() {
  const { t } = useTranslation()
  const { maxRefsPerWord, subtitleIndexPalabra, subtitleIndexAudioText, subtitleIndexSignificado } = useSettingsStore()

  // ── State ────────────────────────────────────────────────────────────────────
  const [files, setFiles] = useState<SubtitleFile[]>([])
  const [temas, setTemas] = useState<Tema[]>([])
  const [isLoadingFiles, setIsLoadingFiles] = useState(true)
  // file_id → ref count
  const [fileRefCounts, setFileRefCounts] = useState<Map<number, number>>(new Map())
  const [selectedFileIds, setSelectedFileIds] = useState<Set<number>>(new Set())
  const [bulkLanguageEnabled, setBulkLanguageEnabled] = useState(false)
  const [bulkLanguage, setBulkLanguage] = useState('')
  const [bulkStars, setBulkStars] = useState('')
  const [bulkTemasEnabled, setBulkTemasEnabled] = useState(false)
  const [bulkTemaIds, setBulkTemaIds] = useState<number[]>([])
  const [isBulkSaving, setIsBulkSaving] = useState(false)
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)

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
  const wsRef      = useRef<WebSocket | null>(null)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // YouTube import
  const [ytSources, setYtSources] = useState('')
  const [ytLanguage, setYtLanguage] = useState('de')
  const [ytFallback, setYtFallback] = useState('en')
  const [ytMaxVideos, setYtMaxVideos] = useState(20)
  const [ytStars, setYtStars] = useState(0)
  const [ytTemaIds, setYtTemaIds] = useState<number[]>([])
  const [ytCreateInternalPlaylist, setYtCreateInternalPlaylist] = useState(false)
  const [ytInternalPlaylistTitle, setYtInternalPlaylistTitle] = useState('')
  const [ytJobId, setYtJobId] = useState<string | null>(null)
  const [ytStatus, setYtStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [ytProgress, setYtProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 })
  const [ytResult, setYtResult] = useState<YouTubeImportResult | null>(null)
  const [ytError, setYtError] = useState<string | null>(null)
  const ytPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Search
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<WordVideoRef[] | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searchModal, setSearchModal] = useState<{ query: string; refs: WordVideoRef[] } | null>(null)

  // Registered playlists
  const [playlists, setPlaylists] = useState<SubtitlePlaylist[]>([])
  const [playlistDrafts, setPlaylistDrafts] = useState<Record<number, PlaylistDraft>>({})
  const [isLoadingPlaylists, setIsLoadingPlaylists] = useState(true)
  const [savingPlaylistId, setSavingPlaylistId] = useState<number | null>(null)
  const [refreshingPlaylistId, setRefreshingPlaylistId] = useState<number | null>(null)
  const [playlistDeletingId, setPlaylistDeletingId] = useState<number | null>(null)
  const [playlistError, setPlaylistError] = useState<string | null>(null)
  const [playlistRefreshProgress, setPlaylistRefreshProgress] = useState<{ current: number; total: number } | null>(null)
  const playlistPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // List filters
  const [filterName, setFilterName] = useState('')
  const [filterLanguage, setFilterLanguage] = useState('')
  const [filterTemaId, setFilterTemaId] = useState('')
  const [filterStars, setFilterStars] = useState('')
  const [filterPlaylistId, setFilterPlaylistId] = useState('')

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
        setSelectedFileIds((prev) => new Set([...prev].filter((id) => fRes.data.some((f) => f.id === id))))
      })
      .catch(() => {})
      .finally(() => setIsLoadingFiles(false))
  }, [])

  const loadPlaylists = useCallback(() => {
    setIsLoadingPlaylists(true)
    subtitlesApi.listPlaylists()
      .then((res) => {
        setPlaylists(res.data)
        setPlaylistDrafts(Object.fromEntries(res.data.map((pl) => [
          pl.id,
          {
            title: pl.title ?? '',
            language: pl.language ?? '',
            fallback: pl.fallback_languages ?? '',
            maxVideos: pl.max_videos,
            stars: pl.stars,
            temaIds: pl.temas.map((tm) => tm.id),
          },
        ])))
      })
      .catch(() => {})
      .finally(() => setIsLoadingPlaylists(false))
  }, [])

  useEffect(() => {
    load()
    loadPlaylists()
    temasApi.list().then((res) => setTemas(res.data)).catch(() => {})
    return () => {
      wsRef.current?.close()
      if (pollingRef.current) clearInterval(pollingRef.current)
      if (ytPollRef.current) clearInterval(ytPollRef.current)
      if (playlistPollRef.current) clearInterval(playlistPollRef.current)
    }
  }, [load, loadPlaylists])

  // ── YouTube import ───────────────────────────────────────────────────────────
  const handleYoutubeImport = async () => {
    const sources = ytSources
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    if (sources.length === 0) return
    const fallback_languages = ytFallback
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    setYtStatus('running')
    setYtProgress({ current: 0, total: 0 })
    setYtResult(null)
    setYtError(null)
    try {
      const res = await subtitlesApi.youtubeImport({
        sources,
        language: ytLanguage.trim() || 'de',
        fallback_languages,
        max_videos: Math.max(1, Math.min(9999, ytMaxVideos)),
        stars: ytStars,
        tema_ids: ytTemaIds,
        create_internal_playlist: ytCreateInternalPlaylist,
        internal_playlist_title: ytInternalPlaylistTitle.trim() || undefined,
      })
      const jobId = res.data.job_id
      setYtJobId(jobId)
      ytPollRef.current = setInterval(async () => {
        try {
          const j = await subtitlesApi.getYoutubeJob(jobId)
          setYtProgress({ current: j.data.progress, total: j.data.total })
          if (j.data.status === 'done') {
            setYtResult(j.data.result)
            setYtStatus('done')
            if (ytPollRef.current) clearInterval(ytPollRef.current)
            ytPollRef.current = null
            load()
            loadPlaylists()
          } else if (j.data.status === 'error') {
            setYtError(j.data.error || 'Error')
            setYtStatus('error')
            if (ytPollRef.current) clearInterval(ytPollRef.current)
            ytPollRef.current = null
          }
        } catch {
          setYtError(t('import.ytError'))
          setYtStatus('error')
          if (ytPollRef.current) clearInterval(ytPollRef.current)
          ytPollRef.current = null
        }
      }, 1000)
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        ?? t('import.ytError')
      setYtError(msg)
      setYtStatus('error')
    }
  }

  const handleYoutubeReset = () => {
    if (ytJobId) {
      subtitlesApi.deleteYoutubeJob(ytJobId).catch(() => {})
    }
    if (ytPollRef.current) clearInterval(ytPollRef.current)
    ytPollRef.current = null
    setYtJobId(null)
    setYtStatus('idle')
    setYtProgress({ current: 0, total: 0 })
    setYtResult(null)
    setYtError(null)
  }

  // ── Bulk subtitle metadata ───────────────────────────────────────────────────
  const toggleFileSelection = (id: number) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleTemaId = (ids: number[], id: number) => (
    ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
  )

  const selectedIds = [...selectedFileIds]
  const filteredFiles = files.filter((f) => {
    const name = filterName.trim().toLowerCase()
    if (name && !f.filename.toLowerCase().includes(name)) return false
    const lang = filterLanguage.trim().toLowerCase()
    if (lang && (f.language ?? '').toLowerCase() !== lang) return false
    if (filterTemaId && !f.temas.some((tm) => String(tm.id) === filterTemaId)) return false
    if (filterStars !== '' && f.stars !== Number(filterStars)) return false
    if (filterPlaylistId && !f.playlists.some((pl) => String(pl.id) === filterPlaylistId)) return false
    return true
  })
  const allVisibleSelected = filteredFiles.length > 0 && filteredFiles.every((f) => selectedFileIds.has(f.id))
  const hasBulkChanges = bulkLanguageEnabled || bulkStars !== '' || bulkTemasEnabled

  const handleBulkUpdate = async () => {
    if (selectedIds.length === 0 || !hasBulkChanges) return
    setIsBulkSaving(true)
    setBulkError(null)
    try {
      const payload: { file_ids: number[]; language?: string | null; stars?: number; tema_ids?: number[] } = {
        file_ids: selectedIds,
      }
      if (bulkLanguageEnabled) payload.language = bulkLanguage.trim() || null
      if (bulkStars !== '') payload.stars = parseInt(bulkStars)
      if (bulkTemasEnabled) payload.tema_ids = bulkTemaIds
      const res = await subtitlesApi.bulkUpdate(payload)
      setFiles((prev) => prev.map((f) => res.data.find((updated) => updated.id === f.id) ?? f))
    } catch (err: unknown) {
      setBulkError((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? t('import.subtitleBulkError'))
    } finally {
      setIsBulkSaving(false)
    }
  }

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return
    setIsBulkDeleting(true)
    setBulkError(null)
    try {
      await subtitlesApi.bulkDelete(selectedIds)
      setFiles((prev) => prev.filter((f) => !selectedFileIds.has(f.id)))
      setSelectedFileIds(new Set())
      setBulkDeleteConfirm(false)
      loadFileCounts()
    } catch (err: unknown) {
      setBulkError((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? t('import.subtitleBulkError'))
    } finally {
      setIsBulkDeleting(false)
    }
  }

  const updatePlaylistDraft = (id: number, patch: Partial<PlaylistDraft>) => {
    setPlaylistDrafts((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...patch },
    }))
  }

  const handleSavePlaylist = async (playlist: SubtitlePlaylist) => {
    const draft = playlistDrafts[playlist.id]
    if (!draft) return
    setSavingPlaylistId(playlist.id)
    setPlaylistError(null)
    try {
      const res = await subtitlesApi.updatePlaylist(playlist.id, {
        title: draft.title.trim() || null,
        language: draft.language.trim() || null,
        fallback_languages: draft.fallback.split(',').map((s) => s.trim()).filter(Boolean),
        max_videos: Math.max(1, Math.min(9999, draft.maxVideos || 1)),
        stars: draft.stars,
        tema_ids: draft.temaIds,
      })
      setPlaylists((prev) => prev.map((pl) => pl.id === playlist.id ? res.data : pl))
    } catch (err: unknown) {
      setPlaylistError((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? t('import.playlistSaveError'))
    } finally {
      setSavingPlaylistId(null)
    }
  }

  const handleRefreshPlaylist = async (playlist: SubtitlePlaylist) => {
    if (playlistPollRef.current) clearInterval(playlistPollRef.current)
    setRefreshingPlaylistId(playlist.id)
    setPlaylistRefreshProgress({ current: 0, total: 0 })
    setPlaylistError(null)
    try {
      const draft = playlistDrafts[playlist.id]
      if (draft) {
        const saved = await subtitlesApi.updatePlaylist(playlist.id, {
          title: draft.title.trim() || null,
          language: draft.language.trim() || null,
          fallback_languages: draft.fallback.split(',').map((s) => s.trim()).filter(Boolean),
          max_videos: Math.max(1, Math.min(9999, draft.maxVideos || 1)),
          stars: draft.stars,
          tema_ids: draft.temaIds,
        })
        setPlaylists((prev) => prev.map((pl) => pl.id === playlist.id ? saved.data : pl))
      }
      const res = await subtitlesApi.refreshPlaylist(playlist.id)
      const jobId = res.data.job_id
      playlistPollRef.current = setInterval(async () => {
        try {
          const j = await subtitlesApi.getYoutubeJob(jobId)
          setPlaylistRefreshProgress({ current: j.data.progress, total: j.data.total })
          if (j.data.status === 'done') {
            if (playlistPollRef.current) clearInterval(playlistPollRef.current)
            playlistPollRef.current = null
            setRefreshingPlaylistId(null)
            setPlaylistRefreshProgress(null)
            load()
            loadPlaylists()
          } else if (j.data.status === 'error') {
            throw new Error(j.data.error || t('import.playlistRefreshError'))
          }
        } catch (err: unknown) {
          if (playlistPollRef.current) clearInterval(playlistPollRef.current)
          playlistPollRef.current = null
          setRefreshingPlaylistId(null)
          setPlaylistError(err instanceof Error ? err.message : t('import.playlistRefreshError'))
        }
      }, 1000)
    } catch (err: unknown) {
      setRefreshingPlaylistId(null)
      setPlaylistRefreshProgress(null)
      setPlaylistError((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? t('import.playlistRefreshError'))
    }
  }

  const handleDeletePlaylist = async (playlist: SubtitlePlaylist) => {
    setPlaylistDeletingId(playlist.id)
    setPlaylistError(null)
    try {
      await subtitlesApi.deletePlaylist(playlist.id)
      setPlaylists((prev) => prev.filter((pl) => pl.id !== playlist.id))
      setPlaylistDrafts((prev) => {
        const next = { ...prev }
        delete next[playlist.id]
        return next
      })
    } catch (err: unknown) {
      setPlaylistError((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? t('import.playlistDeleteError'))
    } finally {
      setPlaylistDeletingId(null)
    }
  }

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
      // WS unavailable — fall back to HTTP polling
      if (pollingRef.current) return
      pollingRef.current = setInterval(async () => {
        try {
          const res = await subtitlesApi.getJob(jobId)
          const data = res.data
          setReindexState(data as ReindexState)
          if (data.status === 'done' || data.status === 'error') {
            clearInterval(pollingRef.current!)
            pollingRef.current = null
            if (data.status === 'done') loadFileCounts()
          }
        } catch {
          clearInterval(pollingRef.current!)
          pollingRef.current = null
          setReindexState((s) => s ? { ...s, status: 'error', error: 'Job not found' } : null)
        }
      }, 2000)
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

      {/* ── YouTube import section ── */}
      <div className="card space-y-3">
        <h3 className="font-medium text-slate-200">{t('import.ytImportTitle')}</h3>
        <p className="text-xs text-slate-400">{t('import.ytImportDesc')}</p>

        <div>
          <label className="text-xs text-slate-400 block mb-1">{t('import.ytSources')}</label>
          <textarea
            value={ytSources}
            onChange={(e) => setYtSources(e.target.value)}
            placeholder={t('import.ytSourcesPlaceholder')}
            rows={5}
            disabled={ytStatus === 'running'}
            className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm font-mono placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-50"
          />
          <p className="text-xs text-slate-500 mt-0.5">{t('import.ytSourcesHint')}</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-slate-400 block mb-1">{t('import.ytLanguage')}</label>
            <input
              type="text"
              value={ytLanguage}
              onChange={(e) => setYtLanguage(e.target.value)}
              placeholder="de"
              disabled={ytStatus === 'running'}
              className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-50"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">{t('import.ytFallback')}</label>
            <input
              type="text"
              value={ytFallback}
              onChange={(e) => setYtFallback(e.target.value)}
              placeholder="en, es"
              disabled={ytStatus === 'running'}
              className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-50"
            />
          </div>
        </div>

        {temas.length > 0 && (
          <div>
            <label className="text-xs text-slate-400 block mb-1">{t('import.subtitleThemes')}</label>
            <div className="flex flex-wrap gap-1.5">
              {temas.map((tm) => {
                const active = ytTemaIds.includes(tm.id)
                return (
                  <button
                    key={tm.id}
                    type="button"
                    onClick={() => setYtTemaIds((ids) => toggleTemaId(ids, tm.id))}
                    disabled={ytStatus === 'running'}
                    className={`text-xs px-2 py-1 rounded-lg border transition-colors disabled:opacity-50 ${
                      active
                        ? 'border-blue-500 bg-blue-500/20 text-blue-200'
                        : 'border-slate-600 text-slate-400 hover:border-slate-400'
                    }`}
                  >
                    <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: tm.color }} />
                    {tm.nombre}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-slate-400 block mb-1">{t('import.ytMaxVideos')}</label>
            <input
              type="number"
              min={1}
              max={9999}
              value={ytMaxVideos}
              onChange={(e) => setYtMaxVideos(parseInt(e.target.value) || 20)}
              disabled={ytStatus === 'running'}
              className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-50"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">{t('import.ytStars')}</label>
            <select
              value={ytStars}
              onChange={(e) => setYtStars(parseInt(e.target.value))}
              disabled={ytStatus === 'running'}
              className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-50"
            >
              <option value={0}>0 ★</option>
              <option value={1}>1 ★</option>
              <option value={2}>2 ★</option>
              <option value={3}>3 ★</option>
            </select>
          </div>
        </div>

        <div className="space-y-2 rounded-xl border border-slate-700 bg-slate-800/40 p-3">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={ytCreateInternalPlaylist}
              onChange={(e) => setYtCreateInternalPlaylist(e.target.checked)}
              disabled={ytStatus === 'running'}
              className="mt-0.5 rounded border-slate-600 bg-slate-800"
            />
            <span>
              <span className="block text-sm text-slate-200">{t('import.ytCreateInternalPlaylist', 'Crear playlist interna con esta importación')}</span>
              <span className="block text-xs text-slate-500">{t('import.ytCreateInternalPlaylistDesc', 'Incluye los videos individuales y los videos encontrados dentro de las playlists especificadas.')}</span>
            </span>
          </label>
          {ytCreateInternalPlaylist && (
            <input
              type="text"
              value={ytInternalPlaylistTitle}
              onChange={(e) => setYtInternalPlaylistTitle(e.target.value)}
              placeholder={t('import.ytInternalPlaylistTitle', 'Nombre de la playlist interna')}
              disabled={ytStatus === 'running'}
              className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-50"
            />
          )}
        </div>

        {ytStatus === 'running' && (
          <div className="space-y-1">
            <div className="w-full bg-slate-700 rounded-full h-2">
              <div
                className="bg-red-500 h-2 rounded-full transition-all"
                style={{
                  width: ytProgress.total > 0
                    ? `${(ytProgress.current / ytProgress.total) * 100}%`
                    : '5%',
                }}
              />
            </div>
            <p className="text-xs text-slate-400">
              {ytProgress.total > 0
                ? t('import.ytProgress', { current: ytProgress.current, total: ytProgress.total })
                : t('import.ytExpandingSources')}
            </p>
          </div>
        )}

        {ytError && <p className="text-red-400 text-xs">{ytError}</p>}

        {ytResult && (
          <div className="space-y-1 max-h-64 overflow-y-auto bg-slate-800/50 rounded-xl p-2">
            <p className="text-xs text-slate-300 font-medium">
              {t('import.ytResultSummary', {
                created: ytResult.created,
                skipped: ytResult.skipped,
                errors: ytResult.errors,
              })}
            </p>
            {ytResult.items.map((it, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span
                  className={`shrink-0 font-mono px-1.5 py-0.5 rounded uppercase ${
                    it.status === 'created'
                      ? 'bg-green-900/50 text-green-300'
                      : it.status === 'skipped'
                        ? 'bg-amber-900/50 text-amber-300'
                        : 'bg-red-900/50 text-red-300'
                  }`}
                >
                  {it.status}
                </span>
                <span className="font-mono text-slate-400">{it.video_id}</span>
                {it.status === 'created' && (
                  <span className="text-slate-500">· {it.segments} {t('import.ytSegments')}</span>
                )}
                {it.error && it.status !== 'skipped' && (
                  <span className="text-red-400 truncate">· {it.error}</span>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleYoutubeImport}
            disabled={ytStatus === 'running' || ytSources.trim().length === 0}
            className="btn-primary flex-1"
          >
            {ytStatus === 'running' ? t('import.ytImporting') : t('import.ytStart')}
          </button>
          {(ytStatus === 'done' || ytStatus === 'error') && (
            <button
              onClick={handleYoutubeReset}
              className="btn-secondary"
            >
              {t('import.ytReset')}
            </button>
          )}
        </div>
      </div>

      {/* ── Registered playlists ── */}
      <div className="card space-y-3">
        <div>
          <h3 className="font-medium text-slate-200">{t('import.playlistsTitle')}</h3>
          <p className="text-xs text-slate-400">{t('import.playlistsDesc')}</p>
        </div>

        {playlistError && <p className="text-red-400 text-xs">{playlistError}</p>}

        {isLoadingPlaylists ? (
          <p className="text-slate-500 text-sm">{t('common.loading')}</p>
        ) : playlists.length === 0 ? (
          <p className="text-slate-500 text-sm">{t('import.playlistsEmpty')}</p>
        ) : (
          <div className="space-y-3">
            {playlists.map((pl) => {
              const draft = playlistDrafts[pl.id]
              if (!draft) return null
              const isRefreshing = refreshingPlaylistId === pl.id
              return (
                <div key={pl.id} className="border border-slate-700 rounded-xl p-3 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-slate-200 truncate" title={pl.title ?? pl.playlist_id}>
                        {pl.title || pl.playlist_id}
                      </p>
                      {pl.is_internal ? (
                        <p className="text-xs text-emerald-300 font-mono">
                          {t('import.playlistInternal', 'interna')} · {pl.file_count} videos
                        </p>
                      ) : (
                        <a
                          href={pl.source_url || `https://www.youtube.com/playlist?list=${pl.playlist_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-400 font-mono hover:text-blue-300 hover:underline"
                        >
                          {pl.playlist_id}
                        </a>
                      )}
                    </div>
                    <button
                      onClick={() => handleDeletePlaylist(pl)}
                      disabled={playlistDeletingId === pl.id || isRefreshing}
                      className="text-slate-500 hover:text-red-400 transition-colors text-sm shrink-0 disabled:opacity-40"
                      title={t('import.playlistDelete')}
                    >
                      🗑
                    </button>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <div className="col-span-2">
                      <label className="text-xs text-slate-400 block mb-1">{t('import.playlistTitle')}</label>
                      <input
                        type="text"
                        value={draft.title}
                        onChange={(e) => updatePlaylistDraft(pl.id, { title: e.target.value })}
                        className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">{t('import.ytLanguage')}</label>
                      <input
                        type="text"
                        value={draft.language}
                        onChange={(e) => updatePlaylistDraft(pl.id, { language: e.target.value })}
                        placeholder="de"
                        className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">{t('import.ytStars')}</label>
                      <select
                        value={draft.stars}
                        onChange={(e) => updatePlaylistDraft(pl.id, { stars: parseInt(e.target.value) })}
                        className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value={0}>0 ★</option>
                        <option value={1}>1 ★</option>
                        <option value={2}>2 ★</option>
                        <option value={3}>3 ★</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">{t('import.ytFallback')}</label>
                      <input
                        type="text"
                        value={draft.fallback}
                        onChange={(e) => updatePlaylistDraft(pl.id, { fallback: e.target.value })}
                        placeholder="en, es"
                        className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">{t('import.ytMaxVideos')}</label>
                      <input
                        type="number"
                        min={1}
                        max={9999}
                        value={draft.maxVideos}
                        onChange={(e) => updatePlaylistDraft(pl.id, { maxVideos: parseInt(e.target.value) || 1 })}
                        className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  {temas.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {temas.map((tm) => {
                        const active = draft.temaIds.includes(tm.id)
                        return (
                          <button
                            key={tm.id}
                            type="button"
                            onClick={() => updatePlaylistDraft(pl.id, { temaIds: toggleTemaId(draft.temaIds, tm.id) })}
                            className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
                              active
                                ? 'border-blue-500 bg-blue-500/20 text-blue-200'
                                : 'border-slate-600 text-slate-400 hover:border-slate-400'
                            }`}
                          >
                            <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: tm.color }} />
                            {tm.nombre}
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {isRefreshing && playlistRefreshProgress && (
                    <div className="space-y-1">
                      <div className="w-full bg-slate-700 rounded-full h-2">
                        <div
                          className="bg-red-500 h-2 rounded-full transition-all"
                          style={{
                            width: playlistRefreshProgress.total > 0
                              ? `${(playlistRefreshProgress.current / playlistRefreshProgress.total) * 100}%`
                              : '5%',
                          }}
                        />
                      </div>
                      <p className="text-xs text-slate-400">
                        {playlistRefreshProgress.total > 0
                          ? t('import.ytProgress', { current: playlistRefreshProgress.current, total: playlistRefreshProgress.total })
                          : t('import.ytExpandingSources')}
                      </p>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSavePlaylist(pl)}
                      disabled={savingPlaylistId === pl.id || isRefreshing}
                      className="btn-secondary flex-1 text-sm disabled:opacity-40"
                    >
                      {savingPlaylistId === pl.id ? t('common.loading') : t('import.playlistSave')}
                    </button>
                    <button
                      onClick={() => handleRefreshPlaylist(pl)}
                      disabled={pl.is_internal || refreshingPlaylistId !== null || savingPlaylistId === pl.id}
                      className="btn-primary flex-1 text-sm disabled:opacity-40"
                      title={pl.is_internal ? t('import.playlistInternalNoRefresh', 'Las playlists internas no se refrescan desde YouTube') : undefined}
                    >
                      {isRefreshing ? t('import.playlistRefreshing') : t('import.playlistRefresh')}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
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
        <div className="px-4 py-3 border-b border-slate-700 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-slate-400 uppercase tracking-wide">
              {t('import.subtitleList')} · {filteredFiles.length}/{files.length}
            </div>
            {files.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-slate-400 normal-case tracking-normal">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={(e) => {
                    setSelectedFileIds(e.target.checked ? new Set(filteredFiles.map((f) => f.id)) : new Set())
                  }}
                  className="rounded border-slate-600 bg-slate-800"
                />
                {t('import.subtitleSelectAll')}
              </label>
            )}
          </div>

          {files.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
              <input
                type="text"
                value={filterName}
                onChange={(e) => setFilterName(e.target.value)}
                placeholder={t('import.subtitleFilterName', 'Nombre')}
                className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="text"
                value={filterLanguage}
                onChange={(e) => setFilterLanguage(e.target.value)}
                placeholder={t('import.subtitleFilterLanguage', 'Idioma')}
                className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <select
                value={filterTemaId}
                onChange={(e) => setFilterTemaId(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">{t('import.subtitleFilterTheme', 'Tema')}</option>
                {temas.map((tm) => <option key={tm.id} value={tm.id}>{tm.nombre}</option>)}
              </select>
              <select
                value={filterStars}
                onChange={(e) => setFilterStars(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">{t('import.subtitleFilterStars', 'Estrellas')}</option>
                <option value={0}>0 ★</option>
                <option value={1}>1 ★</option>
                <option value={2}>2 ★</option>
                <option value={3}>3 ★</option>
              </select>
              <select
                value={filterPlaylistId}
                onChange={(e) => setFilterPlaylistId(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">{t('import.subtitleFilterPlaylist', 'Playlist')}</option>
                {playlists.map((pl) => (
                  <option key={pl.id} value={pl.id}>
                    {pl.title || pl.playlist_id}
                  </option>
                ))}
              </select>
            </div>
          )}

          {selectedFileIds.size > 0 && (
            <div className="bg-slate-800/70 border border-slate-700 rounded-xl p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-slate-300">
                  {t('import.subtitleSelected', { count: selectedFileIds.size })}
                </p>
                <button
                  onClick={() => setSelectedFileIds(new Set())}
                  className="text-xs text-slate-500 hover:text-slate-300"
                >
                  {t('words.bulkCancel')}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label className="space-y-1">
                  <span className="flex items-center gap-2 text-xs text-slate-400">
                    <input
                      type="checkbox"
                      checked={bulkLanguageEnabled}
                      onChange={(e) => setBulkLanguageEnabled(e.target.checked)}
                      className="rounded border-slate-600 bg-slate-800"
                    />
                    {t('import.subtitleBulkLanguage')}
                  </span>
                  <input
                    type="text"
                    value={bulkLanguage}
                    onChange={(e) => setBulkLanguage(e.target.value)}
                    disabled={!bulkLanguageEnabled}
                    placeholder="de, es, en…"
                    className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-xs text-slate-400">{t('import.subtitleBulkStars')}</span>
                  <select
                    value={bulkStars}
                    onChange={(e) => setBulkStars(e.target.value)}
                    className="w-full bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">{t('import.subtitleNoChange')}</option>
                    <option value={0}>0 ★</option>
                    <option value={1}>1 ★</option>
                    <option value={2}>2 ★</option>
                    <option value={3}>3 ★</option>
                  </select>
                </label>

                <div className="space-y-1">
                  <label className="flex items-center gap-2 text-xs text-slate-400">
                    <input
                      type="checkbox"
                      checked={bulkTemasEnabled}
                      onChange={(e) => setBulkTemasEnabled(e.target.checked)}
                      className="rounded border-slate-600 bg-slate-800"
                    />
                    {t('import.subtitleBulkThemes')}
                  </label>
                  <div className={`flex flex-wrap gap-1.5 ${bulkTemasEnabled ? '' : 'opacity-40 pointer-events-none'}`}>
                    {temas.map((tm) => {
                      const active = bulkTemaIds.includes(tm.id)
                      return (
                        <button
                          key={tm.id}
                          type="button"
                          onClick={() => setBulkTemaIds((ids) => toggleTemaId(ids, tm.id))}
                          className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
                            active
                              ? 'border-blue-500 bg-blue-500/20 text-blue-200'
                              : 'border-slate-600 text-slate-400 hover:border-slate-400'
                          }`}
                        >
                          <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: tm.color }} />
                          {tm.nombre}
                        </button>
                      )
                    })}
                    {temas.length === 0 && (
                      <span className="text-xs text-slate-500">{t('import.subtitleNoThemes')}</span>
                    )}
                  </div>
                </div>
              </div>

              {bulkError && <p className="text-red-400 text-xs">{bulkError}</p>}

              <div className="flex gap-2">
                <button
                  onClick={handleBulkUpdate}
                  disabled={isBulkSaving || isBulkDeleting || selectedFileIds.size === 0 || !hasBulkChanges}
                  className="btn-primary flex-1 text-sm disabled:opacity-40"
                >
                  {isBulkSaving ? t('common.loading') : t('import.subtitleApplyBulk')}
                </button>
                {bulkDeleteConfirm ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setBulkDeleteConfirm(false)}
                      disabled={isBulkDeleting}
                      className="btn-secondary text-xs px-3 py-2"
                    >
                      {t('words.bulkCancel')}
                    </button>
                    <button
                      onClick={handleBulkDelete}
                      disabled={isBulkDeleting}
                      className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded-xl px-3 py-2 text-xs font-medium transition-colors flex items-center gap-1.5"
                    >
                      {isBulkDeleting && <span className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                      {t('import.subtitleBulkDeleteConfirm')}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setBulkDeleteConfirm(true)}
                    disabled={isBulkSaving || isBulkDeleting || selectedFileIds.size === 0}
                    className="bg-red-600/20 hover:bg-red-600/40 border border-red-500/40 text-red-300 disabled:opacity-40 rounded-xl px-3 py-2 text-xs font-medium transition-colors"
                  >
                    {t('import.subtitleBulkDelete', { count: selectedFileIds.size })}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {isLoadingFiles ? (
          <div className="px-4 py-4 text-slate-500 text-sm">{t('common.loading')}</div>
        ) : files.length === 0 ? (
          <div className="px-4 py-4 text-slate-500 text-sm">{t('import.subtitleNoFiles')}</div>
        ) : filteredFiles.length === 0 ? (
          <div className="px-4 py-4 text-slate-500 text-sm">{t('import.subtitleNoFilterResults', 'No hay subtítulos con esos filtros.')}</div>
        ) : (
          <div className="divide-y divide-slate-700/50">
            {filteredFiles.map((f) => {
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
                      <input
                        type="checkbox"
                        checked={selectedFileIds.has(f.id)}
                        onChange={() => toggleFileSelection(f.id)}
                        className="mt-1 rounded border-slate-600 bg-slate-800 shrink-0"
                        aria-label={t('import.subtitleSelectOne')}
                      />
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
                          <span className="text-xs text-amber-300">{'★'.repeat(f.stars)}{f.stars === 0 ? '0 ★' : ''}</span>
                          {f.temas.map((tm) => (
                            <span key={tm.id} className="text-xs border border-slate-600 px-1.5 py-0.5 rounded-full text-slate-300">
                              <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: tm.color }} />
                              {tm.nombre}
                            </span>
                          ))}
                          {f.playlists.map((pl) => (
                            <span key={pl.id} className="text-xs border border-emerald-600/60 px-1.5 py-0.5 rounded-full text-emerald-300">
                              {pl.is_internal ? '▣' : '▶'} {pl.title || pl.playlist_id}
                            </span>
                          ))}
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
