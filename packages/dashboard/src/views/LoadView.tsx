import { useMemo, useState } from 'react'
import { api } from '../lib/api'
import { useDashboardStore } from '../lib/store'
import { useHashRoute } from '../lib/router'

interface BuilderState {
  name: string
  baseUrl: string
  method: string
  path: string
  rps: number
  durationMs: number
  warmupMs: number
  p95MaxMs: string
}

function scenarioFrom(builder: BuilderState) {
  return {
    name: builder.name,
    baseUrl: builder.baseUrl,
    targets: [{ method: builder.method, path: builder.path }],
    model: { kind: 'open' as const, phases: [{ durationMs: builder.durationMs, rps: builder.rps }] },
    warmupMs: builder.warmupMs
  }
}

function configCode(builder: BuilderState): string {
  const assertions = builder.p95MaxMs === '' ? '' : `,\n        assertions: { p95MaxMs: ${builder.p95MaxMs} }`
  const scenarioJson = JSON.stringify(scenarioFrom(builder), null, 2)
    .split('\n')
    .join('\n        ')
  return `import { defineConfig } from '@apiscope/cli'

export default defineConfig({
  ci: {
    readiness: { url: '${builder.baseUrl}/health' },
    scenarios: [
      {
        scenario: ${scenarioJson}${assertions}
      }
    ]
  }
})
`
}

export function LoadView() {
  const [builder, setBuilder] = useState<BuilderState>({
    name: 'smoke',
    baseUrl: 'http://127.0.0.1:3000',
    method: 'GET',
    path: '/',
    rps: 50,
    durationMs: 10000,
    warmupMs: 1000,
    p95MaxMs: ''
  })
  const [error, setError] = useState<string | null>(null)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const progress = useDashboardStore((state) => (activeRunId === null ? undefined : state.progressByRun[activeRunId]))
  const { navigate } = useHashRoute()
  const code = useMemo(() => configCode(builder), [builder])

  const update = (patch: Partial<BuilderState>) => setBuilder((current) => ({ ...current, ...patch }))

  const start = async () => {
    setError(null)
    try {
      const { runId } = await api.startRun({
        scenario: scenarioFrom(builder),
        ...(builder.p95MaxMs === '' ? {} : { assertions: { p95MaxMs: Number(builder.p95MaxMs) } })
      })
      setActiveRunId(runId)
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : String(startError))
    }
  }

  return (
    <div className="grid-2">
      <section className="card">
        <h2>scenario builder</h2>
        <div style={{ display: 'grid', gap: 8 }}>
          <label>
            name <input value={builder.name} onChange={(event) => update({ name: event.target.value })} />
          </label>
          <label>
            base url <input value={builder.baseUrl} onChange={(event) => update({ baseUrl: event.target.value })} />
          </label>
          <label>
            method{' '}
            <select value={builder.method} onChange={(event) => update({ method: event.target.value })}>
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'QUERY'].map((method) => (
                <option key={method}>{method}</option>
              ))}
            </select>
          </label>
          <label>
            path <input value={builder.path} onChange={(event) => update({ path: event.target.value })} />
          </label>
          <label>
            rps{' '}
            <input type="number" value={builder.rps} onChange={(event) => update({ rps: Number(event.target.value) })} />
          </label>
          <label>
            duration ms{' '}
            <input
              type="number"
              value={builder.durationMs}
              onChange={(event) => update({ durationMs: Number(event.target.value) })}
            />
          </label>
          <label>
            warmup ms{' '}
            <input
              type="number"
              value={builder.warmupMs}
              onChange={(event) => update({ warmupMs: Number(event.target.value) })}
            />
          </label>
          <label>
            p95 budget ms{' '}
            <input value={builder.p95MaxMs} onChange={(event) => update({ p95MaxMs: event.target.value })} />
          </label>
          <button className="primary" onClick={() => void start()} data-testid="start-run">
            start run
          </button>
          {error !== null && (
            <div className="banner" data-kind="error">
              {error}
            </div>
          )}
        </div>
        {progress !== undefined && (
          <div style={{ marginTop: 12 }} data-testid="live-run">
            <h3>{progress.finished ? (progress.ok ? 'finished' : 'aborted') : 'running'}</h3>
            <p className="metric">
              {progress.snapshot.totalRequests} requests · {progress.snapshot.errorCount} errors · p95{' '}
              {progress.snapshot.latencyP95.toFixed(1)}ms
            </p>
            {progress.finished && activeRunId !== null && (
              <button onClick={() => navigate(`/runs/${activeRunId}`)}>open result</button>
            )}
          </div>
        )}
      </section>
      <section className="card">
        <h2>apiscope.config.ts</h2>
        <p>the config file stays the source of truth — copy this into your repo</p>
        <pre className="mono" data-testid="config-code">
          {code}
        </pre>
        <button onClick={() => void navigator.clipboard.writeText(code)}>copy</button>
      </section>
    </div>
  )
}
