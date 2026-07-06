import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../lib/api'
import { useDashboardStore } from '../lib/store'
import type { Finding } from '../lib/types'
import { FindingCard } from '../components/FindingCard'
import { HealthVerdict } from '../components/HealthVerdict'

type Grouping = 'severity' | 'category' | 'route'

function findingKey(finding: Finding): string {
  return `${finding.ruleId}::${finding.scope.routePattern ?? ''}`
}

function parseMetric(metric: string, prefix: string): number | null {
  if (!metric.startsWith(prefix)) return null
  const value = Number.parseFloat(metric.slice(prefix.length))
  return Number.isFinite(value) ? value : null
}

function deriveTopStats(findings: Finding[]): {
  slowestRoute: string | null
  slowestP95Ms: number | null
  errorRatePct: number | null
} {
  let slowestRoute: string | null = null
  let slowestP95Ms: number | null = null
  let errorRatePct: number | null = null
  for (const finding of findings) {
    if (finding.ruleId === 'slow-route') {
      const p95 = parseMetric(finding.impact.metric, 'p95=')
      if (p95 !== null && (slowestP95Ms === null || p95 > slowestP95Ms)) {
        slowestP95Ms = p95
        slowestRoute = finding.scope.routePattern ?? null
      }
    }
    if (finding.ruleId === 'error-hotspot' && errorRatePct === null) {
      const rate = parseMetric(finding.impact.metric, 'errorRate=')
      if (rate !== null) errorRatePct = rate
    }
  }
  return { slowestRoute, slowestP95Ms, errorRatePct }
}

const SEVERITY_ORDER: Finding['severity'][] = ['critical', 'warning', 'advisory']
const SEVERITY_HEADING: Record<Finding['severity'], string> = {
  critical: 'fix now',
  warning: 'worth fixing',
  advisory: 'good to know'
}

function groupFindings(findings: Finding[], grouping: Grouping): Array<{ key: string; label: string; items: Finding[] }> {
  if (grouping === 'severity') {
    return SEVERITY_ORDER.map((severity) => ({
      key: severity,
      label: SEVERITY_HEADING[severity],
      items: findings.filter((finding) => finding.severity === severity)
    })).filter((group) => group.items.length > 0)
  }
  const buckets = new Map<string, Finding[]>()
  for (const finding of findings) {
    const bucket = grouping === 'category' ? finding.category : finding.scope.routePattern ?? 'across the app'
    buckets.set(bucket, [...(buckets.get(bucket) ?? []), finding])
  }
  return [...buckets.entries()].map(([label, items]) => ({ key: label, label, items }))
}

const REFRESH_INTERVAL_MS = 4000

export function Insights(): ReactNode {
  const insights = useDashboardStore((state) => state.insights)
  const insightsLoading = useDashboardStore((state) => state.insightsLoading)
  const insightsError = useDashboardStore((state) => state.insightsError)
  const dismissed = useDashboardStore((state) => state.insightsDismissed)
  const grouping = useDashboardStore((state) => state.insightsGrouping)
  const spanCount = useDashboardStore((state) => state.spans.length)
  const setInsights = useDashboardStore((state) => state.setInsights)
  const setInsightsLoading = useDashboardStore((state) => state.setInsightsLoading)
  const setInsightsError = useDashboardStore((state) => state.setInsightsError)
  const dismissFinding = useDashboardStore((state) => state.dismissFinding)
  const restoreDismissed = useDashboardStore((state) => state.restoreDismissed)
  const setInsightsGrouping = useDashboardStore((state) => state.setInsightsGrouping)

  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())
  const hasLoadedOnce = useRef(false)
  const lastFetchAt = useRef(0)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      lastFetchAt.current = Date.now()
      if (!hasLoadedOnce.current) setInsightsLoading(true)
      api
        .insights()
        .then((response) => {
          if (cancelled) return
          hasLoadedOnce.current = true
          setInsights(response)
        })
        .catch(() => {
          if (cancelled) return
          hasLoadedOnce.current = true
          setInsightsError("couldn't analyze right now")
        })
    }
    load()
    const interval = setInterval(() => {
      if (Date.now() - lastFetchAt.current >= REFRESH_INTERVAL_MS - 50) load()
    }, REFRESH_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [setInsights, setInsightsError, setInsightsLoading])

  useEffect(() => {
    if (!hasLoadedOnce.current) return
    if (Date.now() - lastFetchAt.current < 1500) return
    lastFetchAt.current = Date.now()
    api
      .insights()
      .then((response) => setInsights(response))
      .catch(() => setInsightsError("couldn't analyze right now"))
  }, [spanCount, setInsights, setInsightsError])

  const visibleFindings = useMemo(() => {
    if (insights === null) return []
    return insights.findings.filter((finding) => !dismissed.includes(findingKey(finding)))
  }, [insights, dismissed])

  const toggle = (key: string) => {
    setExpandedKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (insights === null && insightsLoading) {
    return (
      <div className="insights">
        <div className="insights-state" data-testid="insights-loading" aria-busy="true">
          <h2>Reading your traffic</h2>
          <p>Analyzing recent requests, downstream calls, and route timings.</p>
        </div>
        <div className="insights-list">
          <div className="insights-skeleton" />
          <div className="insights-skeleton" />
          <div className="insights-skeleton" />
        </div>
      </div>
    )
  }

  if ((insights?.error ?? insightsError) !== null && (insights?.error ?? insightsError) !== undefined) {
    return (
      <div className="insights">
        <div className="insights-state" data-kind="error" data-testid="insights-error" role="status">
          <h2>couldn't analyze right now</h2>
          <p>The advisor hit an error reading the collector. It will retry as new traffic arrives.</p>
        </div>
      </div>
    )
  }

  if (insights !== null && !insights.advisorEnabled) {
    return (
      <div className="insights">
        <div className="insights-state" data-testid="insights-disabled">
          <h2>Advisor is off</h2>
          <p>Insights are disabled in this collector's config. Enable the advisor block to get guidance here.</p>
        </div>
      </div>
    )
  }

  if (insights !== null && insights.insufficientData) {
    return (
      <div className="insights">
        <div className="insights-state" data-testid="insights-insufficient">
          <h2>still gathering</h2>
          <p>drive some traffic and the advisor will start turning it into concrete, paste-ready fixes.</p>
        </div>
      </div>
    )
  }

  const topStats = deriveTopStats(visibleFindings)

  if (insights !== null && visibleFindings.length === 0) {
    return (
      <div className="insights">
        <HealthVerdict findings={[]} windowSampleSize={insights.windowSampleSize} topStats={topStats} />
        <div className="insights-state" data-testid="insights-empty">
          <h2>No issues found</h2>
          <p>Here's what we checked against your recent traffic. We'll speak up the moment something regresses.</p>
          <div className="insights-checked" data-testid="insights-checked">
            {insights.rulesRun.map((rule) => (
              <span className="insights-check" key={rule}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M2.5 6.2 5 8.7l4.5-5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {rule}
              </span>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (insights === null) {
    return (
      <div className="insights">
        <div className="insights-state" data-testid="insights-loading" aria-busy="true">
          <h2>Reading your traffic</h2>
          <p>Analyzing recent requests, downstream calls, and route timings.</p>
        </div>
      </div>
    )
  }

  const groups = groupFindings(visibleFindings, grouping)
  let renderIndex = 0

  return (
    <div className="insights">
      <HealthVerdict findings={visibleFindings} windowSampleSize={insights.windowSampleSize} topStats={topStats} />

      <div className="insights-toolbar">
        <span className="insights-toolbar-label">group by</span>
        <div className="insights-group" data-testid="insights-grouping" role="group" aria-label="group findings">
          {(['severity', 'category', 'route'] as Grouping[]).map((option) => (
            <button
              key={option}
              type="button"
              data-selected={grouping === option}
              onClick={() => setInsightsGrouping(option)}
            >
              {option}
            </button>
          ))}
        </div>
        {dismissed.length > 0 && (
          <button
            type="button"
            className="insights-restore"
            data-testid="insights-restore"
            onClick={restoreDismissed}
          >
            restore dismissed ({dismissed.length})
          </button>
        )}
      </div>

      <div className="insights-list" data-testid="insights-list">
        {groups.map((group) => (
          <div className="insights-group-block" key={group.key}>
            <div className="insights-group-heading">
              {group.label}
              <span className="mono">{group.items.length}</span>
            </div>
            {group.items.map((finding) => {
              const key = findingKey(finding)
              const stagger = renderIndex
              renderIndex += 1
              return (
                <div key={key} style={{ ['--stagger-index' as string]: String(stagger) }}>
                  <FindingCard
                    finding={finding}
                    expanded={expandedKeys.has(key)}
                    onToggle={() => toggle(key)}
                    onDismiss={() => dismissFinding(finding.ruleId, finding.scope.routePattern)}
                  />
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
