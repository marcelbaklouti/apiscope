import type { AdvisorContext, AnalyzeResult, Finding, FindingCategory, FindingSeverity } from './types'

export interface Rule {
  id: string
  category: FindingCategory
  detect(context: AdvisorContext): Finding[]
}

const SEVERITY_WEIGHT: Record<FindingSeverity, number> = { critical: 3, warning: 2, advisory: 1 }

function scoreOf(finding: Finding, totalSpans: number): number {
  const trafficShare = Math.min(1, Math.max(0.05, finding.sampleSize / Math.max(totalSpans, 1)))
  const fixability = finding.fix.codeSnippet !== undefined ? 1 : 0.6
  return SEVERITY_WEIGHT[finding.severity] * trafficShare * fixability
}

export function rankFindings(findings: Finding[], totalSpans: number): Finding[] {
  return [...findings].sort((left, right) => scoreOf(right, totalSpans) - scoreOf(left, totalSpans))
}

export function runRules(rules: Rule[], context: AdvisorContext): AnalyzeResult {
  const findings: Finding[] = []
  const rulesRun: string[] = []
  for (const rule of rules) {
    if (context.config.rules[rule.id]?.enabled === false) continue
    rulesRun.push(rule.id)
    try {
      findings.push(...rule.detect(context))
    } catch {
      continue
    }
  }
  return {
    findings: rankFindings(findings, context.spans.length),
    rulesRun,
    insufficientData: context.spans.length < context.config.minimumOverallSampleSize
  }
}
