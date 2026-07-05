import { describe, expect, it } from 'vitest'
import type { LoadRunResult } from '@apiscope/load'
import {
  renderGithubAnnotations,
  renderJUnitReport,
  renderJsonReport,
  renderTerminalReport,
  reportHasFailures,
  type CiReportInput
} from '../src/report'

const result: LoadRunResult = {
  name: 'smoke',
  aborted: false,
  degraded: false,
  totalRequests: 200,
  errorCount: 2,
  errorRate: 0.01,
  latency: { p50: 12, p90: 30, p95: 42.5, p99: 88, p999: 120, mean: 16, min: 3, max: 140 },
  statusDistribution: { '200': 198, '500': 2 },
  perTarget: [{ label: 'GET /users', count: 200, p95: 42.5 }],
  targetRps: 100,
  achievedRps: 99.1,
  durationMs: 2000,
  workerHealth: { eventLoopLagP99Ms: 2, maxScheduleDeviationMs: 4 }
}

const input: CiReportInput = {
  scenarios: [
    {
      name: 'smoke',
      result,
      assertionOutcomes: [
        { name: 'p95MaxMs', limit: 50, actual: 42.5, passed: true },
        { name: 'p99MaxMs', limit: 80, actual: 88, passed: false }
      ],
      diffOutcomes: [{ name: 'p95 vs baseline (+10%)', baseline: 40, actual: 42.5, limit: 44, passed: true }]
    }
  ],
  routeDrift: { added: [{ appName: 'demo', method: 'DELETE', pattern: '/users/:id' }], removed: [] },
  failOnRouteDrift: false
}

describe('reportHasFailures', () => {
  it('detects assertion failures', () => {
    expect(reportHasFailures(input)).toBe(true)
  })

  it('treats drift as failure only when configured', () => {
    const green: CiReportInput = {
      scenarios: [{ name: 'smoke', result, assertionOutcomes: [], diffOutcomes: [] }],
      routeDrift: input.routeDrift,
      failOnRouteDrift: false
    }
    expect(reportHasFailures(green)).toBe(false)
    expect(reportHasFailures({ ...green, failOnRouteDrift: true })).toBe(true)
  })

  it('treats aborted runs as failure', () => {
    const aborted: CiReportInput = {
      scenarios: [{ name: 'smoke', result: { ...result, aborted: true }, assertionOutcomes: [], diffOutcomes: [] }],
      routeDrift: null,
      failOnRouteDrift: false
    }
    expect(reportHasFailures(aborted)).toBe(true)
  })
})

describe('renderTerminalReport', () => {
  it('renders scenario metrics, checks and drift', () => {
    const text = renderTerminalReport(input)
    expect(text).toContain('smoke')
    expect(text).toContain('p95 42.5ms')
    expect(text).toContain('PASS  p95MaxMs')
    expect(text).toContain('FAIL  p99MaxMs')
    expect(text).toContain('added DELETE /users/:id (demo)')
    expect(text).toContain('RESULT: FAIL')
  })
})

describe('renderJsonReport', () => {
  it('round-trips the input', () => {
    expect(JSON.parse(renderJsonReport(input))).toEqual(JSON.parse(JSON.stringify(input)))
  })
})

describe('renderJUnitReport', () => {
  it('emits testsuites with failures and escaping', () => {
    const xml = renderJUnitReport(input)
    expect(xml).toContain('<testsuite name="smoke" tests="3" failures="1">')
    expect(xml).toContain('<testcase name="p99MaxMs">')
    expect(xml).toContain('<failure message="actual 88 exceeds limit 80"/>')
    expect(xml).toContain('name="p95 vs baseline (+10%)"')
  })
})

describe('renderGithubAnnotations', () => {
  it('emits one annotation per failure', () => {
    expect(renderGithubAnnotations(input)).toEqual([
      '::error title=apiscope::smoke: p99MaxMs failed (88 > 80)'
    ])
  })
})
