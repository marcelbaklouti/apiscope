import { afterEach, describe, expect, it } from 'vitest'
import type { CollectorClient } from '../src/client'
import { startHttpServer, type HttpServerHandle } from '../src/http'

let handle: HttpServerHandle | undefined

afterEach(async () => {
  if (handle !== undefined) await handle.close()
  handle = undefined
})

function stubClient(): CollectorClient {
  return {
    async listRoutes() {
      return []
    },
    async querySpans() {
      return []
    },
    async getSpan() {
      return null
    },
    async startLoadRun() {
      return { runId: 'stub' }
    },
    async getRun() {
      return null
    },
    async generateScenario() {
      return {}
    }
  }
}

const initializeBody = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0.0.0' } }
})

const mcpHeaders = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }

describe('mcp http transport hardening', () => {
  it('rejects a request from a foreign origin with 403', async () => {
    handle = await startHttpServer(stubClient(), { port: 0 })
    const response = await fetch(`http://127.0.0.1:${handle.port}/`, {
      method: 'POST',
      headers: { ...mcpHeaders, origin: 'http://evil.example.com' },
      body: initializeBody
    })
    expect(response.status).toBe(403)
  })

  it('allows a same-origin request when no auth token is configured', async () => {
    handle = await startHttpServer(stubClient(), { port: 0 })
    const response = await fetch(`http://127.0.0.1:${handle.port}/`, {
      method: 'POST',
      headers: { ...mcpHeaders, origin: `http://127.0.0.1:${handle.port}` },
      body: initializeBody
    })
    expect(response.status).toBeLessThan(400)
  })

  it('rejects a request missing the configured bearer token with 401', async () => {
    handle = await startHttpServer(stubClient(), { port: 0, authToken: 'super-secret' })
    const response = await fetch(`http://127.0.0.1:${handle.port}/`, {
      method: 'POST',
      headers: mcpHeaders,
      body: initializeBody
    })
    expect(response.status).toBe(401)
  })

  it('allows a request carrying the correct bearer token', async () => {
    handle = await startHttpServer(stubClient(), { port: 0, authToken: 'super-secret' })
    const response = await fetch(`http://127.0.0.1:${handle.port}/`, {
      method: 'POST',
      headers: { ...mcpHeaders, authorization: 'Bearer super-secret' },
      body: initializeBody
    })
    expect(response.status).toBeLessThan(400)
  })
})
