import { describe, expect, it } from 'vitest'
import { RunAggregator } from '../src/aggregator'
import type { LoadScenario, SampleEntry } from '../src/types'

const scenario: LoadScenario = {
  name: 'agg-test',
  baseUrl: 'http://127.0.0.1:3000',
  targets: [
    { method: 'GET', path: '/a' },
    { method: 'POST', path: '/b', label: 'create-b' }
  ],
  model: { kind: 'open', phases: [{ durationMs: 1000, rps: 50 }, { durationMs: 1000, rps: 150 }] }
}

function samples(latencies: number[], targetIndex: number, statusCode = 200): SampleEntry[] {
  return latencies.map((latencyMs) => ({ latencyMs, statusCode, targetIndex }))
}

describe('RunAggregator', () => {
  it('aggregates latency percentiles, statuses and per-target breakdowns', () => {
    const aggregator = new RunAggregator(scenario)
    aggregator.addSamples(samples([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 0))
    aggregator.addSamples(samples([200], 1, 500))
    aggregator.addSamples([{ latencyMs: 300, statusCode: 0, targetIndex: 1, errorMessage: 'ECONNREFUSED' }])
    aggregator.addWorkerHealth({ type: 'done', eventLoopLagP99Ms: 4, maxScheduleDeviationMs: 12, attempted: 12 })
    aggregator.addWorkerHealth({ type: 'done', eventLoopLagP99Ms: 9, maxScheduleDeviationMs: 3, attempted: 0 })
    const result = aggregator.finish({ aborted: false, degraded: false, durationMs: 2000 })
    expect(result.totalRequests).toBe(12)
    expect(result.errorCount).toBe(2)
    expect(result.errorRate).toBeCloseTo(2 / 12)
    expect(result.latency.p50).toBeGreaterThanOrEqual(50)
    expect(result.latency.p50).toBeLessThanOrEqual(70)
    expect(result.latency.max).toBeGreaterThanOrEqual(295)
    expect(result.statusDistribution).toEqual({ '200': 10, '500': 1, '0': 1 })
    expect(result.perTarget).toContainEqual(expect.objectContaining({ label: 'GET /a', count: 10 }))
    expect(result.perTarget).toContainEqual(expect.objectContaining({ label: 'create-b', count: 2 }))
    expect(result.targetRps).toBe(100)
    expect(result.achievedRps).toBeCloseTo(6)
    expect(result.workerHealth).toEqual({ eventLoopLagP99Ms: 9, maxScheduleDeviationMs: 12 })
  })

  it('reports null targetRps for closed models', () => {
    const aggregator = new RunAggregator({ ...scenario, model: { kind: 'closed', concurrency: 5, durationMs: 1000 } })
    const result = aggregator.finish({ aborted: true, degraded: true, durationMs: 1000 })
    expect(result.targetRps).toBeNull()
    expect(result.aborted).toBe(true)
    expect(result.degraded).toBe(true)
    expect(result.totalRequests).toBe(0)
    expect(result.errorRate).toBe(0)
  })
})
