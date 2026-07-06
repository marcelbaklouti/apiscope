import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { alreadyInstrumented, detectFramework } from '../src/onboarding'

function makeTempProjectDir(): string {
  return mkdtempSync(join(tmpdir(), 'apiscope-onboarding-test-'))
}

function writePackageJson(dir: string, contents: unknown): void {
  writeFileSync(join(dir, 'package.json'), JSON.stringify(contents), 'utf8')
}

describe('detectFramework', () => {
  const dirs: string[] = []

  afterEach(() => {
    while (dirs.length > 0) {
      const dir = dirs.pop()
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
    }
  })

  function tempDir(): string {
    const dir = makeTempProjectDir()
    dirs.push(dir)
    return dir
  }

  it('detects Next.js from dependencies', () => {
    const dir = tempDir()
    writePackageJson(dir, { dependencies: { next: '^15.0.0', react: '^19.0.0' } })
    expect(detectFramework(dir)).toEqual({
      name: 'Next.js',
      adapterPackage: '@apiscope/next',
      install: 'npm i -D @apiscope/next',
      snippet: expect.stringContaining('withApiscope')
    })
  })

  it('detects NestJS from dependencies', () => {
    const dir = tempDir()
    writePackageJson(dir, { dependencies: { '@nestjs/core': '^11.0.0', '@nestjs/common': '^11.0.0' } })
    const hint = detectFramework(dir)
    expect(hint?.name).toBe('NestJS')
    expect(hint?.adapterPackage).toBe('@apiscope/nestjs')
    expect(hint?.install).toBe('npm i -D @apiscope/nestjs')
    expect(hint?.snippet).toContain('ApiscopeModule')
  })

  it('detects Fastify from devDependencies', () => {
    const dir = tempDir()
    writePackageJson(dir, { devDependencies: { fastify: '^5.0.0' } })
    const hint = detectFramework(dir)
    expect(hint?.name).toBe('Fastify')
    expect(hint?.adapterPackage).toBe('@apiscope/fastify')
    expect(hint?.install).toBe('npm i -D @apiscope/fastify')
    expect(hint?.snippet).toContain('apiscopeFastify')
  })

  it('detects Express from dependencies', () => {
    const dir = tempDir()
    writePackageJson(dir, { dependencies: { express: '^5.0.0' } })
    const hint = detectFramework(dir)
    expect(hint?.name).toBe('Express')
    expect(hint?.adapterPackage).toBe('@apiscope/express')
    expect(hint?.install).toBe('npm i -D @apiscope/express')
    expect(hint?.snippet).toContain('apiscopeExpress')
  })

  it('detects Hono from dependencies', () => {
    const dir = tempDir()
    writePackageJson(dir, { dependencies: { hono: '^4.0.0' } })
    const hint = detectFramework(dir)
    expect(hint?.name).toBe('Hono')
    expect(hint?.adapterPackage).toBe('@apiscope/hono')
    expect(hint?.install).toBe('npm i -D @apiscope/hono')
    expect(hint?.snippet).toContain('apiscopeHono')
  })

  it('prefers the first match in priority order when multiple frameworks are present', () => {
    const dir = tempDir()
    writePackageJson(dir, { dependencies: { next: '^15.0.0', express: '^5.0.0' } })
    expect(detectFramework(dir)?.name).toBe('Next.js')
  })

  it('returns undefined when no known framework is present', () => {
    const dir = tempDir()
    writePackageJson(dir, { dependencies: { react: '^19.0.0' } })
    expect(detectFramework(dir)).toBeUndefined()
  })

  it('returns undefined when package.json is missing', () => {
    const dir = tempDir()
    expect(detectFramework(dir)).toBeUndefined()
  })

  it('returns undefined when package.json is malformed', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'package.json'), '{ not valid json', 'utf8')
    expect(detectFramework(dir)).toBeUndefined()
  })
})

describe('alreadyInstrumented', () => {
  const dirs: string[] = []

  afterEach(() => {
    while (dirs.length > 0) {
      const dir = dirs.pop()
      if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
    }
  })

  function tempDir(): string {
    const dir = makeTempProjectDir()
    dirs.push(dir)
    return dir
  }

  it('returns true when the adapter package is already a dependency', () => {
    const dir = tempDir()
    writePackageJson(dir, { dependencies: { next: '^15.0.0', '@apiscope/next': '^0.1.0' } })
    const hint = detectFramework(dir)
    expect(hint).toBeDefined()
    expect(alreadyInstrumented(dir, hint!)).toBe(true)
  })

  it('returns true when the adapter package is already a devDependency', () => {
    const dir = tempDir()
    writePackageJson(dir, { dependencies: { express: '^5.0.0' }, devDependencies: { '@apiscope/express': '^0.1.0' } })
    const hint = detectFramework(dir)
    expect(hint).toBeDefined()
    expect(alreadyInstrumented(dir, hint!)).toBe(true)
  })

  it('returns false when the adapter package is not installed', () => {
    const dir = tempDir()
    writePackageJson(dir, { dependencies: { express: '^5.0.0' } })
    const hint = detectFramework(dir)
    expect(hint).toBeDefined()
    expect(alreadyInstrumented(dir, hint!)).toBe(false)
  })

  it('returns false when package.json is missing', () => {
    const dir = tempDir()
    const hint = { name: 'Express', adapterPackage: '@apiscope/express', install: 'npm i -D @apiscope/express', snippet: '' }
    expect(alreadyInstrumented(dir, hint)).toBe(false)
  })
})
