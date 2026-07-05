import { isAbsolute, join } from 'node:path'
import protobuf, { type Root, type Type } from 'protobufjs'
import type { OtlpExportTraceServiceRequest, OtlpKeyValue, OtlpResourceSpans, OtlpScopeSpans, OtlpSpan } from './mapping'

const protoRootDirectory = join(import.meta.dirname, '..', '..', 'proto')

let cachedRoot: Root | undefined
let cachedType: Type | undefined

export function loadTraceProtoRoot(): Root {
  if (cachedRoot !== undefined) return cachedRoot
  const root = new protobuf.Root()
  root.resolvePath = (_origin, target) => (isAbsolute(target) ? target : join(protoRootDirectory, target))
  root.loadSync('opentelemetry/proto/collector/trace/v1/trace_service.proto')
  root.resolveAll()
  cachedRoot = root
  return root
}

function exportRequestType(): Type {
  if (cachedType !== undefined) return cachedType
  cachedType = loadTraceProtoRoot().lookupType('opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest')
  return cachedType
}

function hexToBytes(hex: string): Buffer {
  return Buffer.from(hex, 'hex')
}

function bytesToHex(value: Uint8Array): string {
  return Buffer.from(value).toString('hex')
}

function attributeToWire(attribute: OtlpKeyValue): Record<string, unknown> {
  return { key: attribute.key, value: attribute.value }
}

function attributeFromWire(attribute: { key: string; value: OtlpKeyValue['value'] }): OtlpKeyValue {
  return { key: attribute.key, value: attribute.value }
}

function spanToWire(span: OtlpSpan): Record<string, unknown> {
  return {
    traceId: hexToBytes(span.traceId),
    spanId: hexToBytes(span.spanId),
    ...(span.parentSpanId === undefined ? {} : { parentSpanId: hexToBytes(span.parentSpanId) }),
    name: span.name,
    kind: span.kind,
    startTimeUnixNano: span.startTimeUnixNano,
    endTimeUnixNano: span.endTimeUnixNano,
    attributes: span.attributes.map(attributeToWire),
    ...(span.status === undefined ? {} : { status: span.status })
  }
}

function spanFromWire(span: {
  traceId: Uint8Array
  spanId: Uint8Array
  parentSpanId?: Uint8Array
  name: string
  kind: number
  startTimeUnixNano: string
  endTimeUnixNano: string
  attributes: Array<{ key: string; value: OtlpKeyValue['value'] }>
  status?: { code: number; message?: string }
}): OtlpSpan {
  const parentSpanId = span.parentSpanId
  return {
    traceId: bytesToHex(span.traceId),
    spanId: bytesToHex(span.spanId),
    ...(parentSpanId === undefined || parentSpanId.length === 0 ? {} : { parentSpanId: bytesToHex(parentSpanId) }),
    name: span.name,
    kind: span.kind,
    startTimeUnixNano: span.startTimeUnixNano,
    endTimeUnixNano: span.endTimeUnixNano,
    attributes: span.attributes.map(attributeFromWire),
    ...(span.status === undefined ? {} : { status: span.status })
  }
}

function scopeSpansToWire(scopeSpans: OtlpScopeSpans): Record<string, unknown> {
  return {
    scope: scopeSpans.scope,
    spans: scopeSpans.spans.map(spanToWire)
  }
}

function resourceSpansToWire(resourceSpans: OtlpResourceSpans): Record<string, unknown> {
  return {
    resource: { attributes: resourceSpans.resource.attributes.map(attributeToWire) },
    scopeSpans: resourceSpans.scopeSpans.map(scopeSpansToWire)
  }
}

export function encodeExportRequest(request: OtlpExportTraceServiceRequest): Uint8Array {
  const type = exportRequestType()
  const wirePayload = {
    resourceSpans: request.resourceSpans.map(resourceSpansToWire)
  }
  const message = type.create(wirePayload)
  return type.encode(message).finish()
}

export function decodeExportRequest(bytes: Uint8Array): OtlpExportTraceServiceRequest {
  const type = exportRequestType()
  const decoded = type.decode(bytes)
  const decodedObject = type.toObject(decoded, { longs: String, enums: Number, bytes: Buffer, defaults: true }) as {
    resourceSpans: Array<{
      resource: { attributes: Array<{ key: string; value: OtlpKeyValue['value'] }> }
      scopeSpans: Array<{
        scope: { name: string; version?: string }
        spans: Array<{
          traceId: Uint8Array
          spanId: Uint8Array
          parentSpanId?: Uint8Array
          name: string
          kind: number
          startTimeUnixNano: string
          endTimeUnixNano: string
          attributes: Array<{ key: string; value: OtlpKeyValue['value'] }>
          status?: { code: number; message?: string }
        }>
      }>
    }>
  }
  return {
    resourceSpans: decodedObject.resourceSpans.map((resourceSpan) => ({
      resource: { attributes: resourceSpan.resource.attributes.map(attributeFromWire) },
      scopeSpans: resourceSpan.scopeSpans.map((scopeSpan) => ({
        scope: scopeSpan.scope,
        spans: scopeSpan.spans.map(spanFromWire)
      }))
    }))
  }
}
