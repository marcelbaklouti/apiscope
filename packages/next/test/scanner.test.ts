import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { matchRoutePattern, scanNextRoutes } from '../src/scanner'

function writeFixture(root: string, relativePath: string, content: string): void {
  const filePath = join(root, relativePath)
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
}

describe('scanNextRoutes', () => {
  it('maps app router route handlers with dynamic segments', () => {
    const root = mkdtempSync(join(tmpdir(), 'apiscope-next-'))
    writeFixture(root, 'app/api/users/[id]/route.ts', 'export async function GET() {}\nexport async function DELETE() {}')
    writeFixture(root, 'app/api/(admin)/reports/[...slug]/route.ts', 'export async function GET() {}')
    writeFixture(root, 'app/@modal/ignored/page.tsx', 'export default function Page() {}')
    const routes = scanNextRoutes(root)
    expect(routes).toContainEqual({ method: 'GET', pattern: '/api/users/:id', sourceFile: 'app/api/users/[id]/route.ts' })
    expect(routes).toContainEqual({ method: 'DELETE', pattern: '/api/users/:id', sourceFile: 'app/api/users/[id]/route.ts' })
    expect(routes).toContainEqual({
      method: 'GET',
      pattern: '/api/reports/:slug*',
      sourceFile: 'app/api/(admin)/reports/[...slug]/route.ts'
    })
  })

  it('maps pages api files including index and optional catch-all', () => {
    const root = mkdtempSync(join(tmpdir(), 'apiscope-next-'))
    writeFixture(root, 'pages/api/health.ts', 'export default function handler() {}')
    writeFixture(root, 'pages/api/orders/index.ts', 'export default function handler() {}')
    writeFixture(root, 'pages/api/files/[[...path]].ts', 'export default function handler() {}')
    const routes = scanNextRoutes(root)
    expect(routes).toContainEqual({ method: '*', pattern: '/api/health', sourceFile: 'pages/api/health.ts' })
    expect(routes).toContainEqual({ method: '*', pattern: '/api/orders', sourceFile: 'pages/api/orders/index.ts' })
    expect(routes).toContainEqual({ method: '*', pattern: '/api/files/:path*', sourceFile: 'pages/api/files/[[...path]].ts' })
  })

  it('supports the src directory layout', () => {
    const root = mkdtempSync(join(tmpdir(), 'apiscope-next-'))
    writeFixture(root, 'src/app/api/ping/route.ts', 'export function GET() {}')
    expect(scanNextRoutes(root)).toContainEqual({
      method: 'GET',
      pattern: '/api/ping',
      sourceFile: 'src/app/api/ping/route.ts'
    })
  })

  it('returns an empty registry for projects without route files', () => {
    const root = mkdtempSync(join(tmpdir(), 'apiscope-next-'))
    expect(scanNextRoutes(root)).toEqual([])
  })
})

describe('matchRoutePattern', () => {
  const patterns = ['/api/users/:id', '/api/users/me', '/api/reports/:slug*', '/api/ping']

  it('prefers static over dynamic matches', () => {
    expect(matchRoutePattern(patterns, '/api/users/me')).toBe('/api/users/me')
    expect(matchRoutePattern(patterns, '/api/users/42')).toBe('/api/users/:id')
  })

  it('matches catch-all patterns across segments', () => {
    expect(matchRoutePattern(patterns, '/api/reports/2026/q3')).toBe('/api/reports/:slug*')
  })

  it('returns null without a match', () => {
    expect(matchRoutePattern(patterns, '/api/unknown')).toBeNull()
  })
})
