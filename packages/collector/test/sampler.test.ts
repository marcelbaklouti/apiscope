import { describe, expect, it } from 'vitest'
import type { RequestSpan } from '@apiscope/core'
import { createKeepAllSampler, createTailSampler } from '../src/sampling/sampler'

function span(overrides: Partial<RequestSpan>): RequestSpan {
  return {
    id: crypto.randomUUID(),
    traceId: 't',
    method: 'GET',
    routePattern: '/x',
    actualPath: '/x',
    statusCode: 200,
    timing: { start: 0, ttfb: null, duration: 10 },
    framework: 'express',
    runtime: 'node',
    ...overrides
  }
}

describe('createKeepAllSampler', () => {
  it('keeps everything', () => {
    const sampler = createKeepAllSampler()
    expect(sampler.keep(span({}))).toBe(true)
    expect(sampler.keep(span({ statusCode: 200 }))).toBe(true)
  })
})

describe('createTailSampler', () => {
  it('always keeps errors', () => {
    const sampler = createTailSampler({ baseProbability: 0, random: () => 0.99 })
    expect(sampler.keep(span({ statusCode: 500 }))).toBe(true)
    expect(sampler.keep(span({ error: { message: 'x' } }))).toBe(true)
  })

  it('drops normal traffic at zero base probability once a baseline exists', () => {
    const sampler = createTailSampler({ baseProbability: 0, random: () => 0.99 })
    for (let index = 0; index < 200; index += 1) sampler.keep(span({ timing: { start: 0, ttfb: null, duration: 10 } }))
    expect(sampler.keep(span({ timing: { start: 0, ttfb: null, duration: 10 } }))).toBe(false)
  })

  it('keeps slow outliers even at zero base probability', () => {
    const sampler = createTailSampler({ baseProbability: 0, outlierQuantile: 0.95, random: () => 0.99 })
    for (let index = 0; index < 200; index += 1) sampler.keep(span({ timing: { start: 0, ttfb: null, duration: 10 } }))
    expect(sampler.keep(span({ timing: { start: 0, ttfb: null, duration: 5000 } }))).toBe(true)
  })

  it('applies base probability to remaining traffic', () => {
    const keepSampler = createTailSampler({ baseProbability: 1, random: () => 0.99 })
    expect(keepSampler.keep(span({}))).toBe(true)
    const dropSampler = createTailSampler({ baseProbability: 0.5, random: () => 0.9 })
    for (let index = 0; index < 200; index += 1) dropSampler.keep(span({ timing: { start: 0, ttfb: null, duration: 10 } }))
    expect(dropSampler.keep(span({ timing: { start: 0, ttfb: null, duration: 10 } }))).toBe(false)
  })
})
