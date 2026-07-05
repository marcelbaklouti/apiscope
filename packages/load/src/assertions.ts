import type { AssertionOutcome, LoadAssertions, LoadRunResult } from './types'

export function evaluateAssertions(result: LoadRunResult, assertions: LoadAssertions): AssertionOutcome[] {
  const outcomes: AssertionOutcome[] = []
  const upperBounds: Array<[keyof LoadAssertions, number]> = [
    ['p50MaxMs', result.latency.p50],
    ['p95MaxMs', result.latency.p95],
    ['p99MaxMs', result.latency.p99],
    ['errorRateMax', result.errorRate]
  ]
  for (const [name, actual] of upperBounds) {
    const limit = assertions[name]
    if (limit === undefined) continue
    outcomes.push({ name, limit, actual, passed: actual <= limit })
  }
  const minRps = assertions.achievedRpsMin
  if (minRps !== undefined) {
    outcomes.push({ name: 'achievedRpsMin', limit: minRps, actual: result.achievedRps, passed: result.achievedRps >= minRps })
  }
  return outcomes
}
