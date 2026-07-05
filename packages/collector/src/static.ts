import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import type { DynamicHandler } from './server'

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
}

const reservedPrefixes = ['/api', '/ingest', '/health', '/ws']

export function createStaticHandler(dashboardDir: string): DynamicHandler {
  return (request, response, url) => {
    if (request.method !== 'GET') return false
    if (reservedPrefixes.some((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`))) {
      return false
    }
    const decoded = decodeURIComponent(url.pathname)
    const resolved = normalize(join(dashboardDir, decoded))
    const withinRoot = resolved === dashboardDir || resolved.startsWith(`${dashboardDir}${sep}`)
    const servable = withinRoot && existsSync(resolved) && statSync(resolved).isFile()
    const filePath = servable ? resolved : join(dashboardDir, 'index.html')
    if (!existsSync(filePath)) return false
    const contentType = contentTypes[extname(filePath)] ?? 'application/octet-stream'
    response.writeHead(200, { 'content-type': contentType })
    response.end(readFileSync(filePath))
    return true
  }
}
