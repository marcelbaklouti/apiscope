import type { AssertionOutcome, LoadRunResult } from '@apiscope/load'
import type { DiffOutcome, RouteDrift } from './baseline'

export interface CiScenarioOutcome {
  name: string
  result: LoadRunResult
  assertionOutcomes: AssertionOutcome[]
  diffOutcomes: DiffOutcome[]
}

export interface CiReportInput {
  scenarios: CiScenarioOutcome[]
  routeDrift: RouteDrift | null
  failOnRouteDrift: boolean
}

function allChecks(scenario: CiScenarioOutcome): Array<{ name: string; actual: number; limit: number; passed: boolean }> {
  return [...scenario.assertionOutcomes, ...scenario.diffOutcomes]
}

export function reportHasFailures(input: CiReportInput): boolean {
  const checksFailed = input.scenarios.some(
    (scenario) => scenario.result.aborted || allChecks(scenario).some((check) => !check.passed)
  )
  const driftFails =
    input.failOnRouteDrift &&
    input.routeDrift !== null &&
    (input.routeDrift.added.length > 0 || input.routeDrift.removed.length > 0)
  return checksFailed || driftFails
}

function formatMs(value: number): string {
  return `${Math.round(value * 10) / 10}ms`
}

export function renderTerminalReport(input: CiReportInput): string {
  const lines: string[] = []
  for (const scenario of input.scenarios) {
    const { latency, achievedRps, errorRate, aborted } = scenario.result
    lines.push(
      `${scenario.name}  p50 ${formatMs(latency.p50)}  p95 ${formatMs(latency.p95)}  p99 ${formatMs(latency.p99)}  rps ${Math.round(achievedRps * 10) / 10}  errors ${(errorRate * 100).toFixed(2)}%${aborted ? '  ABORTED' : ''}`
    )
    for (const check of allChecks(scenario)) {
      lines.push(`  ${check.passed ? 'PASS' : 'FAIL'}  ${check.name}  actual ${check.actual}  limit ${check.limit}`)
    }
  }
  if (input.routeDrift !== null && (input.routeDrift.added.length > 0 || input.routeDrift.removed.length > 0)) {
    lines.push('route drift:')
    for (const route of input.routeDrift.added) {
      lines.push(`  added ${route.method} ${route.pattern} (${route.appName})`)
    }
    for (const route of input.routeDrift.removed) {
      lines.push(`  removed ${route.method} ${route.pattern} (${route.appName})`)
    }
  }
  lines.push(`RESULT: ${reportHasFailures(input) ? 'FAIL' : 'PASS'}`)
  return lines.join('\n')
}

export function renderJsonReport(input: CiReportInput): string {
  return JSON.stringify(input, null, 2)
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function renderJUnitReport(input: CiReportInput): string {
  const suites = input.scenarios.map((scenario) => {
    const checks = allChecks(scenario)
    const failures = checks.filter((check) => !check.passed).length
    const cases = checks
      .map((check) => {
        if (check.passed) return `    <testcase name="${escapeXml(check.name)}"/>`
        return `    <testcase name="${escapeXml(check.name)}">\n      <failure message="actual ${check.actual} exceeds limit ${check.limit}"/>\n    </testcase>`
      })
      .join('\n')
    return `  <testsuite name="${escapeXml(scenario.name)}" tests="${checks.length}" failures="${failures}">\n${cases}\n  </testsuite>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n${suites.join('\n')}\n</testsuites>\n`
}

export function renderGithubAnnotations(input: CiReportInput): string[] {
  const annotations: string[] = []
  for (const scenario of input.scenarios) {
    for (const check of allChecks(scenario)) {
      if (check.passed) continue
      annotations.push(`::error title=apiscope::${scenario.name}: ${check.name} failed (${check.actual} > ${check.limit})`)
    }
  }
  return annotations
}
