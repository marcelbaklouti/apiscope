import type {
  DependencyGraph,
  GeneratedScenario,
  InsightsResponse,
  RouteEntry,
  RouteStatsEntry,
  RunDetail,
  RunSummary,
  Span,
  SpanDetail,
  StoredProfile
} from './types'

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`${path} failed with ${response.status}`)
  return (await response.json()) as T
}

export const api = {
  spans: (limit = 200) => getJson<Span[]>(`/api/spans?limit=${limit}`),
  spansByLoadRun: (loadRunId: string, limit = 200) =>
    getJson<Span[]>(`/api/spans?loadRunId=${encodeURIComponent(loadRunId)}&limit=${limit}`),
  spanById: (id: string) => getJson<SpanDetail>(`/api/spans/${encodeURIComponent(id)}`),
  routes: () => getJson<RouteEntry[]>('/api/routes'),
  routeStats: () => getJson<RouteStatsEntry[]>('/api/route-stats'),
  runs: () => getJson<RunSummary[]>('/api/load-runs'),
  runById: (id: string) => getJson<RunDetail>(`/api/load-runs/${encodeURIComponent(id)}`),
  meta: () => getJson<{ meta: unknown }>('/api/meta'),
  insights: () => getJson<InsightsResponse>('/api/insights'),
  startRun: async (body: unknown): Promise<{ runId: string }> => {
    const response = await fetch('/api/load-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!response.ok) throw new Error(((await response.json()) as { error: string }).error)
    return (await response.json()) as { runId: string }
  },
  startProfile: async (appName: string, durationMs: number): Promise<{ profileId: string }> => {
    const response = await fetch('/api/profiles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appName, durationMs })
    })
    if (!response.ok) throw new Error(((await response.json()) as { error: string }).error)
    return (await response.json()) as { profileId: string }
  },
  profileById: (id: string) => getJson<StoredProfile>(`/api/profiles/${encodeURIComponent(id)}`),
  profilePprofUrl: (id: string) => `/api/profiles/${encodeURIComponent(id)}/pprof`,
  dependencies: () => getJson<DependencyGraph>('/api/dependencies'),
  scenario: (params: { baseUrl: string; windowMs?: number; shape?: 'steady' | 'ramp' }) => {
    const query = new URLSearchParams({ baseUrl: params.baseUrl })
    if (params.windowMs !== undefined) query.set('windowMs', String(params.windowMs))
    if (params.shape !== undefined) query.set('shape', params.shape)
    return getJson<GeneratedScenario>(`/api/scenario?${query.toString()}`)
  }
}
