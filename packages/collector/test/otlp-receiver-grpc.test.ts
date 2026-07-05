import { credentials, loadPackageDefinition, type ServiceClientConstructor } from '@grpc/grpc-js'
import { loadSync } from '@grpc/proto-loader'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCollector, type Collector } from '../src/index'

let collector: Collector

afterEach(async () => {
  await collector.close()
})

function traceServiceClient(target: string): { Export: (request: unknown, callback: (error: unknown) => void) => void } {
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

describe('otlp grpc receiver', () => {
  it('accepts an Export call and stores the span', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0, otlpIngest: { grpc: true, grpcPort: 0 } })
    await collector.listen()
    const grpcPort = collector.otlpGrpcPort!
    const client = traceServiceClient(`127.0.0.1:${grpcPort}`)
    const now = 1_700_000_000_000
    const request = {
      resourceSpans: [
        {
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'grpc-service' } }] },
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
    await new Promise<void>((resolve, reject) => client.Export(request, (error) => (error ? reject(error) : resolve())))
    await vi.waitFor(async () => expect((await collector.store.recentSpans(10)).length).toBe(1), { timeout: 2000 })
    expect((await collector.store.recentSpans(10))[0]?.routePattern).toBe('/grpc')
  })
})
