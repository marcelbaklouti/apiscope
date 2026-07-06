import { execFileSync } from 'node:child_process'
import { existsSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const cliJs = fileURLToPath(new URL('../dist/cli.js', import.meta.url))
const link = join(tmpdir(), 'apiscope-entry-symlink-test')

describe('cli entry point', () => {
  afterAll(() => {
    try {
      rmSync(link)
    } catch {}
  })

  it.skipIf(!existsSync(cliJs))('runs main when invoked through a bin symlink (npx / global install path)', () => {
    try {
      rmSync(link)
    } catch {}
    symlinkSync(cliJs, link)
    const output = execFileSync(process.execPath, [link, 'help'], { encoding: 'utf8' })
    expect(output).toContain('usage:')
  })
})
