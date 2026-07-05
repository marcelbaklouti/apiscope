import { createClient, type ClickHouseClient } from '@clickhouse/client'
import type { ChildSpan, RequestSpan, RouteRegistryEntry } from '@apiscope/core'
import type {
  RouteStats,
  SpanStore,
  StoredLoadRun,
  StoredLoadRunSummary
} from '@apiscope/collector'
import { schemaStatements } from './schema'

export interface ClickHouseStoreOptions {
  url: string
  username?: string
  password?: string
  database?: string
  retentionDays?: number
  syncInserts?: boolean
}

interface SpanRow {
  id: string
  trace_id: string
  method: string
  route_pattern: string | null
  actual_path: string
  status_code: number
  start_time: number
  ttfb: number | null
  duration: number
  framework: string
  runtime: string
  error_json: string | null
  request_json: string | null
  response_json: string | null
}

function rowToSpan(row: SpanRow): RequestSpan {
  const span: RequestSpan = {
    id: row.id,
    traceId: row.trace_id,
    method: row.method,
    routePattern: row.route_pattern,
    actualPath: row.actual_path,
    statusCode: Number(row.status_code),
    timing: { start: Number(row.start_time), ttfb: row.ttfb === null ? null : Number(row.ttfb), duration: Number(row.duration) },
    framework: row.framework,
    runtime: row.runtime as RequestSpan['runtime']
  }
  if (row.error_json !== null) span.error = JSON.parse(row.error_json)
  if (row.request_json !== null) span.request = JSON.parse(row.request_json)
  if (row.response_json !== null) span.response = JSON.parse(row.response_json)
  return span
}

export class ClickHouseSpanStore implements SpanStore {
  readonly recoveredFromCorruption = false
  private readonly client: ClickHouseClient
  private readonly database: string
  private readonly retentionDays: number

  constructor(options: ClickHouseStoreOptions) {
    this.database = options.database ?? 'apiscope'
    this.retentionDays = options.retentionDays ?? 30
    this.client = createClient({
      url: options.url,
      ...(options.username === undefined ? {} : { username: options.username }),
      ...(options.password === undefined ? {} : { password: options.password }),
      clickhouse_settings:
        options.syncInserts === true
          ? { async_insert: 0 }
          : { async_insert: 1, wait_for_async_insert: 0 }
    })
  }

  async init(): Promise<void> {
    for (const statement of schemaStatements(this.database, this.retentionDays)) {
      await this.client.command({ query: statement })
    }
  }

  async insertBatch(appName: string, batch: { spans: RequestSpan[]; childSpans: ChildSpan[] }): Promise<void> {
    if (batch.spans.length > 0) {
      await this.client.insert({
        table: `${this.database}.spans`,
        format: 'JSONEachRow',
        values: batch.spans.map((span) => ({
          id: span.id,
          trace_id: span.traceId,
          method: span.method,
          route_pattern: span.routePattern,
          actual_path: span.actualPath,
          status_code: span.statusCode,
          start_time: span.timing.start,
          ttfb: span.timing.ttfb,
          duration: span.timing.duration,
          framework: span.framework,
          runtime: span.runtime,
          error_json: span.error === undefined ? null : JSON.stringify(span.error),
          request_json: span.request === undefined ? null : JSON.stringify(span.request),
          response_json: span.response === undefined ? null : JSON.stringify(span.response),
          app_name: appName
        }))
      })
    }
    if (batch.childSpans.length > 0) {
      await this.client.insert({
        table: `${this.database}.child_spans`,
        format: 'JSONEachRow',
        values: batch.childSpans.map((child) => ({
          id: child.id,
          parent_span_id: child.parentSpanId,
          trace_id: child.traceId,
          kind: child.kind,
          url: child.url,
          method: child.method,
          status_code: child.statusCode,
          start_time: child.timing.start,
          ttfb: child.timing.ttfb,
          duration: child.timing.duration,
          error_json: child.error === undefined ? null : JSON.stringify(child.error)
        }))
      })
    }
  }

  async replaceRoutes(appName: string, routes: RouteRegistryEntry[]): Promise<void> {
    await this.client.command({
      query: `ALTER TABLE ${this.database}.routes DELETE WHERE app_name = {appName:String}`,
      query_params: { appName }
    })
    if (routes.length > 0) {
      await this.client.insert({
        table: `${this.database}.routes`,
        format: 'JSONEachRow',
        values: routes.map((route) => ({
          app_name: appName,
          method: route.method,
          pattern: route.pattern,
          source_file: route.sourceFile ?? null
        }))
      })
    }
  }

  async listRoutes(): Promise<Array<{ appName: string } & RouteRegistryEntry>> {
    const result = await this.client.query({
      query: `SELECT app_name, method, pattern, source_file FROM ${this.database}.routes FINAL ORDER BY app_name, pattern, method`,
      format: 'JSONEachRow'
    })
    const rows = (await result.json()) as Array<{ app_name: string; method: string; pattern: string; source_file: string | null }>
    return rows.map((row) => {
      const entry: { appName: string } & RouteRegistryEntry = { appName: row.app_name, method: row.method, pattern: row.pattern }
      if (row.source_file !== null) entry.sourceFile = row.source_file
      return entry
    })
  }

  async recentSpans(limit: number): Promise<RequestSpan[]> {
    const result = await this.client.query({
      query: `SELECT * FROM ${this.database}.spans ORDER BY start_time DESC, id DESC LIMIT {limit:UInt32}`,
      query_params: { limit },
      format: 'JSONEachRow'
    })
    return ((await result.json()) as SpanRow[]).map(rowToSpan)
  }

  async spanById(id: string): Promise<{ span: RequestSpan; childSpans: ChildSpan[] } | null> {
    const spanResult = await this.client.query({
      query: `SELECT * FROM ${this.database}.spans WHERE id = {id:String} LIMIT 1`,
      query_params: { id },
      format: 'JSONEachRow'
    })
    const spanRows = (await spanResult.json()) as SpanRow[]
    const first = spanRows[0]
    if (first === undefined) return null
    const childResult = await this.client.query({
      query: `SELECT * FROM ${this.database}.child_spans WHERE parent_span_id = {id:String} ORDER BY start_time ASC`,
      query_params: { id },
      format: 'JSONEachRow'
    })
    const childRows = (await childResult.json()) as Array<{
      id: string
      parent_span_id: string
      trace_id: string
      kind: string
      url: string
      method: string
      status_code: number | null
      start_time: number
      ttfb: number | null
      duration: number
      error_json: string | null
    }>
    const childSpans: ChildSpan[] = childRows.map((row) => {
      const child: ChildSpan = {
        id: row.id,
        parentSpanId: row.parent_span_id,
        traceId: row.trace_id,
        kind: 'fetch',
        url: row.url,
        method: row.method,
        statusCode: row.status_code === null ? null : Number(row.status_code),
        timing: { start: Number(row.start_time), ttfb: row.ttfb === null ? null : Number(row.ttfb), duration: Number(row.duration) }
      }
      if (row.error_json !== null) child.error = JSON.parse(row.error_json)
      return child
    })
    return { span: rowToSpan(first), childSpans }
  }

  async routeStats(): Promise<RouteStats[]> {
    const result = await this.client.query({
      query: `SELECT route_pattern AS routePattern, method,
        count() AS count,
        countIf(status_code >= 500) AS errorCount,
        quantile(0.5)(duration) AS p50,
        quantile(0.95)(duration) AS p95,
        quantile(0.99)(duration) AS p99
        FROM ${this.database}.spans GROUP BY route_pattern, method ORDER BY count DESC`,
      format: 'JSONEachRow'
    })
    const rows = (await result.json()) as Array<{
      routePattern: string | null
      method: string
      count: string
      errorCount: string
      p50: number
      p95: number
      p99: number
    }>
    return rows.map((row) => ({
      routePattern: row.routePattern,
      method: row.method,
      count: Number(row.count),
      errorCount: Number(row.errorCount),
      p50: Number(row.p50),
      p95: Number(row.p95),
      p99: Number(row.p99)
    }))
  }

  async insertLoadRun(run: StoredLoadRun): Promise<void> {
    await this.client.insert({
      table: `${this.database}.load_runs`,
      format: 'JSONEachRow',
      values: [{ id: run.id, name: run.name, started_at: run.startedAt, scenario_json: run.scenarioJson, result_json: run.resultJson }]
    })
  }

  async listLoadRuns(): Promise<StoredLoadRunSummary[]> {
    const result = await this.client.query({
      query: `SELECT id, name, started_at AS startedAt FROM ${this.database}.load_runs ORDER BY started_at DESC`,
      format: 'JSONEachRow'
    })
    const rows = (await result.json()) as Array<{ id: string; name: string; startedAt: string }>
    return rows.map((row) => ({ id: row.id, name: row.name, startedAt: Number(row.startedAt) }))
  }

  async loadRunById(id: string): Promise<StoredLoadRun | null> {
    const result = await this.client.query({
      query: `SELECT id, name, started_at AS startedAt, scenario_json AS scenarioJson, result_json AS resultJson FROM ${this.database}.load_runs WHERE id = {id:String} LIMIT 1`,
      query_params: { id },
      format: 'JSONEachRow'
    })
    const rows = (await result.json()) as Array<{ id: string; name: string; startedAt: string; scenarioJson: string; resultJson: string }>
    const row = rows[0]
    if (row === undefined) return null
    return { id: row.id, name: row.name, startedAt: Number(row.startedAt), scenarioJson: row.scenarioJson, resultJson: row.resultJson }
  }

  async close(): Promise<void> {
    await this.client.close()
  }
}
