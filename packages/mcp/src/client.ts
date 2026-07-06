export interface QuerySpansParams {
  limit?: number
  loadRunId?: string
}

export interface StartLoadRunBody {
  scenario: unknown
  assertions?: unknown
}

export interface GenerateScenarioParams {
  baseUrl: string
  windowMs?: number
  shape?: string
}

export interface CollectorClient {
  listRoutes(): Promise<unknown[]>
  querySpans(params: QuerySpansParams): Promise<unknown[]>
  getSpan(id: string): Promise<unknown>
  startLoadRun(body: StartLoadRunBody): Promise<{ runId: string }>
  getRun(id: string): Promise<unknown>
  generateScenario(params: GenerateScenarioParams): Promise<unknown>
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init)
  const body: unknown = await response.json()
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body && typeof (body as { error: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `request to ${url} failed with status ${response.status}`
    throw new Error(message)
  }
  return body
}

export function createCollectorClient(baseUrl: string): CollectorClient {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl

  return {
    async listRoutes() {
      return fetchJson(`${normalizedBaseUrl}/api/routes`) as Promise<unknown[]>
    },
    async querySpans(params) {
      const searchParams = new URLSearchParams()
      if (params.limit !== undefined) searchParams.set('limit', String(params.limit))
      if (params.loadRunId !== undefined) searchParams.set('loadRunId', params.loadRunId)
      const query = searchParams.toString()
      return fetchJson(`${normalizedBaseUrl}/api/spans${query === '' ? '' : `?${query}`}`) as Promise<unknown[]>
    },
    async getSpan(id) {
      return fetchJson(`${normalizedBaseUrl}/api/spans/${encodeURIComponent(id)}`)
    },
    async startLoadRun(body) {
      return fetchJson(`${normalizedBaseUrl}/api/load-runs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      }) as Promise<{ runId: string }>
    },
    async getRun(id) {
      return fetchJson(`${normalizedBaseUrl}/api/load-runs/${encodeURIComponent(id)}`)
    },
    async generateScenario(params) {
      const searchParams = new URLSearchParams({ baseUrl: params.baseUrl })
      if (params.windowMs !== undefined) searchParams.set('windowMs', String(params.windowMs))
      if (params.shape !== undefined) searchParams.set('shape', params.shape)
      return fetchJson(`${normalizedBaseUrl}/api/scenario?${searchParams.toString()}`)
    }
  }
}
