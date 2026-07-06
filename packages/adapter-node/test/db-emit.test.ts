import { afterEach, describe, expect, it, vi } from 'vitest'
import { BODY_CAPTURE_LIMIT_BYTES } from '@apiscope/core'
import type { DbChildSpan, SpanBatchPayload } from '@apiscope/core'
import { emitDbSpan } from '../src/db/emit'
import { registerActiveRuntime } from '../src/db/registry'
import { AdapterRuntime } from '../src/runtime'
import type { CollectorTransport } from '../src/transport'

function fakeTransport() {
  const batches: SpanBatchPayload[] = []
  const transport = {
    start: vi.fn(),
    setRoutes: vi.fn(),
    sendBatch: (batch: SpanBatchPayload) => batches.push(batch),
    stop: vi.fn(async () => {})
  } as unknown as CollectorTransport
  return { transport, batches }
}

let runtime: AdapterRuntime | undefined

afterEach(async () => {
  if (runtime !== undefined) await runtime.shutdown()
  runtime = undefined
})

describe('emitDbSpan', () => {
  it('caps an oversized statement to the body capture limit', async () => {
    const { transport } = fakeTransport()
    runtime = new AdapterRuntime({ appName: 'demo', framework: 'express', transport })
    registerActiveRuntime(runtime)
    const context = runtime.newIds()
    let recorded: DbChildSpan | undefined
    const recordChildSpanSpy = vi.spyOn(runtime, 'recordChildSpan').mockImplementation((childSpan) => {
      recorded = childSpan as DbChildSpan
    })
    const oversizedStatement = `SELECT ${'x'.repeat(BODY_CAPTURE_LIMIT_BYTES)} FROM t`
    await runtime.runWithSpan(context, () => {
      emitDbSpan({
        system: 'postgresql',
        statement: oversizedStatement,
        operation: 'SELECT',
        target: 't',
        run: () => 'result'
      })
    })
    expect(recordChildSpanSpy).toHaveBeenCalledTimes(1)
    expect(recorded).toBeDefined()
    expect(Buffer.byteLength(recorded!.statement, 'utf8')).toBeLessThanOrEqual(BODY_CAPTURE_LIMIT_BYTES)
    expect(recorded!.statement.length).toBeLessThan(oversizedStatement.length)
  })

  it('leaves a statement under the cap untouched', async () => {
    const { transport } = fakeTransport()
    runtime = new AdapterRuntime({ appName: 'demo', framework: 'express', transport })
    registerActiveRuntime(runtime)
    const context = runtime.newIds()
    let recorded: DbChildSpan | undefined
    vi.spyOn(runtime, 'recordChildSpan').mockImplementation((childSpan) => {
      recorded = childSpan as DbChildSpan
    })
    await runtime.runWithSpan(context, () => {
      emitDbSpan({
        system: 'postgresql',
        statement: 'SELECT 1',
        operation: 'SELECT',
        target: null,
        run: () => 'result'
      })
    })
    expect(recorded?.statement).toBe('SELECT 1')
  })
})
