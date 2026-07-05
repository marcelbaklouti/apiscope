import type { Child, RouteEntry, RouteStatsEntry, RunDetail, RunSummary, Span } from './types'

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`${path} failed with ${response.status}`)
  return (await response.json()) as T
}

export const api = {
  spans: (limit = 200) => getJson<Span[]>(`/api/spans?limit=${limit}`),
  spanById: (id: string) => getJson<{ span: Span; childSpans: Child[] }>(`/api/spans/${encodeURIComponent(id)}`),
  routes: () => getJson<RouteEntry[]>('/api/routes'),
  routeStats: () => getJson<RouteStatsEntry[]>('/api/route-stats'),
  runs: () => getJson<RunSummary[]>('/api/load-runs'),
  runById: (id: string) => getJson<RunDetail>(`/api/load-runs/${encodeURIComponent(id)}`),
  meta: () => getJson<{ meta: unknown }>('/api/meta'),
  startRun: async (body: unknown): Promise<{ runId: string }> => {
    const response = await fetch('/api/load-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!response.ok) throw new Error(((await response.json()) as { error: string }).error)
    return (await response.json()) as { runId: string }
  }
}
