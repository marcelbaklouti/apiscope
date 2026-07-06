import type { FindingFix } from '../types'
import { FIX_TEMPLATES, GENERIC_FALLBACK, type FixParams } from './templates'

export type { FixParams } from './templates'

const SUPPORTED_FRAMEWORKS = new Set(['express', 'fastify', 'next', 'nestjs', 'hono'])

export function resolveFix(ruleId: string, framework: string, params: FixParams = {}): FindingFix {
  const entry = FIX_TEMPLATES[ruleId]
  if (typeof entry === 'function') return entry(framework, params)
  if (entry !== undefined && SUPPORTED_FRAMEWORKS.has(framework)) {
    const template = entry[framework]
    if (template !== undefined) return template(framework, params)
  }
  const fallback = GENERIC_FALLBACK[ruleId]
  if (fallback !== undefined) return fallback(framework, params)
  return {
    framework,
    explanation: 'Review this finding and apply the standard remedy for your framework.',
    docsUrl: 'https://developer.mozilla.org/en-US/docs/Web/HTTP'
  }
}
