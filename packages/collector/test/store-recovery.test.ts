import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SpanStore } from '../src/store'

describe('SpanStore corruption recovery', () => {
  it('rotates a corrupt database file away and starts fresh', () => {
    const directory = mkdtempSync(join(tmpdir(), 'apiscope-store-'))
    const dbPath = join(directory, 'apiscope.db')
    writeFileSync(dbPath, 'this is not a sqlite database and long enough to not be treated as empty')
    const store = new SpanStore(dbPath)
    expect(store.recoveredFromCorruption).toBe(true)
    expect(store.recentSpans(10)).toEqual([])
    const rotated = readdirSync(directory).filter((name) => name.startsWith('apiscope.db.corrupt-'))
    expect(rotated).toHaveLength(1)
    store.close()
  })

  it('reports no recovery for healthy databases', () => {
    const directory = mkdtempSync(join(tmpdir(), 'apiscope-store-'))
    const dbPath = join(directory, 'apiscope.db')
    const first = new SpanStore(dbPath)
    first.close()
    const second = new SpanStore(dbPath)
    expect(second.recoveredFromCorruption).toBe(false)
    second.close()
  })

  it('never rotates in-memory databases', () => {
    const store = new SpanStore(':memory:')
    expect(store.recoveredFromCorruption).toBe(false)
    store.close()
  })
})
