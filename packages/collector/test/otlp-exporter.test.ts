import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import type { RequestSpan } from '@apiscope/core'
import { createOtlpExporter } from '../src/otlp/exporter'
import { decodeExportRequest } from '../src/otlp/proto'

let server: Server

afterEach(async () => {
  if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
})

const span: RequestSpan = {
  id: 'aaaaaaaaaaaaaaaa',
  traceId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  method: 'GET',
  routePattern: '/x',
  actualPath: '/x',
  statusCode: 200,
  timing: { start: 1_700_000_000_000, ttfb: null, duration: 4 },
  framework: 'express',
  runtime: 'node'
}

async function captureBody(expectedType: string): Promise<{ url: string; contentType: string; raw: Buffer }> {
  return new Promise((resolve) => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk) => chunks.push(chunk as Buffer))
      request.on('end', () => {
        response.writeHead(200)
        response.end('{}')
        resolve({ url: request.url ?? '', contentType: request.headers['content-type'] ?? '', raw: Buffer.concat(chunks) })
      })
    })
    server.listen(0, '127.0.0.1')
  })
}

describe('otlp exporter', () => {
  it('exports json to /v1/traces', async () => {
    const capture = captureBody('application/json')
    await new Promise((resolve) => setTimeout(resolve, 50))
    const { port } = server.address() as { port: number }
    const exporter = createOtlpExporter({ endpoint: `http://127.0.0.1:${port}`, protocol: 'http/json', serviceName: 'demo' })
    await exporter.export([span], [])
    const result = await capture
    expect(result.url).toBe('/v1/traces')
    expect(result.contentType).toContain('application/json')
    const parsed = JSON.parse(result.raw.toString('utf8')) as { resourceSpans: unknown[] }
    expect(parsed.resourceSpans).toHaveLength(1)
    await exporter.shutdown()
  })

  it('exports protobuf that decodes back to the same span', async () => {
    const capture = captureBody('application/x-protobuf')
    await new Promise((resolve) => setTimeout(resolve, 50))
    const { port } = server.address() as { port: number }
    const exporter = createOtlpExporter({ endpoint: `http://127.0.0.1:${port}`, protocol: 'http/protobuf', serviceName: 'demo' })
    await exporter.export([span], [])
    const result = await capture
    expect(result.contentType).toContain('application/x-protobuf')
    const decoded = decodeExportRequest(result.raw)
    const otlpSpan = decoded.resourceSpans[0]!.scopeSpans[0]!.spans[0]!
    expect(otlpSpan.name).toBe('GET /x')
    await exporter.shutdown()
  })
})
