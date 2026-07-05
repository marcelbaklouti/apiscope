import { createRequire } from 'node:module'

const requireFromHere = createRequire(import.meta.url)

export function requireOptional(moduleName: string): unknown {
  return requireFromHere(moduleName)
}
