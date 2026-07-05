import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { RouteRegistryEntry } from '@apiscope/core'

const httpMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'QUERY'] as const

function listFiles(directory: string): string[] {
  const entries: string[] = []
  for (const name of readdirSync(directory)) {
    const fullPath = join(directory, name)
    if (statSync(fullPath).isDirectory()) entries.push(...listFiles(fullPath))
    else entries.push(fullPath)
  }
  return entries
}

function segmentToPattern(segment: string): string | null {
  if (segment.startsWith('(') && segment.endsWith(')')) return null
  if (segment.startsWith('@')) return null
  const optionalCatchAll = segment.match(/^\[\[\.\.\.(.+)\]\]$/)
  if (optionalCatchAll?.[1] !== undefined) return `:${optionalCatchAll[1]}*`
  const catchAll = segment.match(/^\[\.\.\.(.+)\]$/)
  if (catchAll?.[1] !== undefined) return `:${catchAll[1]}*`
  const dynamic = segment.match(/^\[(.+)\]$/)
  if (dynamic?.[1] !== undefined) return `:${dynamic[1]}`
  return segment
}

function segmentsToPattern(segments: string[]): string {
  const mapped = segments.map(segmentToPattern).filter((segment): segment is string => segment !== null)
  return `/${mapped.join('/')}`.replace(/\/{2,}/g, '/') || '/'
}

function exportedMethods(filePath: string): string[] {
  const content = readFileSync(filePath, 'utf8')
  return httpMethods.filter((method) =>
    new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${method}\\b`).test(content)
  )
}

function scanAppDirectory(projectDir: string, appDir: string, entries: RouteRegistryEntry[]): void {
  if (!existsSync(appDir)) return
  for (const filePath of listFiles(appDir)) {
    if (!/[/\\]route\.(ts|js|mjs|tsx)$/.test(filePath)) continue
    const relativeToApp = relative(appDir, filePath).split(sep)
    const pattern = segmentsToPattern(relativeToApp.slice(0, -1))
    const sourceFile = relative(projectDir, filePath).split(sep).join('/')
    for (const method of exportedMethods(filePath)) entries.push({ method, pattern, sourceFile })
  }
}

function scanPagesApi(projectDir: string, pagesApiDir: string, entries: RouteRegistryEntry[]): void {
  if (!existsSync(pagesApiDir)) return
  for (const filePath of listFiles(pagesApiDir)) {
    if (!/\.(ts|js|mjs|tsx)$/.test(filePath)) continue
    const relativeSegments = relative(pagesApiDir, filePath).split(sep)
    const fileName = relativeSegments.pop() ?? ''
    const baseName = fileName.replace(/\.(ts|js|mjs|tsx)$/, '')
    if (baseName !== 'index') relativeSegments.push(baseName)
    const pattern = segmentsToPattern(['api', ...relativeSegments])
    const sourceFile = relative(projectDir, filePath).split(sep).join('/')
    entries.push({ method: '*', pattern, sourceFile })
  }
}

export function scanNextRoutes(projectDir: string): RouteRegistryEntry[] {
  const entries: RouteRegistryEntry[] = []
  scanAppDirectory(projectDir, join(projectDir, 'app'), entries)
  scanAppDirectory(projectDir, join(projectDir, 'src', 'app'), entries)
  scanPagesApi(projectDir, join(projectDir, 'pages', 'api'), entries)
  scanPagesApi(projectDir, join(projectDir, 'src', 'pages', 'api'), entries)
  return entries
}

interface CompiledPattern {
  pattern: string
  regex: RegExp
  paramCount: number
}

function compile(pattern: string): CompiledPattern {
  let paramCount = 0
  const source = pattern
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':') && segment.endsWith('*')) {
        paramCount += 10
        return '.*'
      }
      if (segment.startsWith(':')) {
        paramCount += 1
        return '[^/]+'
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('/')
  return { pattern, regex: new RegExp(`^${source}/?$`), paramCount }
}

export function matchRoutePattern(patterns: string[], actualPath: string): string | null {
  const matches = patterns
    .map(compile)
    .filter((compiled) => compiled.regex.test(actualPath))
    .sort((a, b) => a.paramCount - b.paramCount || b.pattern.length - a.pattern.length)
  return matches[0]?.pattern ?? null
}
