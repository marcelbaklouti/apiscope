import { describe, expect, it } from 'vitest'
import { resolveStore } from '../src/store-factory'

describe('resolveStore', () => {
  it('constructs and initializes a sqlite store', async () => {
    const store = await resolveStore({ driver: 'sqlite', dbPath: ':memory:' })
    await store.insertBatch('demo', {
      spans: [
        {
          id: 'x',
          traceId: 't',
          method: 'GET',
          routePattern: '/x',
          actualPath: '/x',
          statusCode: 200,
          timing: { start: 1, ttfb: null, duration: 1 },
          framework: 'express',
          runtime: 'node'
        }
      ],
      childSpans: []
    })
    expect((await store.recentSpans(1))[0]?.id).toBe('x')
    await store.close()
  })
})
