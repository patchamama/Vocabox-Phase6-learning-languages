import { useEffect, useRef } from 'react'
import api, { GrammarQueueItem, grammarQueueApi } from '../api/client'
import { useGrammarQueueStore } from '../stores/grammarQueueStore'

type WSEvent =
  | { type: 'queue_snapshot'; items: GrammarQueueItem[]; worker_running: boolean }
  | { type: 'queue_item_update'; item: GrammarQueueItem }
  | { type: 'worker_stopped' }

const POLL_INTERVAL_MIN_MS = 3000
const POLL_INTERVAL_MAX_MS = 30_000
const WS_RECONNECT_MIN_MS  = 5000
const WS_RECONNECT_MAX_MS  = 60_000

export function useGrammarQueueWS(enabled: boolean) {
  const wsRef               = useRef<WebSocket | null>(null)
  const pingRef              = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollTimeoutRef       = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectTimeoutRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollDelayRef         = useRef(POLL_INTERVAL_MIN_MS)
  const reconnectDelayRef    = useRef(WS_RECONNECT_MIN_MS)
  const stoppedRef           = useRef(false)
  const { setItems, setWorkerRunning, upsertItem } = useGrammarQueueStore()

  useEffect(() => {
    if (!enabled) return
    stoppedRef.current = false

    const token   = localStorage.getItem('token') ?? ''
    const baseUrl = ((api.defaults.baseURL as string) ?? '').replace(/\/$/, '')
    const proto   = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const wsUrl   = `${proto}://${window.location.host}${baseUrl}/ws/grammar-queue?token=${encodeURIComponent(token)}`

    const stopPolling = () => {
      if (pollTimeoutRef.current) { clearTimeout(pollTimeoutRef.current); pollTimeoutRef.current = null }
      pollDelayRef.current = POLL_INTERVAL_MIN_MS
    }

    // Fallback while the WS is down. Backs off up to POLL_INTERVAL_MAX_MS
    // instead of hammering the endpoint at a fixed interval forever.
    const schedulePoll = () => {
      if (pollTimeoutRef.current || stoppedRef.current) return
      pollTimeoutRef.current = setTimeout(async () => {
        pollTimeoutRef.current = null
        try {
          const res = await grammarQueueApi.list()
          setItems(res.data.items)
          setWorkerRunning(res.data.worker_running)
        } catch {
          // keep backing off and retrying
        }
        pollDelayRef.current = Math.min(pollDelayRef.current * 1.5, POLL_INTERVAL_MAX_MS)
        schedulePoll()
      }, pollDelayRef.current)
    }

    const connect = () => {
      if (stoppedRef.current) return
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        stopPolling()
        reconnectDelayRef.current = WS_RECONNECT_MIN_MS
      }

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

      // WS unavailable (e.g. proxy doesn't forward the upgrade): poll as a
      // stopgap and keep retrying the WS itself with growing backoff, so it
      // recovers on its own once the WS path works again.
      const handleDown = () => {
        schedulePoll()
        if (reconnectTimeoutRef.current || stoppedRef.current) return
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null
          connect()
        }, reconnectDelayRef.current)
        reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, WS_RECONNECT_MAX_MS)
      }

      ws.onerror = handleDown
      ws.onclose = handleDown
    }

    connect()

    // Keep-alive ping every 25s (no-op while polling)
    pingRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send('ping')
    }, 25_000)

    return () => {
      stoppedRef.current = true
      if (pingRef.current) clearInterval(pingRef.current)
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current)
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current)
      wsRef.current?.close()
    }
  }, [enabled])
}
