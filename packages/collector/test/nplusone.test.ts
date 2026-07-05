import { describe, expect, it } from 'vitest'
import type { ChildSpan, DbChildSpan } from '@apiscope/core'
import { detectNPlusOne, normalizeStatement } from '../src/analysis/nplusone'

function dbChild(statement: string, index: number): DbChildSpan {
  return {
    id: `c${index}`,
    parentSpanId: 'p',
    traceId: 't',
    kind: 'db',
    system: 'postgresql',
    statement,
    operation: 'SELECT',
    target: 'db',
    rowCount: 1,
    timing: { start: index, ttfb: null, duration: 1 }
  }
}

function fetchChild(index: number): ChildSpan {
  return {
    id: `f${index}`,
    parentSpanId: 'p',
    traceId: 't',
    kind: 'fetch',
    url: 'http://downstream',
    method: 'GET',
    statusCode: 200,
    timing: { start: index, ttfb: null, duration: 1 }
  }
}

describe('n+1 detection', () => {
  it('normalizes literals and placeholders to a template', () => {
    expect(normalizeStatement('SELECT * FROM users WHERE id = 42')).toBe(normalizeStatement('SELECT * FROM users WHERE id = 99'))
    expect(normalizeStatement('SELECT * FROM t WHERE a = $1')).toBe(normalizeStatement('SELECT * FROM t WHERE a = ?'))
  })

  it('flags repeated identical-template queries above the threshold', () => {
    const children = Array.from({ length: 6 }, (_, index) => dbChild(`SELECT * FROM posts WHERE user_id = ${index}`, index))
    const groups = detectNPlusOne(children)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.count).toBe(6)
  })

  it('does not flag distinct queries or counts below threshold', () => {
    const children = [dbChild('SELECT * FROM a WHERE id = 1', 0), dbChild('SELECT * FROM b WHERE id = 1', 1)]
    expect(detectNPlusOne(children)).toHaveLength(0)
  })

  it('ignores fetch child spans entirely', () => {
    const children: ChildSpan[] = [
      ...Array.from({ length: 6 }, (_, index) => fetchChild(index)),
      ...Array.from({ length: 3 }, (_, index) => dbChild(`SELECT * FROM posts WHERE user_id = ${index}`, index))
    ]
    expect(detectNPlusOne(children)).toHaveLength(0)
  })

  it('respects a custom threshold and sums duration per group', () => {
    const children = Array.from({ length: 3 }, (_, index) => dbChild(`SELECT * FROM posts WHERE user_id = ${index}`, index))
    const groups = detectNPlusOne(children, 3)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.count).toBe(3)
    expect(groups[0]?.totalDurationMs).toBe(3)
  })
})
