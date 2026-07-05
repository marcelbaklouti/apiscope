import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useHashRoute } from '../lib/router'
import { useDashboardStore } from '../lib/store'
import type { Child, NPlusOneGroup, Span, SpanDetail } from '../lib/types'

function waterfallRowLabel(child: Child): string {
  return child.kind === 'db' ? `${child.system} · ${child.statement}` : `${child.method} ${child.url}`
}

function Waterfall({ span, childSpans }: { span: Span; childSpans: Child[] }) {
  const total = Math.max(span.timing.duration, 1)
  const rows = [
    { label: `${span.method} ${span.actualPath}`, start: 0, duration: span.timing.duration, root: true, kind: 'root' as const, child: null as Child | null },
    ...childSpans.map((child) => ({
      label: waterfallRowLabel(child),
      start: Math.max(0, child.timing.start - span.timing.start),
      duration: child.timing.duration,
      root: false,
      kind: child.kind,
      child
    }))
  ]
  return (
    <div data-testid="waterfall">
      {rows.map((row, index) => (
        <div
          key={index}
          data-testid={row.kind === 'db' ? 'waterfall-row-db' : row.kind === 'fetch' ? 'waterfall-row-fetch' : 'waterfall-row-root'}
          style={{ display: 'grid', gridTemplateColumns: '260px 1fr 70px 60px', gap: 8, alignItems: 'center' }}
        >
          <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {row.label}
          </span>
          <div style={{ position: 'relative', height: 10, background: 'var(--bg)' }}>
            <div
              style={{
                position: 'absolute',
                left: `${(row.start / total) * 100}%`,
                width: `${Math.max((row.duration / total) * 100, 0.5)}%`,
                top: 2,
                bottom: 2,
                background: row.root ? 'var(--text-dim)' : row.kind === 'db' ? 'var(--accent)' : 'var(--status-3xx)'
              }}
            />
          </div>
          <span className="num">{row.duration.toFixed(1)}ms</span>
          <span className="num" style={{ color: 'var(--text-dim)' }}>
            {row.child?.kind === 'db' && row.child.rowCount !== null ? `${row.child.rowCount} rows` : ''}
          </span>
        </div>
      ))}
    </div>
  )
}

function NPlusOneBanner({ groups }: { groups: NPlusOneGroup[] }) {
  if (groups.length === 0) return null
  return (
    <div className="banner" data-kind="warn" data-testid="n-plus-one-banner">
      {groups.map((group, index) => (
        <div key={index} className="mono">
          n+1: {group.count}× {group.system} · {group.template}
        </div>
      ))}
    </div>
  )
}

function PayloadCard({ title, payload }: { title: string; payload: Span['request'] }) {
  if (payload === undefined) return null
  return (
    <section className="card">
      <h3>
        {title}
        {payload.redactedHeaders.length > 0 && (
          <span className="metric" style={{ color: 'var(--status-4xx)', marginLeft: 8 }}>
            {payload.redactedHeaders.length} redacted
          </span>
        )}
        {payload.truncated && (
          <span className="metric" style={{ color: 'var(--status-4xx)', marginLeft: 8 }}>
            truncated
          </span>
        )}
      </h3>
      <table>
        <tbody>
          {Object.entries(payload.headers).map(([name, value]) => (
            <tr key={name}>
              <td className="mono">{name}</td>
              <td className="mono">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {payload.body !== undefined && <pre className="mono">{payload.body}</pre>}
    </section>
  )
}

export function Inspector({ spanId, loadRunId = null }: { spanId: string | null; loadRunId?: string | null }) {
  const liveSpans = useDashboardStore((state) => state.spans)
  const { navigate } = useHashRoute()
  const [detail, setDetail] = useState<SpanDetail | null>(null)
  const [methodFilter, setMethodFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [runSpans, setRunSpans] = useState<Span[] | null>(null)

  useEffect(() => {
    if (loadRunId === null) {
      setRunSpans(null)
      return
    }
    void api
      .spansByLoadRun(loadRunId)
      .then(setRunSpans)
      .catch(() => setRunSpans([]))
  }, [loadRunId])

  const spans = loadRunId === null ? liveSpans : (runSpans ?? [])

  useEffect(() => {
    if (spanId === null) {
      setDetail(null)
      return
    }
    void api.spanById(spanId).then(setDetail).catch(() => setDetail(null))
  }, [spanId])

  const filtered = spans.filter(
    (span) =>
      (methodFilter === '' || span.method === methodFilter) &&
      (statusFilter === '' || String(span.statusCode).startsWith(statusFilter))
  )

  const inspectorPathFor = (nextSpanId: string): string =>
    loadRunId === null ? `/inspector/${nextSpanId}` : `/inspector/run/${loadRunId}/${nextSpanId}`

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return
      if (event.key !== 'j' && event.key !== 'k') return
      const currentIndex = filtered.findIndex((span) => span.id === spanId)
      const nextIndex = event.key === 'j' ? Math.min(currentIndex + 1, filtered.length - 1) : Math.max(currentIndex - 1, 0)
      const next = filtered[nextIndex]
      if (next !== undefined) navigate(inspectorPathFor(next.id))
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [filtered, spanId, navigate, loadRunId])

  if (loadRunId !== null && runSpans === null) return <div className="empty">loading spans for this run</div>
  if (spans.length === 0) {
    return (
      <div className="empty">
        {loadRunId === null ? 'no requests captured yet' : 'no spans found for this run'}
      </div>
    )
  }

  return (
    <div className="grid-2">
      <section>
        {loadRunId !== null && (
          <p className="metric" data-testid="load-run-filter">
            filtered to load run {loadRunId}
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <select aria-label="method filter" value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)}>
            <option value="">all methods</option>
            {[...new Set(spans.map((span) => span.method))].map((method) => (
              <option key={method}>{method}</option>
            ))}
          </select>
          <input
            aria-label="status filter"
            placeholder="status prefix, e.g. 5"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          />
        </div>
        <table data-testid="span-list">
          <thead>
            <tr>
              <th>method</th>
              <th>path</th>
              <th className="num">status</th>
              <th className="num">duration</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 100).map((span) => (
              <tr
                key={span.id}
                data-selected={span.id === spanId}
                onClick={() => navigate(inspectorPathFor(span.id))}
                style={{ cursor: 'pointer' }}
              >
                <td className="mono">{span.method}</td>
                <td className="mono">{span.actualPath}</td>
                <td className="num" style={{ color: span.statusCode >= 500 ? 'var(--status-5xx)' : undefined }}>
                  {span.statusCode}
                </td>
                <td className="num">{span.timing.duration.toFixed(1)}ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        {detail === null ? (
          <div className="empty">select a request (j/k to move)</div>
        ) : (
          <div>
            <h2 className="mono" data-testid="span-detail-title">
              {detail.span.method} {detail.span.actualPath} → {detail.span.statusCode}
            </h2>
            <p className="metric">
              pattern {detail.span.routePattern ?? 'unmatched'} · {detail.span.framework}/{detail.span.runtime} ·{' '}
              {detail.span.timing.duration.toFixed(1)}ms
            </p>
            {detail.span.error !== undefined && (
              <div className="banner" data-kind="error">
                {detail.span.error.message}
              </div>
            )}
            <NPlusOneBanner groups={detail.nPlusOne} />
            <Waterfall span={detail.span} childSpans={detail.childSpans} />
            <PayloadCard title="request" payload={detail.span.request} />
            <PayloadCard title="response" payload={detail.span.response} />
          </div>
        )}
      </section>
    </div>
  )
}
