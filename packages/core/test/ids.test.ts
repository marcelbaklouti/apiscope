import { describe, expect, it } from 'vitest'
import { newSpanId, newTraceId, normalizeSpanId, normalizeTraceId } from '../src/ids'

describe('w3c-compatible ids', () => {
  it('generates 32-hex trace ids and 16-hex span ids', () => {
    expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/)
    expect(newSpanId()).toMatch(/^[0-9a-f]{16}$/)
  })

  it('normalizer passes through valid ids', () => {
    const trace = newTraceId()
    const span = newSpanId()
    expect(normalizeTraceId(trace)).toBe(trace)
    expect(normalizeSpanId(span)).toBe(span)
  })

  it('normalizer derives deterministic valid ids from arbitrary strings', () => {
    const a = normalizeTraceId('p1')
    const b = normalizeTraceId('p1')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(normalizeSpanId('child-1')).toMatch(/^[0-9a-f]{16}$/)
  })
})
