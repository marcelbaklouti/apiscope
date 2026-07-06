export type AdvisorThresholds = Record<string, number>

export interface ResolvedAdvisorConfig {
  enabled: boolean
  minimumOverallSampleSize: number
  thresholds: AdvisorThresholds
  rules: Record<string, { minimumSampleSize: number; enabled: boolean }>
}
