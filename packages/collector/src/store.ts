import { renameSync } from 'node:fs'
import Database from 'better-sqlite3'
import type { ChildSpan, RequestSpan, RouteRegistryEntry } from '@apiscope/core'
import type { RouteStats, SpanStore, StoredLoadRun, StoredLoadRunSummary } from './store-interface'

interface SpanRow {
  id: string
  trace_id: string
  parent_span_id: string | null
  load_run_id: string | null
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

interface ChildSpanRow {
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
}

const schema = `
CREATE TABLE IF NOT EXISTS spans (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  parent_span_id TEXT,
  load_run_id TEXT,
  method TEXT NOT NULL,
  route_pattern TEXT,
  actual_path TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  start_time REAL NOT NULL,
  ttfb REAL,
  duration REAL NOT NULL,
  framework TEXT NOT NULL,
  runtime TEXT NOT NULL,
  error_json TEXT,
  request_json TEXT,
  response_json TEXT,
  app_name TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spans_route ON spans(route_pattern, method);
CREATE INDEX IF NOT EXISTS idx_spans_duration ON spans(duration);
CREATE TABLE IF NOT EXISTS child_spans (
  id TEXT PRIMARY KEY,
  parent_span_id TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  url TEXT NOT NULL,
  method TEXT NOT NULL,
  status_code INTEGER,
  start_time REAL NOT NULL,
  ttfb REAL,
  duration REAL NOT NULL,
  error_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_child_parent ON child_spans(parent_span_id);
CREATE TABLE IF NOT EXISTS routes (
  app_name TEXT NOT NULL,
  method TEXT NOT NULL,
  pattern TEXT NOT NULL,
  source_file TEXT,
  PRIMARY KEY (app_name, method, pattern)
);
CREATE TABLE IF NOT EXISTS load_runs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  scenario_json TEXT NOT NULL,
  result_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_load_runs_started ON load_runs(started_at DESC);
`

function rowToSpan(row: SpanRow): RequestSpan {
  const span: RequestSpan = {
    id: row.id,
    traceId: row.trace_id,
    method: row.method,
    routePattern: row.route_pattern,
    actualPath: row.actual_path,
    statusCode: row.status_code,
    timing: { start: row.start_time, ttfb: row.ttfb, duration: row.duration },
    framework: row.framework,
    runtime: row.runtime as RequestSpan['runtime']
  }
  if (row.parent_span_id !== null) span.parentSpanId = row.parent_span_id
  if (row.load_run_id !== null) span.loadRunId = row.load_run_id
  if (row.error_json !== null) span.error = JSON.parse(row.error_json)
  if (row.request_json !== null) span.request = JSON.parse(row.request_json)
  if (row.response_json !== null) span.response = JSON.parse(row.response_json)
  return span
}

function rowToChildSpan(row: ChildSpanRow): ChildSpan {
  const childSpan: ChildSpan = {
    id: row.id,
    parentSpanId: row.parent_span_id,
    traceId: row.trace_id,
    kind: 'fetch',
    url: row.url,
    method: row.method,
    statusCode: row.status_code,
    timing: { start: row.start_time, ttfb: row.ttfb, duration: row.duration }
  }
  if (row.error_json !== null) childSpan.error = JSON.parse(row.error_json)
  return childSpan
}

function isHealthy(db: Database.Database): boolean {
  const result = db.pragma('integrity_check') as Array<{ integrity_check: string }>
  return result[0]?.integrity_check === 'ok'
}

function openDatabase(dbPath: string): { db: Database.Database; recovered: boolean } {
  if (dbPath === ':memory:') return { db: new Database(dbPath), recovered: false }
  try {
    const db = new Database(dbPath)
    if (isHealthy(db)) return { db, recovered: false }
    db.close()
  } catch {
  }
  renameSync(dbPath, `${dbPath}.corrupt-${Date.now()}`)
  return { db: new Database(dbPath), recovered: true }
}

export class SqliteSpanStore implements SpanStore {
  private readonly db: Database.Database
  private readonly retentionRows: number
  readonly recoveredFromCorruption: boolean

  constructor(dbPath: string, options: { retentionRows?: number } = {}) {
    const opened = openDatabase(dbPath)
    this.db = opened.db
    this.recoveredFromCorruption = opened.recovered
    this.db.pragma('journal_mode = WAL')
    this.db.exec(schema)
    this.retentionRows = options.retentionRows ?? 50000
  }

  async init(): Promise<void> {}

  async insertBatch(appName: string, batch: { spans: RequestSpan[]; childSpans: ChildSpan[] }): Promise<void> {
    const insertSpan = this.db.prepare(
      `INSERT OR REPLACE INTO spans
       (id, trace_id, parent_span_id, load_run_id, method, route_pattern, actual_path, status_code, start_time, ttfb, duration, framework, runtime, error_json, request_json, response_json, app_name)
       VALUES (@id, @traceId, @parentSpanId, @loadRunId, @method, @routePattern, @actualPath, @statusCode, @start, @ttfb, @duration, @framework, @runtime, @errorJson, @requestJson, @responseJson, @appName)`
    )
    const insertChild = this.db.prepare(
      `INSERT OR REPLACE INTO child_spans
       (id, parent_span_id, trace_id, kind, url, method, status_code, start_time, ttfb, duration, error_json)
       VALUES (@id, @parentSpanId, @traceId, @kind, @url, @method, @statusCode, @start, @ttfb, @duration, @errorJson)`
    )
    const dropOldest = this.db.prepare(
      `DELETE FROM spans WHERE rowid IN (SELECT rowid FROM spans ORDER BY rowid ASC LIMIT ?) RETURNING id`
    )
    const dropChildren = this.db.prepare(`DELETE FROM child_spans WHERE parent_span_id = ?`)
    const countSpans = this.db.prepare(`SELECT COUNT(*) AS total FROM spans`)
    const transaction = this.db.transaction(() => {
      for (const span of batch.spans) {
        insertSpan.run({
          id: span.id,
          traceId: span.traceId,
          parentSpanId: span.parentSpanId ?? null,
          loadRunId: span.loadRunId ?? null,
          method: span.method,
          routePattern: span.routePattern,
          actualPath: span.actualPath,
          statusCode: span.statusCode,
          start: span.timing.start,
          ttfb: span.timing.ttfb,
          duration: span.timing.duration,
          framework: span.framework,
          runtime: span.runtime,
          errorJson: span.error === undefined ? null : JSON.stringify(span.error),
          requestJson: span.request === undefined ? null : JSON.stringify(span.request),
          responseJson: span.response === undefined ? null : JSON.stringify(span.response),
          appName
        })
      }
      for (const childSpan of batch.childSpans) {
        insertChild.run({
          id: childSpan.id,
          parentSpanId: childSpan.parentSpanId,
          traceId: childSpan.traceId,
          kind: childSpan.kind,
          url: childSpan.url,
          method: childSpan.method,
          statusCode: childSpan.statusCode,
          start: childSpan.timing.start,
          ttfb: childSpan.timing.ttfb,
          duration: childSpan.timing.duration,
          errorJson: childSpan.error === undefined ? null : JSON.stringify(childSpan.error)
        })
      }
      const total = (countSpans.get() as { total: number }).total
      const excess = total - this.retentionRows
      if (excess > 0) {
        const removed = dropOldest.all(excess) as Array<{ id: string }>
        for (const entry of removed) dropChildren.run(entry.id)
      }
    })
    transaction()
  }

  async replaceRoutes(appName: string, routes: RouteRegistryEntry[]): Promise<void> {
    const clear = this.db.prepare(`DELETE FROM routes WHERE app_name = ?`)
    const insert = this.db.prepare(
      `INSERT INTO routes (app_name, method, pattern, source_file) VALUES (@appName, @method, @pattern, @sourceFile)`
    )
    const transaction = this.db.transaction(() => {
      clear.run(appName)
      for (const route of routes) {
        insert.run({ appName, method: route.method, pattern: route.pattern, sourceFile: route.sourceFile ?? null })
      }
    })
    transaction()
  }

  async listRoutes(): Promise<Array<{ appName: string } & RouteRegistryEntry>> {
    const rows = this.db
      .prepare(`SELECT app_name, method, pattern, source_file FROM routes ORDER BY app_name, pattern, method`)
      .all() as Array<{ app_name: string; method: string; pattern: string; source_file: string | null }>
    return rows.map((row) => {
      const entry: { appName: string } & RouteRegistryEntry = {
        appName: row.app_name,
        method: row.method,
        pattern: row.pattern
      }
      if (row.source_file !== null) entry.sourceFile = row.source_file
      return entry
    })
  }

  async recentSpans(limit: number): Promise<RequestSpan[]> {
    const rows = this.db
      .prepare(`SELECT * FROM spans ORDER BY rowid DESC LIMIT ?`)
      .all(limit) as SpanRow[]
    return rows.map(rowToSpan)
  }

  async spansByLoadRun(loadRunId: string, limit: number): Promise<RequestSpan[]> {
    const rows = this.db
      .prepare(`SELECT * FROM spans WHERE load_run_id = ? ORDER BY rowid DESC LIMIT ?`)
      .all(loadRunId, limit) as SpanRow[]
    return rows.map(rowToSpan)
  }

  async spanById(id: string): Promise<{ span: RequestSpan; childSpans: ChildSpan[] } | null> {
    const row = this.db.prepare(`SELECT * FROM spans WHERE id = ?`).get(id) as SpanRow | undefined
    if (row === undefined) return null
    const childRows = this.db
      .prepare(`SELECT * FROM child_spans WHERE parent_span_id = ? ORDER BY start_time ASC`)
      .all(id) as ChildSpanRow[]
    return { span: rowToSpan(row), childSpans: childRows.map(rowToChildSpan) }
  }

  async routeStats(): Promise<RouteStats[]> {
    const groups = this.db
      .prepare(
        `SELECT route_pattern, method, COUNT(*) AS count, SUM(CASE WHEN status_code >= 500 THEN 1 ELSE 0 END) AS errorCount
         FROM spans GROUP BY route_pattern, method ORDER BY count DESC`
      )
      .all() as Array<{ route_pattern: string | null; method: string; count: number; errorCount: number }>
    const percentileQuery = this.db.prepare(
      `SELECT duration FROM spans WHERE route_pattern IS ? AND method = ? ORDER BY duration ASC LIMIT 1 OFFSET ?`
    )
    const percentileOf = (pattern: string | null, method: string, count: number, quantile: number): number => {
      const offset = Math.min(count - 1, Math.ceil(quantile * count) - 1)
      const row = percentileQuery.get(pattern, method, Math.max(0, offset)) as { duration: number } | undefined
      return row?.duration ?? 0
    }
    return groups.map((group) => ({
      routePattern: group.route_pattern,
      method: group.method,
      count: group.count,
      errorCount: group.errorCount,
      p50: percentileOf(group.route_pattern, group.method, group.count, 0.5),
      p95: percentileOf(group.route_pattern, group.method, group.count, 0.95),
      p99: percentileOf(group.route_pattern, group.method, group.count, 0.99)
    }))
  }

  async insertLoadRun(run: StoredLoadRun): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO load_runs (id, name, started_at, scenario_json, result_json)
         VALUES (@id, @name, @startedAt, @scenarioJson, @resultJson)`
      )
      .run(run)
  }

  async listLoadRuns(): Promise<StoredLoadRunSummary[]> {
    return this.db
      .prepare(`SELECT id, name, started_at AS startedAt FROM load_runs ORDER BY started_at DESC`)
      .all() as StoredLoadRunSummary[]
  }

  async loadRunById(id: string): Promise<StoredLoadRun | null> {
    const row = this.db
      .prepare(
        `SELECT id, name, started_at AS startedAt, scenario_json AS scenarioJson, result_json AS resultJson
         FROM load_runs WHERE id = ?`
      )
      .get(id) as StoredLoadRun | undefined
    return row ?? null
  }

  async close(): Promise<void> {
    this.db.close()
  }
}
