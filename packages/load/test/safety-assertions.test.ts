import { describe, expect, it } from 'vitest'
import { evaluateAssertions } from '../src/assertions'
import { assertAllowedTarget } from '../src/safety'
import type { LoadRunResult } from '../src/types'

describe('assertAllowedTarget', () => {
  it('allows localhost variants', () => {
    expect(() => assertAllowedTarget('http://localhost:3000')).not.toThrow()
    expect(() => assertAllowedTarget('http://127.0.0.1:8080/api')).not.toThrow()
    expect(() => assertAllowedTarget('http://[::1]:3000')).not.toThrow()
  })

  it('rejects remote hosts without allowlist entry', () => {
    expect(() => assertAllowedTarget('https://api.example.com')).toThrow(/api\.example\.com/)
  })

  it('allows allowlisted remote hosts', () => {
    expect(() => assertAllowedTarget('https://staging.example.com', ['staging.example.com'])).not.toThrow()
  })

  it('rejects invalid urls', () => {
    expect(() => assertAllowedTarget('not a url')).toThrow()
  })
})

function result(overrides: Partial<LoadRunResult>): LoadRunResult {
  return {
    name: 'run',
    aborted: false,
    degraded: false,
    totalRequests: 1000,
    errorCount: 5,
    errorRate: 0.005,
    latency: { p50: 12, p90: 30, p95: 40, p99: 90, p999: 200, mean: 15, min: 2, max: 250 },
    statusDistribution: { '200': 995, '500': 5 },
    perTarget: [{ label: 'GET /x', count: 1000, p95: 40 }],
    targetRps: 100,
    achievedRps: 98.5,
    durationMs: 10000,
    workerHealth: { eventLoopLagP99Ms: 3, maxScheduleDeviationMs: 6 },
    ...overrides
  }
}

describe('evaluateAssertions', () => {
  it('passes and fails per threshold', () => {
    const outcomes = evaluateAssertions(result({}), {
      p95MaxMs: 50,
      p99MaxMs: 80,
      errorRateMax: 0.01,
      achievedRpsMin: 99
    })
    expect(outcomes).toEqual([
      { name: 'p95MaxMs', limit: 50, actual: 40, passed: true },
      { name: 'p99MaxMs', limit: 80, actual: 90, passed: false },
      { name: 'errorRateMax', limit: 0.01, actual: 0.005, passed: true },
      { name: 'achievedRpsMin', limit: 99, actual: 98.5, passed: false }
    ])
  })

  it('returns an empty list without assertions', () => {
    expect(evaluateAssertions(result({}), {})).toEqual([])
  })
})
