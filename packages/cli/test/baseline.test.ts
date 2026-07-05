import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { LoadRunResult } from '@apiscope/load'
import {
  baselineFromResults,
  detectRouteDrift,
  diffAgainstBaseline,
  readBaseline,
  writeBaseline,
  type BaselineFile
} from '../src/baseline'

function result(p95: number, errorRate: number): LoadRunResult {
  return {
    name: 'smoke',
    aborted: false,
    degraded: false,
    totalRequests: 100,
    errorCount: Math.round(errorRate * 100),
    errorRate,
    latency: { p50: p95 / 2, p90: p95 * 0.9, p95, p99: p95 * 1.5, p999: p95 * 2, mean: p95 / 2, min: 1, max: p95 * 3 },
    statusDistribution: { '200': 100 },
    perTarget: [],
    targetRps: 50,
    achievedRps: 49,
    durationMs: 2000,
    workerHealth: { eventLoopLagP99Ms: 1, maxScheduleDeviationMs: 2 }
  }
}

const baseline: BaselineFile = {
  version: 1,
  createdAt: '2026-07-04T00:00:00.000Z',
  scenarios: { smoke: { p50: 50, p95: 100, p99: 150, errorRate: 0.01, achievedRps: 49 } },
  routes: [
    { appName: 'demo', method: 'GET', pattern: '/users/:id' },
    { appName: 'demo', method: 'POST', pattern: '/orders' }
  ]
}

describe('baseline files', () => {
  it('round-trips through the filesystem and returns null when missing', () => {
    const directory = mkdtempSync(join(tmpdir(), 'apiscope-baseline-'))
    const baselinePath = join(directory, 'baseline.json')
    expect(readBaseline(baselinePath)).toBeNull()
    writeBaseline(baselinePath, baseline)
    expect(readBaseline(baselinePath)).toEqual(baseline)
  })

  it('builds a baseline from results', () => {
    const built = baselineFromResults([{ name: 'smoke', result: result(80, 0.005) }], baseline.routes)
    expect(built.version).toBe(1)
    expect(built.scenarios['smoke']).toEqual({ p50: 40, p95: 80, p99: 120, errorRate: 0.005, achievedRps: 49 })
  })
})

describe('diffAgainstBaseline', () => {
  it('passes within tolerance and fails beyond it', () => {
    const outcomes = diffAgainstBaseline('smoke', result(115, 0.02), baseline, { p95Pct: 10, errorRateAbs: 0.005 })
    expect(outcomes).toEqual([
      { name: 'p95 vs baseline (+10%)', baseline: 100, actual: 115, limit: 110.00000000000001, passed: false },
      { name: 'errorRate vs baseline (+0.005)', baseline: 0.01, actual: 0.02, limit: 0.015, passed: false }
    ])
    const passing = diffAgainstBaseline('smoke', result(105, 0.012), baseline, { p95Pct: 10, errorRateAbs: 0.005 })
    expect(passing.every((outcome) => outcome.passed)).toBe(true)
  })

  it('returns nothing for scenarios missing from the baseline', () => {
    expect(diffAgainstBaseline('unknown', result(10, 0), baseline, { p95Pct: 10 })).toEqual([])
  })
})

describe('detectRouteDrift', () => {
  it('reports added and removed routes', () => {
    const drift = detectRouteDrift(baseline, [
      { appName: 'demo', method: 'GET', pattern: '/users/:id' },
      { appName: 'demo', method: 'DELETE', pattern: '/users/:id' }
    ])
    expect(drift.added).toEqual([{ appName: 'demo', method: 'DELETE', pattern: '/users/:id' }])
    expect(drift.removed).toEqual([{ appName: 'demo', method: 'POST', pattern: '/orders' }])
  })
})
