import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Link } from '../lib/router'
import type { RunDetail, RunSummary } from '../lib/types'

function LatencyTable({ detail }: { detail: RunDetail }) {
  const { latency } = detail.result
  const rows: Array<[string, number]> = [
    ['p50', latency.p50],
    ['p90', latency.p90],
    ['p95', latency.p95],
    ['p99', latency.p99],
    ['p999', latency.p999],
    ['mean', latency.mean],
    ['max', latency.max]
  ]
  return (
    <table>
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <td>{label}</td>
            <td className="num">{value.toFixed(1)}ms</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function Runs({ runId }: { runId: string | null }) {
  const [runs, setRuns] = useState<RunSummary[]>([])
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [compareId, setCompareId] = useState('')
  const [compare, setCompare] = useState<RunDetail | null>(null)

  useEffect(() => {
    void api.runs().then(setRuns).catch(() => setRuns([]))
  }, [runId])

  useEffect(() => {
    if (runId === null) {
      setDetail(null)
      return
    }
    void api.runById(runId).then(setDetail).catch(() => setDetail(null))
  }, [runId])

  useEffect(() => {
    if (compareId === '') {
      setCompare(null)
      return
    }
    void api.runById(compareId).then(setCompare).catch(() => setCompare(null))
  }, [compareId])

  if (runs.length === 0) return <div className="empty">no load runs yet — start one in the load view</div>

  return (
    <div className="grid-2">
      <section>
        <table>
          <thead>
            <tr>
              <th>name</th>
              <th className="num">started</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} data-selected={run.id === runId}>
                <td>
                  <Link to={`/runs/${run.id}`}>{run.name}</Link>
                </td>
                <td className="num">{new Date(run.startedAt).toLocaleTimeString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        {detail === null ? (
          <div className="empty">select a run</div>
        ) : (
          <div>
            <h2>
              {detail.name}
              {detail.result.aborted && (
                <span className="metric" style={{ color: 'var(--status-5xx)', marginLeft: 8 }}>
                  aborted
                </span>
              )}
              {detail.result.degraded && (
                <span className="metric" style={{ color: 'var(--status-4xx)', marginLeft: 8 }}>
                  degraded
                </span>
              )}
            </h2>
            <p className="metric">
              {detail.result.totalRequests} requests · {(detail.result.errorRate * 100).toFixed(2)}% errors ·{' '}
              {detail.result.achievedRps.toFixed(1)} rps achieved
              {detail.result.targetRps !== null && ` of ${detail.result.targetRps} target`}
            </p>
            <p className="metric">
              worker health: event loop lag p99 {detail.result.workerHealth.eventLoopLagP99Ms.toFixed(1)}ms · schedule
              deviation max {detail.result.workerHealth.maxScheduleDeviationMs.toFixed(1)}ms
            </p>
            <LatencyTable detail={detail} />
            <h3>per target</h3>
            <table>
              <tbody>
                {detail.result.perTarget.map((target) => (
                  <tr key={target.label}>
                    <td className="mono">{target.label}</td>
                    <td className="num">{target.count}</td>
                    <td className="num">{target.p95.toFixed(1)}ms p95</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>compare with</h3>
            <select value={compareId} onChange={(event) => setCompareId(event.target.value)}>
              <option value="">none</option>
              {runs
                .filter((run) => run.id !== detail.id)
                .map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.name} {new Date(run.startedAt).toLocaleTimeString()}
                  </option>
                ))}
            </select>
            {compare !== null && (
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th className="num">{detail.name}</th>
                    <th className="num">{compare.name}</th>
                    <th className="num">delta</th>
                  </tr>
                </thead>
                <tbody>
                  {(['p50', 'p95', 'p99'] as const).map((quantile) => (
                    <tr key={quantile}>
                      <td>{quantile}</td>
                      <td className="num">{detail.result.latency[quantile].toFixed(1)}ms</td>
                      <td className="num">{compare.result.latency[quantile].toFixed(1)}ms</td>
                      <td
                        className="num"
                        style={{
                          color:
                            detail.result.latency[quantile] > compare.result.latency[quantile]
                              ? 'var(--status-5xx)'
                              : 'var(--status-2xx)'
                        }}
                      >
                        {(detail.result.latency[quantile] - compare.result.latency[quantile]).toFixed(1)}ms
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
