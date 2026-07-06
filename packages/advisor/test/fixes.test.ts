import { describe, expect, it } from 'vitest'
import { resolveFix } from '../src/fixes'

describe('resolveFix — uncompressed responses', () => {
  it('gives Express the compression middleware', () => {
    const fix = resolveFix('uncompressed-responses', 'express')
    expect(fix.framework).toBe('express')
    expect(fix.codeSnippet).toContain("import compression from 'compression'")
    expect(fix.codeSnippet).toContain('app.use(compression())')
  })
  it('gives Fastify @fastify/compress', () => {
    const fix = resolveFix('uncompressed-responses', 'fastify')
    expect(fix.codeSnippet).toContain("@fastify/compress")
    expect(fix.codeSnippet).toContain('app.register(')
  })
  it('gives Hono the edge-safe compress middleware', () => {
    const fix = resolveFix('uncompressed-responses', 'hono')
    expect(fix.codeSnippet).toContain("import { compress } from 'hono/compress'")
    expect(fix.codeSnippet).toContain("app.use('*', compress())")
    expect(fix.codeSnippet).not.toContain('node:')
  })
  it('gives Next the next.config flag', () => {
    const fix = resolveFix('uncompressed-responses', 'next')
    expect(fix.codeSnippet).toContain('compress: true')
  })
  it('gives Nest compression in main.ts', () => {
    const fix = resolveFix('uncompressed-responses', 'nestjs')
    expect(fix.codeSnippet).toContain('app.use(compression())')
  })
  it('falls back to generic guidance with a docs link and no snippet on unknown framework', () => {
    const fix = resolveFix('uncompressed-responses', 'koa')
    expect(fix.framework).toBe('koa')
    expect(fix.codeSnippet).toBeUndefined()
    expect(fix.docsUrl).toBeTruthy()
  })
})

describe('resolveFix — cache headers', () => {
  it('gives Express an etag/cache-control snippet', () => {
    expect(resolveFix('missing-cache-headers', 'express').codeSnippet).toContain('Cache-Control')
  })
  it('gives Next App Router a revalidate export when the source file is under app/', () => {
    const fix = resolveFix('missing-cache-headers', 'next', { sourceFile: 'app/api/users/[id]/route.ts' })
    expect(fix.codeSnippet).toContain('export const revalidate')
  })
  it('gives Next Pages Router a res.setHeader snippet under pages/', () => {
    const fix = resolveFix('missing-cache-headers', 'next', { sourceFile: 'pages/api/users.ts' })
    expect(fix.codeSnippet).toContain('res.setHeader')
  })
})

describe('resolveFix — n+1 and slow-dependency give guidance', () => {
  it('n+1 explains eager-load/batch with a route in the text', () => {
    const fix = resolveFix('n-plus-one', 'express', { routePattern: '/api/posts' })
    expect(fix.explanation.toLowerCase()).toContain('n+1')
    expect(fix.explanation).toContain('/api/posts')
  })
  it('slow-dependency suggests index/cache/timeout', () => {
    const fix = resolveFix('slow-dependency', 'fastify')
    expect(fix.explanation.toLowerCase()).toMatch(/index|cache|timeout/)
  })
})
