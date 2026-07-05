import { describe, expect, it } from 'vitest'
import { SpanStore } from '../src/store'

describe('SpanStore load runs', () => {
  it('persists and lists load runs newest first', () => {
    const store = new SpanStore(':memory:')
    store.insertLoadRun({ id: 'r1', name: 'smoke', startedAt: 1000, scenarioJson: '{"a":1}', resultJson: '{"p95":12}' })
    store.insertLoadRun({ id: 'r2', name: 'soak', startedAt: 2000, scenarioJson: '{}', resultJson: '{}' })
    expect(store.listLoadRuns()).toEqual([
      { id: 'r2', name: 'soak', startedAt: 2000 },
      { id: 'r1', name: 'smoke', startedAt: 1000 }
    ])
    expect(store.loadRunById('r1')).toEqual({
      id: 'r1',
      name: 'smoke',
      startedAt: 1000,
      scenarioJson: '{"a":1}',
      resultJson: '{"p95":12}'
    })
    expect(store.loadRunById('missing')).toBeNull()
    store.close()
  })
})
