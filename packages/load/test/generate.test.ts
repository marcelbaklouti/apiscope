import { describe, expect, it } from 'vitest'
import type { RequestSpan } from '@apiscope/core'
import { generateScenario } from '../src/generate'

function span(method: string, route: string, path: string, startMs: number, duration: number): RequestSpan {
  return {
    id: `${method}-${path}-${startMs}`,
    traceId: 't',
    method,
    routePattern: route,
    actualPath: path,
    statusCode: 200,
    timing: { start: startMs, ttfb: null, duration },
    framework: 'express',
    runtime: 'node'
  }
}

describe('generateScenario', () => {
  it('derives weighted targets, rate and p95 budget from spans', () => {
    const base = 1_700_000_000_000
    const spans: RequestSpan[] = []
    for (let index = 0; index < 30; index += 1) spans.push(span('GET', '/users/:id', `/users/${index}`, base + index * 100, 10 + index))
    for (let index = 0; index < 10; index += 1) spans.push(span('POST', '/orders', '/orders', base + index * 300, 40))

    const result = generateScenario({ spans, baseUrl: 'http://localhost:3000', durationMs: 60000, shape: 'steady' })

    expect(result.observed.totalRequests).toBe(40)
    expect(result.scenario.targets.length).toBe(2)
    const usersTarget = result.scenario.targets.find((target) => target.path.startsWith('/users/'))!
    expect(usersTarget.method).toBe('GET')
    expect((usersTarget.weight ?? 0) > 0).toBe(true)
    expect(result.scenario.model.kind).toBe('open')
    const firstPhaseRps = result.scenario.model.kind === 'open' ? result.scenario.model.phases[0]?.rps : undefined
    expect(firstPhaseRps).toBeGreaterThan(0)
    const usersBudget = result.assertions.perRoute?.find((entry) => entry.pattern === '/users/:id')
    expect((usersBudget?.maxP95Ms ?? 0) > 0).toBe(true)
  })

  it('includes a body only for methods that carried one', () => {
    const base = 1_700_000_000_000
    const withBody: RequestSpan = { ...span('QUERY', '/search', '/search', base, 12), request: { body: '{"q":"x"}' } as never }
    const result = generateScenario({ spans: [withBody], baseUrl: 'http://localhost:3000' })
    const target = result.scenario.targets[0]!
    expect(target.method).toBe('QUERY')
    expect(target.body).toBe('{"q":"x"}')
  })
})
