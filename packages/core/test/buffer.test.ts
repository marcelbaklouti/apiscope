import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpanBuffer } from '../src/buffer'
import type { RequestSpan } from '../src/types'
import { validRequestSpan } from './validate.test'

function spanWithId(id: string): RequestSpan {
  return { ...validRequestSpan, id }
}

describe('SpanBuffer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('flushes on the interval', () => {
    const onFlush = vi.fn()
    const buffer = new SpanBuffer({ onFlush })
    buffer.pushSpan(spanWithId('a'))
    expect(onFlush).not.toHaveBeenCalled()
    vi.advanceTimersByTime(250)
    expect(onFlush).toHaveBeenCalledWith({ spans: [spanWithId('a')], childSpans: [], droppedCount: 0 })
    buffer.stop()
  })

  it('flushes immediately at the threshold', () => {
    const onFlush = vi.fn()
    const buffer = new SpanBuffer({ onFlush, flushThreshold: 3 })
    buffer.pushSpan(spanWithId('a'))
    buffer.pushSpan(spanWithId('b'))
    expect(onFlush).not.toHaveBeenCalled()
    buffer.pushSpan(spanWithId('c'))
    expect(onFlush).toHaveBeenCalledTimes(1)
    buffer.stop()
  })

  it('does not emit empty flushes', () => {
    const onFlush = vi.fn()
    const buffer = new SpanBuffer({ onFlush })
    vi.advanceTimersByTime(1000)
    expect(onFlush).not.toHaveBeenCalled()
    buffer.stop()
  })

  it('drops oldest beyond capacity and reports droppedCount once', () => {
    const onFlush = vi.fn()
    const buffer = new SpanBuffer({ onFlush, capacity: 2, flushThreshold: 100 })
    buffer.pushSpan(spanWithId('a'))
    buffer.pushSpan(spanWithId('b'))
    buffer.pushSpan(spanWithId('c'))
    buffer.flush()
    expect(onFlush).toHaveBeenCalledWith({ spans: [spanWithId('b'), spanWithId('c')], childSpans: [], droppedCount: 1 })
    buffer.pushSpan(spanWithId('d'))
    buffer.flush()
    expect(onFlush).toHaveBeenLastCalledWith({ spans: [spanWithId('d')], childSpans: [], droppedCount: 0 })
    buffer.stop()
  })

  it('stop flushes remaining events and cancels the timer', () => {
    const onFlush = vi.fn()
    const buffer = new SpanBuffer({ onFlush })
    buffer.pushSpan(spanWithId('a'))
    buffer.stop()
    expect(onFlush).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    expect(onFlush).toHaveBeenCalledTimes(1)
  })
})
