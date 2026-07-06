import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCollector } from '@apiscope/collector'

const dashboardDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

const insufficientCollector = createCollector({
  dbPath: ':memory:',
  port: 4656,
  dashboardDir,
  meta: { collector: { port: 4656 } }
})
await insufficientCollector.listen()
await insufficientCollector.store.replaceRoutes('empty-app', [{ method: 'GET', pattern: '/api/users/:id' }])

const cleanCollector = createCollector({
  dbPath: ':memory:',
  port: 4657,
  dashboardDir,
  meta: { collector: { port: 4657 } }
})
await cleanCollector.listen()
await cleanCollector.store.replaceRoutes('clean-app', [
  { method: 'GET', pattern: '/api/health' },
  { method: 'GET', pattern: '/api/users/:id' }
])

const now = Date.now()
const healthySpans = Array.from({ length: 40 }, (unused, index) => ({
  id: `clean-${index}`,
  traceId: `clean-trace-${index}`,
  method: 'GET',
  routePattern: index % 2 === 0 ? '/api/health' : '/api/users/:id',
  actualPath: index % 2 === 0 ? '/api/health' : `/api/users/${index}`,
  statusCode: 200,
  timing: { start: now - index * 500, ttfb: 3, duration: 6 + (index % 5) * 3 },
  framework: 'express',
  runtime: 'node',
  request: { headers: { accept: 'application/json' }, truncated: false, redactedHeaders: [] },
  response: {
    headers: {
      'content-type': 'application/json',
      'content-encoding': 'gzip',
      'content-length': '320',
      'cache-control': 'public, max-age=60'
    },
    truncated: false,
    redactedHeaders: []
  }
}))

await cleanCollector.store.insertBatch('clean-app', { spans: healthySpans, childSpans: [] })

console.log('seeded insufficient collector on 4656 and all-clear collector on 4657')
