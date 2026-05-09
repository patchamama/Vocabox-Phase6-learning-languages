import { useEffect, useRef } from 'react'
import api, { GrammarQueueItem, grammarQueueApi } from '../api/client'
import { useGrammarQueueStore } from '../stores/grammarQueueStore'

type WSEvent =
  | { type: 'queue_snapshot'; items: GrammarQueueItem[]; worker_running: boolean }
  | { type: 'queue_item_update'; item: GrammarQueueItem }
  | { type: 'worker_stopped' }

const POLL_INTERVAL_MS = 3000

export function useGrammarQueueWS(enabled: boolean) {
  const wsRef   = useRef<WebSocket | null>(null)
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const { setItems, setWorkerRunning, upsertItem } = useGrammarQueueStore()

  useEffect(() => {
    if (!enabled) return

    const token   = localStorage.getItem('token') ?? ''
    const baseUrl = ((api.defaults.baseURL as string) ?? '').replace(/\/$/, '')
    const proto   = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const wsUrl   = `${proto}://${window.location.host}${baseUrl}/ws/grammar-queue?token=${encodeURIComponent(token)}`

    const startPolling = () => {
      if (pollRef.current) return
      pollRef.current = setInterval(async () => {
        try {
          const res = await grammarQueueApi.list()
          setItems(res.data.items)
          setWorkerRunning(res.data.worker_running)
        } catch {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
        }
      }, POLL_INTERVAL_MS)
    }

    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onmessage = (ev) => {
      const event: WSEvent = JSON.parse(ev.data as string)
      if (event.type === 'queue_snapshot') {
        setItems(event.items)
        setWorkerRunning(event.worker_running)
      } else if (event.type === 'queue_item_update') {
        upsertItem(event.item)
      } else if (event.type === 'worker_stopped') {
        setWorkerRunning(false)
      }
    }

    ws.onerror = () => {
      startPolling()
    }

    // Keep-alive ping every 25s (no-op if polling)
    pingRef.current = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send('ping')
    }, 25_000)

    return () => {
      if (pingRef.current) clearInterval(pingRef.current)
      if (pollRef.current) clearInterval(pollRef.current)
      ws.close()
    }
  }, [enabled])
}
