import { parseExpressApp } from 'express-route-parser'
import type { Express } from 'express'
import type { RouteRegistryEntry } from '@apiscope/core'

export function extractExpressRoutes(app: Express): RouteRegistryEntry[] {
  const entries: RouteRegistryEntry[] = []
  for (const route of parseExpressApp(app)) {
    if (typeof route.path !== 'string') continue
    const method = route.method.toUpperCase()
    if (method === 'HEAD') continue
    const pattern = route.path.replace(/\/{2,}/g, '/')
    entries.push({ method, pattern })
  }
  return entries
}
