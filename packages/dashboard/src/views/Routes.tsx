import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useDashboardStore } from '../lib/store'
import { Sparkline } from '../components/Sparkline'
import type { RouteStatsEntry } from '../lib/types'

export function Routes() {
  const [stats, setStats] = useState<RouteStatsEntry[]>([])
  const routes = useDashboardStore((state) => state.routes)
  const spans = useDashboardStore((state) => state.spans)
  useEffect(() => {
    void api.routeStats().then(setStats).catch(() => setStats([]))
  }, [spans.length])
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
          <th>count</th>
          <th>errors</th>
          <th>p50</th>
          <th>p95</th>
          <th>p99</th>
          <th>trend</th>
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
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
