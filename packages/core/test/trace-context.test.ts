import { describe, expect, it } from 'vitest'
import { formatTraceparent, parseTraceparent } from '../src/trace-context'

describe('traceparent codec', () => {
  it('formats a sampled context', () => {
    expect(
      formatTraceparent({ traceId: '0af7651916cd43dd8448eb211c80319c', spanId: 'b7ad6b7169203331', sampled: true })
    ).toBe('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01')
  })

  it('round-trips through parse', () => {
    const header = formatTraceparent({ traceId: '0af7651916cd43dd8448eb211c80319c', spanId: 'b7ad6b7169203331', sampled: false })
    const parsed = parseTraceparent(header)
    expect(parsed).toEqual({ traceId: '0af7651916cd43dd8448eb211c80319c', spanId: 'b7ad6b7169203331', sampled: false })
  })

  it('rejects malformed, wrong-width, and all-zero ids', () => {
    expect(parseTraceparent('not-a-header')).toBeNull()
    expect(parseTraceparent('00-short-b7ad6b7169203331-01')).toBeNull()
    expect(parseTraceparent('00-00000000000000000000000000000000-b7ad6b7169203331-01')).toBeNull()
    expect(parseTraceparent('00-0af7651916cd43dd8448eb211c80319c-0000000000000000-01')).toBeNull()
    expect(parseTraceparent('99-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01')).toBeNull()
  })
})
