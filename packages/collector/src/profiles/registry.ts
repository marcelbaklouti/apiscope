import { PROTOCOL_VERSION, decodeWireMessage, encodeWireMessage, type FlameNode } from '@apiscope/core'
import type { WebSocket } from 'ws'

export interface ProfileResult {
  ok: boolean
  flamegraph?: FlameNode
  pprofBase64?: string
  error?: string
}

interface PendingRequest {
  resolve(result: ProfileResult): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

const PROFILE_TIMEOUT_MARGIN_MS = 5000

export class ProfileChannelRegistry {
  private readonly connectedApps = new Map<string, WebSocket>()
  private readonly pendingRequests = new Map<string, PendingRequest>()
  private nextRequestId = 0

  registerApp(appName: string, socket: WebSocket): void {
    this.connectedApps.set(appName, socket)
  }

  unregisterApp(appName: string): void {
    this.connectedApps.delete(appName)
  }

  isConnected(appName: string): boolean {
    return this.connectedApps.has(appName)
  }

  handleInboundMessage(raw: string): boolean {
    const decoded = decodeWireMessage(raw)
    if (!decoded.ok || decoded.message.type !== 'profile-result') return false
    const { requestId, ok, flamegraph, pprofBase64, error } = decoded.message
    const pending = this.pendingRequests.get(requestId)
    if (pending === undefined) return true
    this.pendingRequests.delete(requestId)
    clearTimeout(pending.timer)
    const result: ProfileResult = { ok }
    if (flamegraph !== undefined) result.flamegraph = flamegraph
    if (pprofBase64 !== undefined) result.pprofBase64 = pprofBase64
    if (error !== undefined) result.error = error
    pending.resolve(result)
    return true
  }

  requestProfile(appName: string, durationMs: number): Promise<ProfileResult> {
    const socket = this.connectedApps.get(appName)
    if (socket === undefined) {
      return Promise.reject(new Error(`app "${appName}" is not connected`))
    }
    this.nextRequestId += 1
    const requestId = `profile-${Date.now()}-${this.nextRequestId}`
    return new Promise<ProfileResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        reject(new Error(`profile request timed out for app "${appName}"`))
      }, durationMs + PROFILE_TIMEOUT_MARGIN_MS)
      this.pendingRequests.set(requestId, { resolve, reject, timer })
      socket.send(encodeWireMessage({ type: 'profile-request', protocolVersion: PROTOCOL_VERSION, requestId, durationMs }))
    })
  }
}
