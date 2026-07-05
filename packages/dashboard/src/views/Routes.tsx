import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useDashboardStore } from '../lib/store'
import { Sparkline } from '../components/Sparkline'
import type { RouteStatsEntry } from '../lib/types'

export function Routes() {
  const [stats, setStats] = useState<RouteStatsEntry[]>([])
  const routes = useDashboardStore((state) => state.routes)
  const spans = useDashboardStore((state) => state.spans)
  const refreshRoutes = useDashboardStore((state) => state.refreshRoutes)
  useEffect(() => {
    void api.routeStats().then(setStats).catch(() => setStats([]))
    void api.routes().then(refreshRoutes).catch(() => {})
  }, [spans.length, refreshRoutes])
  if (routes.length === 0 && stats.length === 0) {
    return <div className="empty">no routes registered yet</div>
  }
  const statsFor = (method: string, pattern: string) =>
    stats.find((entry) => entry.method === method && entry.routePattern === pattern)
  const durationsFor = (method: string, pattern: string) =>
    spans
      .filter((span) => span.method === method && span.routePattern === pattern)
      .slice(0, 40)
      .map((span) => span.timing.duration)
      .reverse()
  return (
    <table>
      <thead>
        <tr>
          <th>method</th>
          <th>pattern</th>
          <th>app</th>
          <th>source</th>
          <th className="num">count</th>
          <th className="num">errors</th>
          <th className="num">p50</th>
          <th className="num">p95</th>
          <th className="num">p99</th>
          <th>trend</th>
          <th>n+1</th>
        </tr>
      </thead>
      <tbody>
        {routes.map((route) => {
          const routeStats = statsFor(route.method, route.pattern)
          return (
            <tr key={`${route.appName}-${route.method}-${route.pattern}`}>
              <td className="mono">{route.method}</td>
              <td className="mono">{route.pattern}</td>
              <td>{route.appName}</td>
              <td className="mono">{route.sourceFile ?? ''}</td>
              <td className="num">{routeStats?.count ?? 0}</td>
              <td className="num">{routeStats?.errorCount ?? 0}</td>
              <td className="num">{routeStats === undefined ? '' : `${routeStats.p50.toFixed(1)}ms`}</td>
              <td className="num">{routeStats === undefined ? '' : `${routeStats.p95.toFixed(1)}ms`}</td>
              <td className="num">{routeStats === undefined ? '' : `${routeStats.p99.toFixed(1)}ms`}</td>
              <td>
                <Sparkline values={durationsFor(route.method, route.pattern)} />
              </td>
              <td data-testid="n-plus-one-indicator">
                {route.nPlusOneRequests > 0 && (
                  <span className="num" style={{ color: 'var(--status-4xx)' }}>
                    {route.nPlusOneRequests}
                  </span>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
