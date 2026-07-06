import { useDashboardStore } from '../lib/store'
import { Link } from '../lib/router'
import { MetricExplainer } from '../components/MetricExplainer'

export function Overview() {
  const spans = useDashboardStore((state) => state.spans)
  const apps = useDashboardStore((state) => state.apps)
  const routes = useDashboardStore((state) => state.routes)
  if (spans.length === 0 && apps.length === 0) {
    return (
      <div className="empty">
        no traffic yet — add an apiscope adapter to your app and send a request
      </div>
    )
  }
  const errorCount = spans.filter((span) => span.statusCode >= 500).length
  const statusBuckets = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 }
  for (const span of spans) {
    if (span.statusCode >= 500) statusBuckets['5xx'] += 1
    else if (span.statusCode >= 400) statusBuckets['4xx'] += 1
    else if (span.statusCode >= 300) statusBuckets['3xx'] += 1
    else statusBuckets['2xx'] += 1
  }
  const recentErrors = spans.filter((span) => span.statusCode >= 500).slice(0, 5)
  return (
    <div className="grid-2">
      <section className="card">
        <h2>traffic</h2>
        <p className="metric" data-testid="span-count">
          {spans.length} requests buffered,{' '}
          <MetricExplainer
            label="server errors"
            explanation="Share of recent requests that failed with a 5xx status. Anything above zero is worth a look."
          >
            {errorCount} server errors
          </MetricExplainer>
        </p>
        <table>
          <tbody>
            {Object.entries(statusBuckets).map(([bucket, count]) => (
              <tr key={bucket}>
                <td>{bucket}</td>
                <td className="num">{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card">
        <h2>apps</h2>
        {apps.length === 0 ? (
          <p className="empty">no adapter connected</p>
        ) : (
          <table>
            <tbody>
              {apps.map((app) => (
                <tr key={app.name}>
                  <td>{app.name}</td>
                  <td>{app.framework}</td>
                  <td>{app.runtime}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="metric">{routes.length} registered routes</p>
      </section>
      <section className="card">
        <h2>recent errors</h2>
        {recentErrors.length === 0 ? (
          <p className="empty">none</p>
        ) : (
          <ul>
            {recentErrors.map((span) => (
              <li key={span.id}>
                <Link to={`/inspector/${span.id}`}>
                  {span.method} {span.actualPath} → {span.statusCode}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
