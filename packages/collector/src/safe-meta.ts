function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function pickString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

function pickNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' ? value : undefined
}

function pickBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key]
  return typeof value === 'boolean' ? value : undefined
}

function safeStorage(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  const driver = pickString(value, 'driver')
  if (driver === undefined) return undefined
  const safe: Record<string, unknown> = { driver }
  const retentionRows = pickNumber(value, 'retentionRows')
  if (retentionRows !== undefined) safe['retentionRows'] = retentionRows
  const database = pickString(value, 'database')
  if (database !== undefined) safe['database'] = database
  const retentionDays = pickNumber(value, 'retentionDays')
  if (retentionDays !== undefined) safe['retentionDays'] = retentionDays
  return safe
}

function safeCollector(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  const safe: Record<string, unknown> = {}
  const host = pickString(value, 'host')
  if (host !== undefined) safe['host'] = host
  const port = pickNumber(value, 'port')
  if (port !== undefined) safe['port'] = port
  const retentionRows = pickNumber(value, 'retentionRows')
  if (retentionRows !== undefined) safe['retentionRows'] = retentionRows
  const storage = safeStorage(value['storage'])
  if (storage !== undefined) safe['storage'] = storage
  return Object.keys(safe).length === 0 ? undefined : safe
}

function safeIngestAuth(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  const mode = pickString(value, 'mode')
  if (mode === undefined) return undefined
  return { mode }
}

function safeDashboardAuth(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  const mode = pickString(value, 'mode')
  if (mode === undefined) return undefined
  const safe: Record<string, unknown> = { mode }
  if (mode === 'oidc') {
    const issuer = pickString(value, 'issuer')
    if (issuer !== undefined) safe['issuer'] = issuer
  }
  return safe
}

function safeTls(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  const requestCert = pickBoolean(value, 'requestCert')
  return { enabled: true, ...(requestCert === undefined ? {} : { requestCert }) }
}

function safeLiveTransport(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  const mode = pickString(value, 'mode')
  if (mode === undefined) return undefined
  return { mode }
}

function safeSampling(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  const mode = pickString(value, 'mode')
  if (mode === undefined) return undefined
  const safe: Record<string, unknown> = { mode }
  const baseProbability = pickNumber(value, 'baseProbability')
  if (baseProbability !== undefined) safe['baseProbability'] = baseProbability
  const outlierQuantile = pickNumber(value, 'outlierQuantile')
  if (outlierQuantile !== undefined) safe['outlierQuantile'] = outlierQuantile
  return safe
}

function safeProduction(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  const safe: Record<string, unknown> = {}
  const ingestAuth = safeIngestAuth(value['ingestAuth'])
  if (ingestAuth !== undefined) safe['ingestAuth'] = ingestAuth
  const dashboardAuth = safeDashboardAuth(value['dashboardAuth'])
  if (dashboardAuth !== undefined) safe['dashboardAuth'] = dashboardAuth
  const tls = safeTls(value['tls'])
  if (tls !== undefined) safe['tls'] = tls
  const allowInsecure = pickBoolean(value, 'allowInsecure')
  if (allowInsecure !== undefined) safe['allowInsecure'] = allowInsecure
  const liveTransport = safeLiveTransport(value['liveTransport'])
  if (liveTransport !== undefined) safe['liveTransport'] = liveTransport
  const sampling = safeSampling(value['sampling'])
  if (sampling !== undefined) safe['sampling'] = sampling
  return Object.keys(safe).length === 0 ? undefined : safe
}

function safeOtlpExport(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  const safe: Record<string, unknown> = {}
  const endpoint = pickString(value, 'endpoint')
  if (endpoint !== undefined) safe['endpoint'] = endpoint
  const protocol = pickString(value, 'protocol')
  if (protocol !== undefined) safe['protocol'] = protocol
  return Object.keys(safe).length === 0 ? undefined : safe
}

function safeOtlpIngest(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  const safe: Record<string, unknown> = {}
  const http = pickBoolean(value, 'http')
  if (http !== undefined) safe['http'] = http
  const grpc = pickBoolean(value, 'grpc')
  if (grpc !== undefined) safe['grpc'] = grpc
  const grpcPort = pickNumber(value, 'grpcPort')
  if (grpcPort !== undefined) safe['grpcPort'] = grpcPort
  const appName = pickString(value, 'appName')
  if (appName !== undefined) safe['appName'] = appName
  return Object.keys(safe).length === 0 ? undefined : safe
}

function safeOtlp(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  const safe: Record<string, unknown> = {}
  const exportSafe = safeOtlpExport(value['export'])
  if (exportSafe !== undefined) safe['export'] = exportSafe
  const ingestSafe = safeOtlpIngest(value['ingest'])
  if (ingestSafe !== undefined) safe['ingest'] = ingestSafe
  return Object.keys(safe).length === 0 ? undefined : safe
}

function safeCi(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  const safe: Record<string, unknown> = {}
  const failOnRouteDrift = pickBoolean(value, 'failOnRouteDrift')
  if (failOnRouteDrift !== undefined) safe['failOnRouteDrift'] = failOnRouteDrift
  if (isRecord(value['readiness'])) {
    const timeoutMs = pickNumber(value['readiness'], 'timeoutMs')
    if (timeoutMs !== undefined) safe['readinessTimeoutMs'] = timeoutMs
  }
  if (Array.isArray(value['scenarios'])) safe['scenarioCount'] = value['scenarios'].length
  return Object.keys(safe).length === 0 ? undefined : safe
}

export function buildSafeMeta(meta: unknown): unknown {
  if (meta === undefined || meta === null) return null
  if (!isRecord(meta)) return null
  const safe: Record<string, unknown> = {}
  const collectorSafe = safeCollector(meta['collector'])
  if (collectorSafe !== undefined) safe['collector'] = collectorSafe
  const productionSafe = safeProduction(meta['production'])
  if (productionSafe !== undefined) safe['production'] = productionSafe
  const otlpSafe = safeOtlp(meta['otlp'])
  if (otlpSafe !== undefined) safe['otlp'] = otlpSafe
  const ciSafe = safeCi(meta['ci'])
  if (ciSafe !== undefined) safe['ci'] = ciSafe
  return safe
}
