import { describe, expect, it } from 'vitest'
import { SqliteSpanStore } from '../src/store'

describe('SqliteSpanStore load runs', () => {
  it('persists and lists load runs newest first', async () => {
    const store = new SqliteSpanStore(':memory:')
    await store.insertLoadRun({ id: 'r1', name: 'smoke', startedAt: 1000, scenarioJson: '{"a":1}', resultJson: '{"p95":12}' })
    await store.insertLoadRun({ id: 'r2', name: 'soak', startedAt: 2000, scenarioJson: '{}', resultJson: '{}' })
    expect(await store.listLoadRuns()).toEqual([
      { id: 'r2', name: 'soak', startedAt: 2000 },
      { id: 'r1', name: 'smoke', startedAt: 1000 }
    ])
    expect(await store.loadRunById('r1')).toEqual({
      id: 'r1',
      name: 'smoke',
      startedAt: 1000,
      scenarioJson: '{"a":1}',
      resultJson: '{"p95":12}'
    })
    expect(await store.loadRunById('missing')).toBeNull()
    await store.close()
  })
})
