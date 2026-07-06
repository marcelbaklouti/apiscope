import type { ReactNode } from 'react'
import type { Finding } from '../lib/types'

export interface HealthVerdictProps {
  findings: Finding[]
  windowSampleSize: number
  topStats: { slowestRoute: string | null; slowestP95Ms: number | null; errorRatePct: number | null }
}

function humanizeMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

function severityRank(severity: Finding['severity']): number {
  if (severity === 'critical') return 3
  if (severity === 'warning') return 2
  return 1
}

function affectedShare(findings: Finding[], windowSampleSize: number): number | null {
  if (findings.length === 0 || windowSampleSize <= 0) return null
  const largest = findings.reduce((max, finding) => Math.max(max, finding.sampleSize), 0)
  return Math.min(1, largest / windowSampleSize)
}

function headline(findings: Finding[]): string {
  if (findings.length === 0) return 'Looking healthy'
  const worst = findings.reduce(
    (rank, finding) => Math.max(rank, severityRank(finding.severity)),
    1
  )
  const noun = findings.length === 1 ? 'thing' : 'things'
  if (worst === 3) return `${findings.length} ${noun} to fix now`
  return `${findings.length} ${noun} worth fixing`
}

function tone(findings: Finding[]): 'clear' | 'critical' | 'warning' | 'advisory' {
  if (findings.length === 0) return 'clear'
  const worst = findings.reduce((rank, finding) => Math.max(rank, severityRank(finding.severity)), 1)
  if (worst === 3) return 'critical'
  if (worst === 2) return 'warning'
  return 'advisory'
}

export function HealthVerdict(props: HealthVerdictProps): ReactNode {
  const { findings, windowSampleSize, topStats } = props
  const verdictTone = tone(findings)
  const share = affectedShare(findings, windowSampleSize)
  const criticals = findings.filter((finding) => finding.severity === 'critical').length
  const warnings = findings.filter((finding) => finding.severity === 'warning').length
  const advisories = findings.filter((finding) => finding.severity === 'advisory').length

  return (
    <section className="verdict" data-testid="health-verdict" data-tone={verdictTone}>
      <div className="verdict-glow" aria-hidden="true" />
      <div className="verdict-lede">
        <span className="verdict-eyebrow">health check</span>
        <h1 className="verdict-headline">{headline(findings)}</h1>
        {findings.length === 0 ? (
          <p className="verdict-sub">
            Nothing stands out across{' '}
            <span className="mono">{windowSampleSize.toLocaleString()}</span> recent requests. Keep driving
            traffic and we will flag anything that regresses.
          </p>
        ) : (
          <p className="verdict-sub">
            {share !== null ? (
              <>
                Touching up to <span className="mono">{Math.round(share * 100)}%</span> of your recent
                traffic
              </>
            ) : (
              <>Across your recent traffic</>
            )}
            . Start at the top; the list is ranked by impact.
          </p>
        )}
        {findings.length > 0 && (
          <div className="verdict-tally">
            {criticals > 0 && (
              <span className="verdict-count" data-severity="critical">
                <span className="mono">{criticals}</span> critical
              </span>
            )}
            {warnings > 0 && (
              <span className="verdict-count" data-severity="warning">
                <span className="mono">{warnings}</span> warning
              </span>
            )}
            {advisories > 0 && (
              <span className="verdict-count" data-severity="advisory">
                <span className="mono">{advisories}</span> advisory
              </span>
            )}
          </div>
        )}
      </div>

      <div className="verdict-stats">
        <div className="verdict-stat" data-testid="verdict-slowest">
          <span className="verdict-stat-label">slowest route</span>
          {topStats.slowestRoute !== null && topStats.slowestP95Ms !== null ? (
            <>
              <span className="verdict-stat-value mono">{humanizeMs(topStats.slowestP95Ms)}</span>
              <span className="verdict-stat-note mono">{topStats.slowestRoute} · p95</span>
            </>
          ) : (
            <span className="verdict-stat-value verdict-stat-empty">all comfortably fast</span>
          )}
        </div>
        <div className="verdict-stat" data-testid="verdict-errorrate">
          <span className="verdict-stat-label">error rate</span>
          {topStats.errorRatePct !== null ? (
            <>
              <span className="verdict-stat-value mono">{topStats.errorRatePct.toFixed(1)}%</span>
              <span className="verdict-stat-note">of recent requests failed</span>
            </>
          ) : (
            <span className="verdict-stat-value verdict-stat-empty">no errors seen</span>
          )}
        </div>
      </div>
    </section>
  )
}
