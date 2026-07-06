import { describe, expect, it } from 'vitest'
import {
  formatPercent,
  headerValue,
  humanizeBytes,
  humanizeMs,
  isTextyContentType,
  normalizeStatement,
  responseBytes
} from '../src/util/statement'

describe('normalizeStatement', () => {
  it('collapses literals and whitespace so parameterized queries group', () => {
    const a = normalizeStatement('SELECT * FROM comments WHERE post_id = 12')
    const b = normalizeStatement('select  *  from comments where post_id = 999')
    expect(a).toBe(b)
    expect(a).toBe('select * from comments where post_id = ?')
  })

  it('replaces quoted strings and bind placeholders', () => {
    expect(normalizeStatement("SELECT id FROM u WHERE name = 'ada' AND org = $1")).toBe(
      'select id from u where name = ? and org = ?'
    )
  })
})

describe('responseBytes', () => {
  it('prefers content-length', () => {
    expect(responseBytes({ headers: { 'content-length': '2048' }, truncated: false, redactedHeaders: [] })).toBe(2048)
  })
  it('falls back to body byte length', () => {
    expect(responseBytes({ headers: {}, body: 'hello', truncated: false, redactedHeaders: [] })).toBe(5)
  })
  it('returns null when neither is available', () => {
    expect(responseBytes({ headers: {}, truncated: false, redactedHeaders: [] })).toBeNull()
    expect(responseBytes(undefined)).toBeNull()
  })
})

describe('formatting helpers', () => {
  it('headerValue is case-insensitive', () => {
    expect(headerValue({ 'Content-Encoding': 'gzip' }, 'content-encoding')).toBe('gzip')
  })
  it('isTextyContentType matches common text types', () => {
    expect(isTextyContentType('application/json; charset=utf-8')).toBe(true)
    expect(isTextyContentType('image/png')).toBe(false)
    expect(isTextyContentType(undefined)).toBe(false)
  })
  it('humanizes bytes, ms and percent', () => {
    expect(humanizeBytes(143210)).toBe('140 KB')
    expect(humanizeBytes(512)).toBe('512 B')
    expect(humanizeMs(574)).toBe('574 ms')
    expect(humanizeMs(1500)).toBe('1.5 s')
    expect(formatPercent(0.45)).toBe('45%')
  })
})
