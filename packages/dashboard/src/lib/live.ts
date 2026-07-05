import { useEffect, useState } from 'react'
import { api } from './api'
import { useDashboardStore } from './store'
import type { RouteEntry, Span } from './types'

interface LiveEventShape {
  type: string
  appName?: string
  app?: { name: string; framework: string; runtime: 'node' | 'bun' | 'deno' | 'edge' }
  spans?: Span[]
  childSpans?: []
  routes?: Array<{ method: string; pattern: string; sourceFile?: string }>
  droppedCount?: number
  runId?: string
  name?: string
  snapshot?: { totalRequests: number; errorCount: number; latencyP95: number }
  ok?: boolean
}

export function useLiveConnection(): boolean {
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    let socket: WebSocket | null = null
    let closed = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const hydrate = async () => {
      try {
        const [spans, routes] = await Promise.all([api.spans(500), api.routes()])
        useDashboardStore.getState().hydrate(spans, routes)
      } catch {}
    }

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
      socket = new WebSocket(`${protocol}://${window.location.host}/ws/live`)
      socket.onopen = () => {
        setConnected(true)
        void hydrate()
      }
      socket.onclose = () => {
        setConnected(false)
        if (!closed) retryTimer = setTimeout(connect, 1000)
      }
      socket.onmessage = (message) => {
        const event = JSON.parse(String(message.data)) as LiveEventShape
        const store = useDashboardStore.getState()
        if (event.type === 'spans' && event.spans !== undefined) {
          store.addSpans(event.spans, event.childSpans ?? [], event.appName ?? '')
        } else if (event.type === 'registry' && event.routes !== undefined && event.appName !== undefined) {
          const appName = event.appName
          store.setRoutes(appName, event.routes.map((route): RouteEntry => ({ appName, ...route })))
        } else if (event.type === 'app-connected' && event.app !== undefined) {
          store.appConnected(event.app)
        } else if (event.type === 'app-disconnected' && event.appName !== undefined) {
          store.appDisconnected(event.appName)
        } else if (event.type === 'dropped' && event.droppedCount !== undefined) {
          store.addDropped(event.droppedCount)
        } else if (event.type === 'load-progress' && event.runId !== undefined && event.snapshot !== undefined) {
          store.loadProgress(event.runId, event.name ?? '', event.snapshot)
        } else if (event.type === 'load-finished' && event.runId !== undefined) {
          store.loadFinished(event.runId, event.ok === true)
        }
      }
    }

    connect()
    return () => {
      closed = true
      if (retryTimer !== null) clearTimeout(retryTimer)
      socket?.close()
    }
  }, [])
  return connected
}
