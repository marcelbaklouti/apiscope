import type { AdvisorContext, AnalyzeResult } from './types'
import { runRules } from './engine'
import { ALL_RULES } from './rules'

export function analyze(context: AdvisorContext): AnalyzeResult {
  if (!context.config.enabled) return { findings: [], rulesRun: [], insufficientData: true }
  return runRules(ALL_RULES, context)
}
