import { BATCH_FLUSH_INTERVAL_MS, BATCH_FLUSH_THRESHOLD } from './constants'
import type { ChildSpan, RequestSpan } from './types'

export interface SpanBatchPayload {
  spans: RequestSpan[]
  childSpans: ChildSpan[]
  droppedCount: number
}

export interface SpanBufferOptions {
  onFlush(batch: SpanBatchPayload): void
  capacity?: number
  flushIntervalMs?: number
  flushThreshold?: number
}

export class SpanBuffer {
  private spans: RequestSpan[] = []
  private childSpans: ChildSpan[] = []
  private droppedCount = 0
  private readonly onFlush: (batch: SpanBatchPayload) => void
  private readonly capacity: number
  private readonly flushThreshold: number
  private readonly timer: ReturnType<typeof setInterval>

  constructor(options: SpanBufferOptions) {
    this.onFlush = options.onFlush
    this.capacity = options.capacity ?? 1000
    this.flushThreshold = options.flushThreshold ?? BATCH_FLUSH_THRESHOLD
    this.timer = setInterval(() => this.flush(), options.flushIntervalMs ?? BATCH_FLUSH_INTERVAL_MS)
    const timerWithUnref = this.timer as unknown as { unref?: () => void }
    timerWithUnref.unref?.()
  }

  pushSpan(span: RequestSpan): void {
    this.spans.push(span)
    this.enforceCapacity()
    this.flushIfAtThreshold()
  }

  pushChildSpan(span: ChildSpan): void {
    this.childSpans.push(span)
    this.enforceCapacity()
    this.flushIfAtThreshold()
  }

  flush(): void {
    if (this.spans.length === 0 && this.childSpans.length === 0 && this.droppedCount === 0) return
    const batch: SpanBatchPayload = {
      spans: this.spans,
      childSpans: this.childSpans,
      droppedCount: this.droppedCount
    }
    this.spans = []
    this.childSpans = []
    this.droppedCount = 0
    this.onFlush(batch)
  }

  stop(): void {
    clearInterval(this.timer)
    this.flush()
  }

  private get bufferedCount(): number {
    return this.spans.length + this.childSpans.length
  }

  private enforceCapacity(): void {
    while (this.bufferedCount > this.capacity) {
      if (this.spans.length > 0) this.spans.shift()
      else this.childSpans.shift()
      this.droppedCount += 1
    }
  }

  private flushIfAtThreshold(): void {
    if (this.bufferedCount >= this.flushThreshold) this.flush()
  }
}
