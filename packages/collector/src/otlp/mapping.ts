import { normalizeSpanId, normalizeTraceId, type ChildSpan, type RequestSpan } from '@apiscope/core'

export interface OtlpAnyValue {
  stringValue?: string
  intValue?: string
  boolValue?: boolean
  doubleValue?: number
}

export interface OtlpKeyValue {
  key: string
  value: OtlpAnyValue
}

export interface OtlpSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: number
  startTimeUnixNano: string
  endTimeUnixNano: string
  attributes: OtlpKeyValue[]
  status?: { code: number; message?: string }
}

export interface OtlpScopeSpans {
  scope: { name: string; version?: string }
  spans: OtlpSpan[]
}

export interface OtlpResourceSpans {
  resource: { attributes: OtlpKeyValue[] }
  scopeSpans: OtlpScopeSpans[]
}

export interface OtlpExportTraceServiceRequest {
  resourceSpans: OtlpResourceSpans[]
}

const scopeName = 'apiscope'

function millisToNano(millis: number): string {
  return String(BigInt(Math.round(millis * 1_000_000)))
}

function nanoToMillis(nano: string): number {
  return Number(BigInt(nano) / 1_000_000n)
}

function stringAttribute(key: string, value: string): OtlpKeyValue {
  return { key, value: { stringValue: value } }
}

function intAttribute(key: string, value: number): OtlpKeyValue {
  return { key, value: { intValue: String(value) } }
}

function findString(attributes: OtlpKeyValue[], ...keys: string[]): string | undefined {
  for (const key of keys) {
    const found = attributes.find((attribute) => attribute.key === key)
    if (found?.value.stringValue !== undefined) return found.value.stringValue
  }
  return undefined
}

function findInt(attributes: OtlpKeyValue[], ...keys: string[]): number | undefined {
  for (const key of keys) {
    const found = attributes.find((attribute) => attribute.key === key)
    if (found?.value.intValue !== undefined) return Number(found.value.intValue)
    if (found?.value.doubleValue !== undefined) return Math.round(found.value.doubleValue)
  }
  return undefined
}

function requestSpanToOtlp(span: RequestSpan): OtlpSpan {
  const start = span.timing.start
  const attributes: OtlpKeyValue[] = [
    stringAttribute('http.request.method', span.method),
    stringAttribute('url.path', span.actualPath),
    stringAttribute('apiscope.framework', span.framework),
    stringAttribute('apiscope.runtime', span.runtime)
  ]
  if (span.routePattern !== null) attributes.push(stringAttribute('http.route', span.routePattern))
  attributes.push(intAttribute('http.response.status_code', span.statusCode))
  if (span.loadRunId !== undefined) attributes.push(stringAttribute('apiscope.load_run_id', span.loadRunId))
  return {
    traceId: normalizeTraceId(span.traceId),
    spanId: normalizeSpanId(span.id),
    ...(span.parentSpanId === undefined ? {} : { parentSpanId: normalizeSpanId(span.parentSpanId) }),
    name: `${span.method} ${span.routePattern ?? span.actualPath}`,
    kind: 2,
    startTimeUnixNano: millisToNano(start),
    endTimeUnixNano: millisToNano(start + span.timing.duration),
    attributes,
    status: span.error === undefined ? { code: span.statusCode >= 500 ? 2 : 1 } : { code: 2, message: span.error.message }
  }
}

function childSpanToOtlp(child: ChildSpan): OtlpSpan {
  const start = child.timing.start
  const attributes: OtlpKeyValue[] = [
    stringAttribute('http.request.method', child.method),
    stringAttribute('url.full', child.url),
    stringAttribute('apiscope.child.kind', child.kind)
  ]
  if (child.statusCode !== null && child.statusCode !== undefined) {
    attributes.push(intAttribute('http.response.status_code', child.statusCode))
  }
  return {
    traceId: normalizeTraceId(child.traceId),
    spanId: normalizeSpanId(child.id),
    parentSpanId: normalizeSpanId(child.parentSpanId),
    name: `${child.method} ${child.url}`,
    kind: 3,
    startTimeUnixNano: millisToNano(start),
    endTimeUnixNano: millisToNano(start + child.timing.duration),
    attributes
  }
}

export function spansToExportRequest(
  spans: RequestSpan[],
  childSpans: ChildSpan[],
  resource: { serviceName: string }
): OtlpExportTraceServiceRequest {
  return {
    resourceSpans: [
      {
        resource: { attributes: [stringAttribute('service.name', resource.serviceName)] },
        scopeSpans: [
          {
            scope: { name: scopeName },
            spans: [...spans.map(requestSpanToOtlp), ...childSpans.map(childSpanToOtlp)]
          }
        ]
      }
    ]
  }
}

export function exportRequestToSpans(request: OtlpExportTraceServiceRequest): {
  spans: RequestSpan[]
  childSpans: ChildSpan[]
} {
  const spans: RequestSpan[] = []
  const childSpans: ChildSpan[] = []
  for (const resourceSpan of request.resourceSpans) {
    for (const scopeSpan of resourceSpan.scopeSpans) {
      for (const otlpSpan of scopeSpan.spans) {
        const durationMillis = nanoToMillis(otlpSpan.endTimeUnixNano) - nanoToMillis(otlpSpan.startTimeUnixNano)
        const startMillis = nanoToMillis(otlpSpan.startTimeUnixNano)
        if (otlpSpan.kind === 2 || otlpSpan.kind === 5) {
          const method = findString(otlpSpan.attributes, 'http.request.method', 'http.method') ?? 'GET'
          const routePattern = findString(otlpSpan.attributes, 'http.route') ?? null
          const path = findString(otlpSpan.attributes, 'url.path', 'http.target', 'http.url') ?? otlpSpan.name
          const statusCode = findInt(otlpSpan.attributes, 'http.response.status_code', 'http.status_code') ?? 0
          const requestSpan: RequestSpan = {
            id: otlpSpan.spanId,
            traceId: otlpSpan.traceId,
            method,
            routePattern,
            actualPath: path,
            statusCode,
            timing: { start: startMillis, ttfb: null, duration: durationMillis },
            framework: findString(otlpSpan.attributes, 'apiscope.framework') ?? 'otlp',
            runtime: (findString(otlpSpan.attributes, 'apiscope.runtime') as RequestSpan['runtime']) ?? 'node'
          }
          if (otlpSpan.parentSpanId !== undefined) requestSpan.parentSpanId = otlpSpan.parentSpanId
          const loadRunId = findString(otlpSpan.attributes, 'apiscope.load_run_id')
          if (loadRunId !== undefined) requestSpan.loadRunId = loadRunId
          if (otlpSpan.status?.code === 2) {
            requestSpan.error = { message: otlpSpan.status.message ?? 'error' }
          }
          spans.push(requestSpan)
        } else {
          const method = findString(otlpSpan.attributes, 'http.request.method', 'http.method') ?? 'GET'
          const url = findString(otlpSpan.attributes, 'url.full', 'url.path', 'db.query.text', 'db.statement') ?? otlpSpan.name
          const statusCode = findInt(otlpSpan.attributes, 'http.response.status_code', 'http.status_code') ?? null
          childSpans.push({
            id: otlpSpan.spanId,
            parentSpanId: otlpSpan.parentSpanId ?? '',
            traceId: otlpSpan.traceId,
            kind: 'fetch',
            url,
            method,
            statusCode,
            timing: { start: startMillis, ttfb: null, duration: durationMillis }
          })
        }
      }
    }
  }
  return { spans, childSpans }
}
