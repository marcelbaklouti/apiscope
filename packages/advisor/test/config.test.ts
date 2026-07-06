import { describe, expect, it } from 'vitest'
import { DEFAULT_ADVISOR_THRESHOLDS, defaultAdvisorConfig, resolveAdvisorConfig } from '../src/config'

describe('advisor config resolution', () => {
  it('provides sensible defaults', () => {
    const config = defaultAdvisorConfig()
    expect(config.enabled).toBe(true)
    expect(config.thresholds.slowRouteP95Ms).toBe(500)
    expect(config.thresholds.compressibleMinBytes).toBe(1400)
    expect(config.minimumOverallSampleSize).toBe(20)
    expect(config.rules['uncompressed-responses']?.minimumSampleSize).toBeGreaterThan(0)
  })

  it('deep-merges thresholds and rule overrides', () => {
    const config = resolveAdvisorConfig({
      thresholds: { slowRouteP95Ms: 300 },
      rules: { 'slow-route': { minimumSampleSize: 50, enabled: false } }
    })
    expect(config.thresholds.slowRouteP95Ms).toBe(300)
    expect(config.thresholds.criticalRouteP95Ms).toBe(DEFAULT_ADVISOR_THRESHOLDS.criticalRouteP95Ms)
    expect(config.rules['slow-route']?.minimumSampleSize).toBe(50)
    expect(config.rules['slow-route']?.enabled).toBe(false)
  })

  it('treats enabled:false as globally disabled', () => {
    expect(resolveAdvisorConfig({ enabled: false }).enabled).toBe(false)
  })
})
