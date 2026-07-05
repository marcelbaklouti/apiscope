import { loadPackageDefinition, Server, ServerCredentials, type handleUnaryCall, type ServiceClientConstructor } from '@grpc/grpc-js'
import { loadSync } from '@grpc/proto-loader'
import { join } from 'node:path'
import type { ChildSpan, RequestSpan } from '@apiscope/core'
import { exportRequestToSpans, type OtlpExportTraceServiceRequest, type OtlpKeyValue, type OtlpResourceSpans } from './mapping'

export interface OtlpGrpcServerDeps {
  port: number
  host: string
  appName?: string
  ingest(appName: string, spans: RequestSpan[], childSpans: ChildSpan[]): Promise<void>
}

export interface OtlpGrpcServer {
  start(): Promise<number>
  stop(): Promise<void>
}

const protoRootDirectory = join(import.meta.dirname, '..', '..', 'proto')

interface DecodedKeyValue {
  key: string
  value: OtlpKeyValue['value']
}

interface DecodedSpan {
  traceId: Buffer
  spanId: Buffer
  parentSpanId?: Buffer
  name: string
  kind: number
  startTimeUnixNano: string
  endTimeUnixNano: string
  attributes: DecodedKeyValue[]
  status?: { code: number; message?: string }
}

interface DecodedResourceSpans {
  resource: { attributes: DecodedKeyValue[] }
  scopeSpans: Array<{ scope: { name: string; version?: string }; spans: DecodedSpan[] }>
}

interface DecodedExportTraceServiceRequest {
  resourceSpans: DecodedResourceSpans[]
}

function bytesToHex(value: Buffer | undefined): string | undefined {
  if (value === undefined || value.length === 0) return undefined
  return value.toString('hex')
}

function toPlainExportRequest(decoded: DecodedExportTraceServiceRequest): OtlpExportTraceServiceRequest {
  return {
    resourceSpans: decoded.resourceSpans.map((resourceSpans) => ({
      resource: { attributes: resourceSpans.resource.attributes },
      scopeSpans: resourceSpans.scopeSpans.map((scopeSpan) => ({
        scope: scopeSpan.scope,
        spans: scopeSpan.spans.map((span) => ({
          traceId: span.traceId.toString('hex'),
          spanId: span.spanId.toString('hex'),
          ...(bytesToHex(span.parentSpanId) === undefined ? {} : { parentSpanId: bytesToHex(span.parentSpanId) as string }),
          name: span.name,
          kind: span.kind,
          startTimeUnixNano: span.startTimeUnixNano,
          endTimeUnixNano: span.endTimeUnixNano,
          attributes: span.attributes,
          ...(span.status === undefined ? {} : { status: span.status })
        }))
      }))
    }))
  }
}

function resourceServiceName(resourceSpans: OtlpResourceSpans, fallback: string): string {
  const attribute = resourceSpans.resource.attributes.find((entry) => entry.key === 'service.name')
  return attribute?.value.stringValue ?? fallback
}

function groupByAppName(request: OtlpExportTraceServiceRequest, fallback: string): Map<string, OtlpExportTraceServiceRequest> {
  const groups = new Map<string, OtlpExportTraceServiceRequest>()
  for (const resourceSpans of request.resourceSpans) {
    const appName = resourceServiceName(resourceSpans, fallback)
    const existing = groups.get(appName)
    if (existing === undefined) {
      groups.set(appName, { resourceSpans: [resourceSpans] })
    } else {
      existing.resourceSpans.push(resourceSpans)
    }
  }
  return groups
}

export function createOtlpGrpcServer(deps: OtlpGrpcServerDeps): OtlpGrpcServer {
  const fallbackAppName = deps.appName ?? 'otlp'
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
  const TraceServiceDefinition = packageDefinition.opentelemetry.proto.collector.trace.v1.TraceService
  const server = new Server()
  const exportHandler: handleUnaryCall<DecodedExportTraceServiceRequest, Record<string, never>> = (call, callback) => {
    const decoded = call.request
    const exportRequest = toPlainExportRequest(decoded)
    const groups = groupByAppName(exportRequest, fallbackAppName)
    void (async () => {
      for (const [appName, grouped] of groups) {
        const { spans, childSpans } = exportRequestToSpans(grouped)
        await deps.ingest(appName, spans, childSpans)
      }
      callback(null, {})
    })()
  }
  server.addService(TraceServiceDefinition.service, { Export: exportHandler })
  return {
    start(): Promise<number> {
      return new Promise((resolve, reject) => {
        server.bindAsync(`${deps.host}:${deps.port}`, ServerCredentials.createInsecure(), (error, boundPort) => {
          if (error) {
            reject(error)
            return
          }
          resolve(boundPort)
        })
      })
    },
    stop(): Promise<void> {
      return new Promise((resolve) => {
        server.tryShutdown(() => resolve())
      })
    }
  }
}
