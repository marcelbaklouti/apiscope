import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SqliteSpanStore } from '../src/store'

describe('SqliteSpanStore corruption recovery', () => {
  it('rotates a corrupt database file away and starts fresh', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'apiscope-store-'))
    const dbPath = join(directory, 'apiscope.db')
    writeFileSync(dbPath, 'this is not a sqlite database and long enough to not be treated as empty')
    const store = new SqliteSpanStore(dbPath)
    expect(store.recoveredFromCorruption).toBe(true)
    expect(await store.recentSpans(10)).toEqual([])
    const rotated = readdirSync(directory).filter((name) => name.startsWith('apiscope.db.corrupt-'))
    expect(rotated).toHaveLength(1)
    await store.close()
  })

  it('reports no recovery for healthy databases', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'apiscope-store-'))
    const dbPath = join(directory, 'apiscope.db')
    const first = new SqliteSpanStore(dbPath)
    await first.close()
    const second = new SqliteSpanStore(dbPath)
    expect(second.recoveredFromCorruption).toBe(false)
    await second.close()
  })

  it('never rotates in-memory databases', async () => {
    const store = new SqliteSpanStore(':memory:')
    expect(store.recoveredFromCorruption).toBe(false)
    await store.close()
  })
})
