import { Counter, Gauge, Histogram, Registry } from 'prom-client'

export interface CollectorMetrics {
  registry: Registry
  recordIngestedSpans(appName: string, count: number): void
  recordDroppedSpans(appName: string, count: number): void
  recordRequest(appName: string, statusCode: number): void
  setLiveSubscribers(count: number): void
  observeInsertSeconds(seconds: number): void
  render(): Promise<string>
}

function statusClass(statusCode: number): string {
  if (statusCode >= 500 || statusCode === 0) return '5xx'
  if (statusCode >= 400) return '4xx'
  if (statusCode >= 300) return '3xx'
  return '2xx'
}

export function createMetrics(): CollectorMetrics {
  const registry = new Registry()
  const ingested = new Counter({ name: 'apiscope_ingested_spans_total', help: 'spans stored', labelNames: ['app'], registers: [registry] })
  const dropped = new Counter({ name: 'apiscope_dropped_spans_total', help: 'spans dropped by adapters or sampling', labelNames: ['app'], registers: [registry] })
  const requests = new Counter({ name: 'apiscope_requests_total', help: 'requests by status class', labelNames: ['app', 'status_class'], registers: [registry] })
  const subscribers = new Gauge({ name: 'apiscope_live_subscribers', help: 'active dashboard live subscribers', registers: [registry] })
  const insertSeconds = new Histogram({ name: 'apiscope_store_insert_seconds', help: 'store insert duration', buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1], registers: [registry] })

  return {
    registry,
    recordIngestedSpans(appName, count) {
      if (count > 0) ingested.labels(appName).inc(count)
    },
    recordDroppedSpans(appName, count) {
      if (count > 0) dropped.labels(appName).inc(count)
    },
    recordRequest(appName, statusCode) {
      requests.labels(appName, statusClass(statusCode)).inc()
    },
    setLiveSubscribers(count) {
      subscribers.set(count)
    },
    observeInsertSeconds(seconds) {
      insertSeconds.observe(seconds)
    },
    render() {
      return registry.metrics()
    }
  }
}
