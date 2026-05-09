import { useEffect, useState } from 'react'
import api from '../api/client'

let _wsAvailable: boolean | null = null
let _testPromise: Promise<boolean> | null = null

function buildPingUrl(): string {
  const baseUrl = ((api.defaults.baseURL as string) ?? '').replace(/\/$/, '')
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}${baseUrl}/ws/ping`
}

export function testWsConnectivity(): Promise<boolean> {
  if (_testPromise) return _testPromise
  _testPromise = new Promise((resolve) => {
    try {
      const ws = new WebSocket(buildPingUrl())
      const timeout = setTimeout(() => {
        ws.close()
        _wsAvailable = false
        resolve(false)
      }, 3000)
      ws.onmessage = () => {
        clearTimeout(timeout)
        ws.close()
        _wsAvailable = true
        resolve(true)
      }
      ws.onerror = () => {
        clearTimeout(timeout)
        _wsAvailable = false
        resolve(false)
      }
    } catch {
      _wsAvailable = false
      resolve(false)
    }
  })
  return _testPromise
}

export function getWsAvailability(): boolean | null {
  return _wsAvailable
}

export function useWsAvailability(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(_wsAvailable)
  useEffect(() => {
    if (_wsAvailable !== null) {
      setAvailable(_wsAvailable)
      return
    }
    testWsConnectivity().then(setAvailable)
  }, [])
  return available
}
