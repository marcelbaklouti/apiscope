import { describe, expect, it } from 'vitest'
import { BODY_CAPTURE_LIMIT_BYTES } from '../src/constants'
import { buildCapturedPayload, capBody, redactHeaders } from '../src/redact'

describe('redactHeaders', () => {
  it('redacts default headers case-insensitively and reports them', () => {
    const result = redactHeaders({ Authorization: 'Bearer token', Accept: 'application/json', 'Set-Cookie': 'a=1' })
    expect(result.headers).toEqual({ Authorization: '[redacted]', Accept: 'application/json', 'Set-Cookie': '[redacted]' })
    expect(result.redactedHeaders.sort()).toEqual(['authorization', 'set-cookie'])
  })

  it('honors additional redaction entries', () => {
    const result = redactHeaders({ 'x-api-key': 'secret' }, ['X-Api-Key'])
    expect(result.headers).toEqual({ 'x-api-key': '[redacted]' })
    expect(result.redactedHeaders).toEqual(['x-api-key'])
  })
})

describe('capBody', () => {
  it('keeps bodies at the byte limit untouched', () => {
    const body = 'a'.repeat(BODY_CAPTURE_LIMIT_BYTES)
    expect(capBody(body)).toEqual({ body, truncated: false })
  })

  it('truncates on byte length, not character length', () => {
    const multibyte = 'ü'.repeat(BODY_CAPTURE_LIMIT_BYTES)
    const result = capBody(multibyte)
    expect(result.truncated).toBe(true)
    expect(Buffer.byteLength(result.body, 'utf8')).toBeLessThanOrEqual(BODY_CAPTURE_LIMIT_BYTES)
    expect(result.body).not.toContain('�')
  })

  it('supports custom limits', () => {
    expect(capBody('abcdef', 3)).toEqual({ body: 'abc', truncated: true })
  })
})

describe('buildCapturedPayload', () => {
  it('combines redaction and capping', () => {
    const payload = buildCapturedPayload({ Cookie: 'session=1' }, 'abcdef', { limitBytes: 4 })
    expect(payload).toEqual({
      headers: { Cookie: '[redacted]' },
      body: 'abcd',
      truncated: true,
      redactedHeaders: ['cookie']
    })
  })

  it('omits body when undefined', () => {
    const payload = buildCapturedPayload({}, undefined)
    expect(payload).toEqual({ headers: {}, truncated: false, redactedHeaders: [] })
  })
})
