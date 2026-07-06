import type { ChildSpan, RequestSpan } from '@apiscope/core'
import type { IngestAuthenticator } from '../auth/ingest-auth'
import { readRawBody, sendJson, type DynamicHandler } from '../server'
import { exportRequestToSpans, type OtlpExportTraceServiceRequest, type OtlpResourceSpans } from './mapping'
import { decodeExportRequest } from './proto'

export interface OtlpHttpHandlerDeps {
  ingest(appName: string, spans: RequestSpan[], childSpans: ChildSpan[]): Promise<void>
  appName?: string
  ingestAuth?: IngestAuthenticator
  maxRequestBytes?: number
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

export function createOtlpHttpHandler(deps: OtlpHttpHandlerDeps): DynamicHandler {
  const fallbackAppName = deps.appName ?? 'otlp'
  return async (request, response, url) => {
    if (request.method !== 'POST' || url.pathname !== '/v1/traces') return false
    let boundAppName: string | undefined
    if (deps.ingestAuth !== undefined) {
      const identity = deps.ingestAuth.authenticate(request)
      if (identity === null) {
        sendJson(response, 401, { error: 'unauthorized' })
        return true
      }
      if (identity.appName !== '') boundAppName = identity.appName
    }
    const contentType = request.headers['content-type'] ?? ''
    const raw = await readRawBody(request, deps.maxRequestBytes)
    let exportRequest: OtlpExportTraceServiceRequest
    try {
      if (contentType.includes('application/x-protobuf')) {
        exportRequest = decodeExportRequest(raw)
      } else {
        exportRequest = JSON.parse(raw.toString('utf8')) as OtlpExportTraceServiceRequest
      }
    } catch {
      sendJson(response, 400, { error: 'invalid otlp export request' })
      return true
    }
    const groups = boundAppName === undefined ? groupByAppName(exportRequest, fallbackAppName) : new Map([[boundAppName, exportRequest]])
    for (const [appName, grouped] of groups) {
      const { spans, childSpans } = exportRequestToSpans(grouped)
      await deps.ingest(appName, spans, childSpans)
    }
    if (contentType.includes('application/x-protobuf')) {
      response.writeHead(200, { 'content-type': 'application/x-protobuf' })
      response.end()
    } else {
      sendJson(response, 200, {})
    }
    return true
  }
}
