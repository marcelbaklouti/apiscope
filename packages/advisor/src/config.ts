export interface AdvisorThresholds {
  compressibleMinBytes: number
  oversizedPayloadBytes: number
  slowRouteP95Ms: number
  criticalRouteP95Ms: number
  unstableLatencyRatio: number
  errorRateWarning: number
  errorRateCritical: number
  slowDependencyShare: number
  sequentialOutboundMinMs: number
}

export interface AdvisorRuleConfig {
  minimumSampleSize?: number
  enabled?: boolean
}

export interface AdvisorConfigInput {
  enabled?: boolean
  minimumOverallSampleSize?: number
  thresholds?: Partial<AdvisorThresholds>
  rules?: Record<string, AdvisorRuleConfig>
}

export interface ResolvedAdvisorConfig {
  enabled: boolean
  minimumOverallSampleSize: number
  thresholds: AdvisorThresholds
  rules: Record<string, { minimumSampleSize: number; enabled: boolean }>
}

export const DEFAULT_ADVISOR_THRESHOLDS: AdvisorThresholds = {
  compressibleMinBytes: 1400,
  oversizedPayloadBytes: 100 * 1024,
  slowRouteP95Ms: 500,
  criticalRouteP95Ms: 1000,
  unstableLatencyRatio: 5,
  errorRateWarning: 0.02,
  errorRateCritical: 0.1,
  slowDependencyShare: 0.6,
  sequentialOutboundMinMs: 20
}

export const DEFAULT_RULE_MINIMUM_SAMPLE_SIZE: Record<string, number> = {
  'uncompressed-responses': 5,
  'missing-cache-headers': 5,
  'oversized-payload': 5,
  'slow-route': 20,
  'where-time-goes': 10,
  'unstable-latency': 30,
  'n-plus-one': 3,
  'sequential-outbound': 3,
  'slow-dependency': 10,
  'error-hotspot': 20
}

const ALL_RULE_IDS = Object.keys(DEFAULT_RULE_MINIMUM_SAMPLE_SIZE)

function resolveRules(input: Record<string, AdvisorRuleConfig> | undefined): ResolvedAdvisorConfig['rules'] {
  const resolved: ResolvedAdvisorConfig['rules'] = {}
  for (const ruleId of ALL_RULE_IDS) {
    const override = input?.[ruleId]
    resolved[ruleId] = {
      minimumSampleSize: override?.minimumSampleSize ?? DEFAULT_RULE_MINIMUM_SAMPLE_SIZE[ruleId] ?? 10,
      enabled: override?.enabled ?? true
    }
  }
  return resolved
}

export function resolveAdvisorConfig(input?: AdvisorConfigInput): ResolvedAdvisorConfig {
  return {
    enabled: input?.enabled ?? true,
    minimumOverallSampleSize: input?.minimumOverallSampleSize ?? 20,
    thresholds: { ...DEFAULT_ADVISOR_THRESHOLDS, ...(input?.thresholds ?? {}) },
    rules: resolveRules(input?.rules)
  }
}

export function defaultAdvisorConfig(): ResolvedAdvisorConfig {
  return resolveAdvisorConfig()
}
