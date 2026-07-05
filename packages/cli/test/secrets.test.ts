import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveSecret } from '../src/secrets'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('resolveSecret', () => {
  it('reads env refs', () => {
    vi.stubEnv('APISCOPE_TEST_SECRET', 's3cr3t')
    expect(resolveSecret('env:APISCOPE_TEST_SECRET')).toBe('s3cr3t')
  })

  it('throws on missing env', () => {
    expect(() => resolveSecret('env:APISCOPE_MISSING')).toThrow(/APISCOPE_MISSING/)
  })

  it('reads and trims file refs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'apiscope-secret-'))
    const path = join(dir, 'token')
    writeFileSync(path, 'file-token\n')
    expect(resolveSecret(`file:${path}`)).toBe('file-token')
  })

  it('treats other values as literals', () => {
    expect(resolveSecret('literal-value')).toBe('literal-value')
  })
})
