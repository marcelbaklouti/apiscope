import { credentials, loadPackageDefinition, Metadata, status, type ServiceClientConstructor } from '@grpc/grpc-js'
import { loadSync } from '@grpc/proto-loader'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTokenIngestAuthenticator } from '../src/auth/ingest-auth'
import { createCollector, type Collector } from '../src/index'

let collector: Collector

afterEach(async () => {
  await collector.close()
})

interface TraceServiceClient {
  Export: (request: unknown, metadata: Metadata, callback: (error: (Error & { code?: number }) | null) => void) => void
}

function traceServiceClient(target: string): TraceServiceClient {
  const definition = loadSync(
    join(__dirname, '..', 'proto', 'opentelemetry', 'proto', 'collector', 'trace', 'v1', 'trace_service.proto'),
    { keepCase: false, longs: String, enums: Number, defaults: true, oneofs: true, includeDirs: [join(__dirname, '..', 'proto')] }
  )
  const pkg = loadPackageDefinition(definition) as unknown as {
    opentelemetry: { proto: { collector: { trace: { v1: { TraceService: ServiceClientConstructor } } } } }
  }
  const Client = pkg.opentelemetry.proto.collector.trace.v1.TraceService
  return new Client(target, credentials.createInsecure()) as never
}

function sampleExportRequest(serviceName: string) {
  const now = 1_700_000_000_000
  return {
    resourceSpans: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: serviceName } }] },
        scopeSpans: [
          {
            scope: { name: 'test' },
            spans: [
              {
                traceId: Buffer.from('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'hex'),
                spanId: Buffer.from('aaaaaaaaaaaaaaaa', 'hex'),
                name: 'GET /grpc',
                kind: 2,
                startTimeUnixNano: String(BigInt(now) * 1_000_000n),
                endTimeUnixNano: String(BigInt(now + 6) * 1_000_000n),
                attributes: [
                  { key: 'http.request.method', value: { stringValue: 'GET' } },
                  { key: 'http.route', value: { stringValue: '/grpc' } },
                  { key: 'http.response.status_code', value: { intValue: '200' } }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
}

describe('otlp grpc receiver', () => {
  it('accepts an Export call and stores the span', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0, otlpIngest: { grpc: true, grpcPort: 0 } })
    await collector.listen()
    const grpcPort = collector.otlpGrpcPort!
    const client = traceServiceClient(`127.0.0.1:${grpcPort}`)
    const request = sampleExportRequest('grpc-service')
    await new Promise<void>((resolve, reject) =>
      client.Export(request, new Metadata(), (error) => (error ? reject(error) : resolve()))
    )
    await vi.waitFor(async () => expect((await collector.store.recentSpans(10)).length).toBe(1), { timeout: 2000 })
    expect((await collector.store.recentSpans(10))[0]?.routePattern).toBe('/grpc')
  })

  it('rejects an Export call with no token when a token authenticator is configured', async () => {
    const ingestAuth = createTokenIngestAuthenticator([{ appName: 'app-a', token: 'app-a-token' }])
    collector = createCollector({ dbPath: ':memory:', port: 0, ingestAuth, otlpIngest: { grpc: true, grpcPort: 0 } })
    await collector.listen()
    const grpcPort = collector.otlpGrpcPort!
    const client = traceServiceClient(`127.0.0.1:${grpcPort}`)
    const request = sampleExportRequest('grpc-service')
    const error = await new Promise<(Error & { code?: number }) | null>((resolve) =>
      client.Export(request, new Metadata(), (callError) => resolve(callError))
    )
    expect(error).not.toBeNull()
    expect(error?.code).toBe(status.UNAUTHENTICATED)
    expect((await collector.store.recentSpans(10)).length).toBe(0)
  })

  it('rejects an Export call with an invalid token', async () => {
    const ingestAuth = createTokenIngestAuthenticator([{ appName: 'app-a', token: 'app-a-token' }])
    collector = createCollector({ dbPath: ':memory:', port: 0, ingestAuth, otlpIngest: { grpc: true, grpcPort: 0 } })
    await collector.listen()
    const grpcPort = collector.otlpGrpcPort!
    const client = traceServiceClient(`127.0.0.1:${grpcPort}`)
    const request = sampleExportRequest('grpc-service')
    const metadata = new Metadata()
    metadata.set('authorization', 'Bearer wrong-token')
    const error = await new Promise<(Error & { code?: number }) | null>((resolve) =>
      client.Export(request, metadata, (callError) => resolve(callError))
    )
    expect(error).not.toBeNull()
    expect(error?.code).toBe(status.UNAUTHENTICATED)
  })

  it('accepts a valid token and ingests under the authenticated app, not the spoofed service.name', async () => {
    const ingestAuth = createTokenIngestAuthenticator([{ appName: 'app-a', token: 'app-a-token' }])
    collector = createCollector({ dbPath: ':memory:', port: 0, ingestAuth, otlpIngest: { grpc: true, grpcPort: 0 } })
    await collector.listen()
    const publishedAppNames: string[] = []
    collector.hub.subscribe((event) => {
      if (event.type === 'spans') publishedAppNames.push(event.appName)
    })
    const grpcPort = collector.otlpGrpcPort!
    const client = traceServiceClient(`127.0.0.1:${grpcPort}`)
    const request = sampleExportRequest('app-b')
    const metadata = new Metadata()
    metadata.set('authorization', 'Bearer app-a-token')
    await new Promise<void>((resolve, reject) => client.Export(request, metadata, (error) => (error ? reject(error) : resolve())))
    await vi.waitFor(() => expect(publishedAppNames).toEqual(['app-a']), { timeout: 2000 })
  })
})
