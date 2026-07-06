import { createJiti } from 'jiti'
import { z } from 'zod'
import type { StorageConfig } from '@apiscope/collector'
import type { LoadAssertions, LoadScenario } from '@apiscope/load'

const targetSchema = z.object({
  method: z.string(),
  path: z.string(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  weight: z.number().positive().optional(),
  label: z.string().optional()
})

const modelSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('open'),
    phases: z.array(z.object({ durationMs: z.number().positive(), rps: z.number().positive() })).min(1)
  }),
  z.object({
    kind: z.literal('closed'),
    concurrency: z.number().int().positive(),
    durationMs: z.number().positive()
  })
])

const scenarioSchema = z.object({
  name: z.string().min(1),
  baseUrl: z.url(),
  targets: z.array(targetSchema).min(1),
  model: modelSchema,
  warmupMs: z.number().nonnegative().optional(),
  workers: z.number().int().positive().optional(),
  allowRemoteHosts: z.array(z.string()).optional(),
  hooksModule: z.string().optional()
})

const assertionsSchema = z.object({
  p50MaxMs: z.number().positive().optional(),
  p95MaxMs: z.number().positive().optional(),
  p99MaxMs: z.number().positive().optional(),
  errorRateMax: z.number().min(0).max(1).optional(),
  achievedRpsMin: z.number().positive().optional()
})

const storageSchema = z.discriminatedUnion('driver', [
  z.object({
    driver: z.literal('sqlite'),
    dbPath: z.string(),
    retentionRows: z.number().int().positive().optional()
  }),
  z.object({
    driver: z.literal('clickhouse'),
    url: z.string(),
    username: z.string().optional(),
    password: z.string().optional(),
    database: z.string().optional(),
    retentionDays: z.number().int().positive().optional()
  })
])

const productionSchema = z
  .object({
    ingestAuth: z
      .discriminatedUnion('mode', [
        z.object({ mode: z.literal('none') }),
        z.object({ mode: z.literal('token'), tokens: z.array(z.object({ appName: z.string(), token: z.string() })) })
      ])
      .optional(),
    dashboardAuth: z
      .discriminatedUnion('mode', [
        z.object({ mode: z.literal('none') }),
        z.object({
          mode: z.literal('password'),
          sessionSecret: z.string(),
          users: z.array(z.object({ username: z.string(), passwordHash: z.string(), displayName: z.string().optional() }))
        }),
        z.object({
          mode: z.literal('oidc'),
          sessionSecret: z.string(),
          issuer: z.string(),
          clientId: z.string(),
          clientSecret: z.string(),
          redirectUri: z.string()
        }),
        z.object({ mode: z.literal('proxy'), userHeader: z.string(), nameHeader: z.string().optional() })
      ])
      .optional(),
    tls: z.object({ key: z.string(), cert: z.string(), ca: z.string().optional(), requestCert: z.boolean().optional() }).optional(),
    allowInsecure: z.boolean().optional(),
    liveTransport: z
      .discriminatedUnion('mode', [
        z.object({ mode: z.literal('memory') }),
        z.object({ mode: z.literal('valkey'), url: z.string(), channel: z.string().optional() })
      ])
      .optional(),
    sampling: z
      .object({
        mode: z.enum(['keep-all', 'tail']),
        baseProbability: z.number().min(0).max(1).optional(),
        outlierQuantile: z.number().optional()
      })
      .optional()
  })
  .optional()

const otlpSchema = z
  .object({
    export: z
      .object({
        endpoint: z.string(),
        protocol: z.enum(['http/json', 'http/protobuf', 'grpc']),
        headers: z.record(z.string(), z.string()).optional()
      })
      .optional(),
    ingest: z
      .object({
        http: z.boolean().optional(),
        grpc: z.boolean().optional(),
        grpcPort: z.number().int().positive().optional(),
        appName: z.string().optional()
      })
      .optional()
  })
  .optional()

const advisorSchema = z
  .object({
    enabled: z.boolean().optional(),
    minimumOverallSampleSize: z.number().int().positive().optional(),
    thresholds: z
      .object({
        compressibleMinBytes: z.number().positive().optional(),
        oversizedPayloadBytes: z.number().positive().optional(),
        slowRouteP95Ms: z.number().positive().optional(),
        criticalRouteP95Ms: z.number().positive().optional(),
        unstableLatencyRatio: z.number().positive().optional(),
        errorRateWarning: z.number().min(0).max(1).optional(),
        errorRateCritical: z.number().min(0).max(1).optional(),
        slowDependencyShare: z.number().min(0).max(1).optional(),
        sequentialOutboundMinMs: z.number().nonnegative().optional()
      })
      .optional(),
    rules: z
      .record(z.string(), z.object({ minimumSampleSize: z.number().int().positive().optional(), enabled: z.boolean().optional() }))
      .optional()
  })
  .optional()

const configSchema = z.object({
  collector: z
    .object({
      host: z.string().optional(),
      port: z.number().int().positive().optional(),
      dbPath: z.string().optional(),
      retentionRows: z.number().int().positive().optional(),
      storage: storageSchema.optional()
    })
    .optional(),
  ci: z
    .object({
      readiness: z.object({
        url: z.url(),
        timeoutMs: z.number().positive().optional(),
        intervalMs: z.number().positive().optional()
      }),
      baselinePath: z.string().optional(),
      tolerances: z
        .object({
          p50Pct: z.number().nonnegative().optional(),
          p95Pct: z.number().nonnegative().optional(),
          p99Pct: z.number().nonnegative().optional(),
          errorRateAbs: z.number().nonnegative().optional()
        })
        .optional(),
      failOnRouteDrift: z.boolean().optional(),
      scenarios: z.array(z.object({ scenario: scenarioSchema, assertions: assertionsSchema.optional() })).min(1)
    })
    .optional(),
  production: productionSchema,
  otlp: otlpSchema,
  advisor: advisorSchema
})

export type IngestAuthConfig = { mode: 'none' } | { mode: 'token'; tokens: Array<{ appName: string; token: string }> }

export type DashboardAuthProductionConfig =
  | { mode: 'none' }
  | { mode: 'password'; sessionSecret: string; users: Array<{ username: string; passwordHash: string; displayName?: string }> }
  | { mode: 'oidc'; sessionSecret: string; issuer: string; clientId: string; clientSecret: string; redirectUri: string }
  | { mode: 'proxy'; userHeader: string; nameHeader?: string }

export type LiveTransportConfig = { mode: 'memory' } | { mode: 'valkey'; url: string; channel?: string }

export type SamplingConfig = { mode: 'keep-all' | 'tail'; baseProbability?: number; outlierQuantile?: number }

export interface ProductionConfig {
  ingestAuth?: IngestAuthConfig
  dashboardAuth?: DashboardAuthProductionConfig
  tls?: { key: string; cert: string; ca?: string; requestCert?: boolean }
  allowInsecure?: boolean
  liveTransport?: LiveTransportConfig
  sampling?: SamplingConfig
}

export type OtlpProtocolConfig = 'http/json' | 'http/protobuf' | 'grpc'

export interface OtlpExportConfigInput {
  endpoint: string
  protocol: OtlpProtocolConfig
  headers?: Record<string, string>
}

export interface OtlpIngestConfigInput {
  http?: boolean
  grpc?: boolean
  grpcPort?: number
  appName?: string
}

export interface OtlpConfig {
  export?: OtlpExportConfigInput
  ingest?: OtlpIngestConfigInput
}

export interface AdvisorConfigThresholds {
  compressibleMinBytes?: number
  oversizedPayloadBytes?: number
  slowRouteP95Ms?: number
  criticalRouteP95Ms?: number
  unstableLatencyRatio?: number
  errorRateWarning?: number
  errorRateCritical?: number
  slowDependencyShare?: number
  sequentialOutboundMinMs?: number
}

export interface AdvisorConfigShape {
  enabled?: boolean
  minimumOverallSampleSize?: number
  thresholds?: AdvisorConfigThresholds
  rules?: Record<string, { minimumSampleSize?: number; enabled?: boolean }>
}

export interface ApiscopeConfig {
  collector?: { host?: string; port?: number; dbPath?: string; retentionRows?: number; storage?: StorageConfig }
  ci?: {
    readiness: { url: string; timeoutMs?: number; intervalMs?: number }
    baselinePath?: string
    tolerances?: { p50Pct?: number; p95Pct?: number; p99Pct?: number; errorRateAbs?: number }
    failOnRouteDrift?: boolean
    scenarios: Array<{ scenario: LoadScenario; assertions?: LoadAssertions }>
  }
  production?: ProductionConfig
  otlp?: OtlpConfig
  advisor?: AdvisorConfigShape
}

export class ConfigError extends Error {}

export function defineConfig(config: ApiscopeConfig): ApiscopeConfig {
  return config
}

export function formatIssuePath(path: Array<string | number>): string {
  if (path.length === 0) return 'config'
  return path
    .map((segment, index) => (typeof segment === 'number' ? `[${segment}]` : index === 0 ? segment : `.${segment}`))
    .join('')
}

export async function loadConfig(configPath: string): Promise<ApiscopeConfig> {
  const jiti = createJiti(import.meta.url)
  const moduleNamespace = (await jiti.import(configPath)) as Record<string, unknown>
  if (!('default' in moduleNamespace)) {
    throw new ConfigError(`config at ${configPath} has no default export`)
  }
  const loaded = moduleNamespace.default
  const parsed = configSchema.safeParse(loaded)
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${formatIssuePath(issue.path as unknown as Array<string | number>)}: ${issue.message}`)
      .join('; ')
    throw new ConfigError(`invalid apiscope config: ${details}`)
  }
  return parsed.data as ApiscopeConfig
}
