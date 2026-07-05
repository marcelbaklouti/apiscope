import { credentials, loadPackageDefinition, type ServiceClientConstructor } from '@grpc/grpc-js'
import { loadSync } from '@grpc/proto-loader'
import { join } from 'node:path'
import type { ChildSpan, RequestSpan } from '@apiscope/core'
import { spansToExportRequest } from './mapping'
import { encodeExportRequest } from './proto'

export type OtlpProtocol = 'http/json' | 'http/protobuf' | 'grpc'

export interface OtlpExportConfig {
  endpoint: string
  protocol: OtlpProtocol
  headers?: Record<string, string>
  serviceName: string
}

export interface OtlpExporter {
  export(spans: RequestSpan[], childSpans: ChildSpan[]): Promise<void>
  shutdown(): Promise<void>
}

interface TraceServiceClient {
  Export: (request: unknown, callback: (error: unknown) => void) => void
  close?: () => void
}

const protoRootDirectory = join(import.meta.dirname, '..', '..', 'proto')

function logExportFailureOnce(config: OtlpExportConfig): (error: unknown) => void {
  let logged = false
  return (error: unknown) => {
    if (logged) return
    logged = true
    const message = error instanceof Error ? error.message : String(error)
    console.error(`apiscope otlp export to ${config.endpoint} (${config.protocol}) failed: ${message}`)
  }
}

function createHttpJsonExporter(config: OtlpExportConfig): OtlpExporter {
  const logFailure = logExportFailureOnce(config)
  return {
    async export(spans, childSpans) {
      try {
        const request = spansToExportRequest(spans, childSpans, { serviceName: config.serviceName })
        await fetch(`${config.endpoint}/v1/traces`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(config.headers ?? {}) },
          body: JSON.stringify(request)
        })
      } catch (error) {
        logFailure(error)
      }
    },
    async shutdown() {}
  }
}

function createHttpProtobufExporter(config: OtlpExportConfig): OtlpExporter {
  const logFailure = logExportFailureOnce(config)
  return {
    async export(spans, childSpans) {
      try {
        const request = spansToExportRequest(spans, childSpans, { serviceName: config.serviceName })
        const encoded = encodeExportRequest(request)
        await fetch(`${config.endpoint}/v1/traces`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-protobuf', ...(config.headers ?? {}) },
          body: encoded as BodyInit
        })
      } catch (error) {
        logFailure(error)
      }
    },
    async shutdown() {}
  }
}

function createGrpcExporter(config: OtlpExportConfig): OtlpExporter {
  const logFailure = logExportFailureOnce(config)
  const definition = loadSync(join(protoRootDirectory, 'opentelemetry', 'proto', 'collector', 'trace', 'v1', 'trace_service.proto'), {
    keepCase: false,
    longs: String,
    enums: Number,
    defaults: true,
    oneofs: true,
    includeDirs: [protoRootDirectory]
  })
  const packageDefinition = loadPackageDefinition(definition) as unknown as {
    opentelemetry: { proto: { collector: { trace: { v1: { TraceService: ServiceClientConstructor } } } } }
  }
  const TraceServiceClient = packageDefinition.opentelemetry.proto.collector.trace.v1.TraceService
  const target = config.endpoint.replace(/^https?:\/\//, '')
  const client = new TraceServiceClient(target, credentials.createInsecure()) as unknown as TraceServiceClient
  return {
    async export(spans, childSpans) {
      try {
        const request = spansToExportRequest(spans, childSpans, { serviceName: config.serviceName })
        const wireSpans = request.resourceSpans.map((resourceSpan) => ({
          resource: resourceSpan.resource,
          scopeSpans: resourceSpan.scopeSpans.map((scopeSpan) => ({
            scope: scopeSpan.scope,
            spans: scopeSpan.spans.map((span) => ({
              traceId: Buffer.from(span.traceId, 'hex'),
              spanId: Buffer.from(span.spanId, 'hex'),
              ...(span.parentSpanId === undefined ? {} : { parentSpanId: Buffer.from(span.parentSpanId, 'hex') }),
              name: span.name,
              kind: span.kind,
              startTimeUnixNano: span.startTimeUnixNano,
              endTimeUnixNano: span.endTimeUnixNano,
              attributes: span.attributes,
              ...(span.status === undefined ? {} : { status: span.status })
            }))
          }))
        }))
        await new Promise<void>((resolve) => {
          client.Export({ resourceSpans: wireSpans }, (error) => {
            if (error) logFailure(error)
            resolve()
          })
        })
      } catch (error) {
        logFailure(error)
      }
    },
    async shutdown() {
      client.close?.()
    }
  }
}

export function createOtlpExporter(config: OtlpExportConfig): OtlpExporter {
  if (config.protocol === 'http/json') return createHttpJsonExporter(config)
  if (config.protocol === 'http/protobuf') return createHttpProtobufExporter(config)
  return createGrpcExporter(config)
}
