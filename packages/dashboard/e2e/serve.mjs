import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCollector } from '@apiscope/collector'

const dashboardDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const collector = createCollector({
  dbPath: ':memory:',
  port: 4655,
  dashboardDir,
  meta: { collector: { port: 4655 } }
})

await collector.listen()

await collector.store.replaceRoutes('seed-app', [
  { method: 'GET', pattern: '/api/users/:id', sourceFile: 'app/api/users/[id]/route.ts' },
  { method: 'POST', pattern: '/api/orders' },
  { method: 'GET', pattern: '/api/report', sourceFile: 'app/api/report/route.ts' }
])

const now = Date.now()
const uncompressedJsonResponse = {
  headers: { 'content-type': 'application/json', 'content-length': '30000' },
  truncated: false,
  redactedHeaders: []
}

const spans = Array.from({ length: 40 }, (unused, index) => ({
  id: `seed-${index}`,
  traceId: `trace-${index}`,
  method: index % 4 === 3 ? 'POST' : 'GET',
  routePattern: index % 4 === 3 ? '/api/orders' : '/api/users/:id',
  actualPath: index % 4 === 3 ? '/api/orders' : `/api/users/${index}`,
  statusCode: index === 5 ? 500 : 200,
  timing: { start: now - index * 800, ttfb: 4, duration: 8 + (index % 10) * 6 },
  framework: 'express',
  runtime: 'node',
  ...(index === 5 ? { error: { message: 'seeded failure' } } : {}),
  request: {
    headers: { accept: 'application/json', authorization: '[redacted]' },
    truncated: false,
    redactedHeaders: ['authorization']
  },
  ...(index % 4 === 3 ? {} : { response: { ...uncompressedJsonResponse } })
}))

const reportSpans = Array.from({ length: 25 }, (unused, index) => ({
  id: `seed-report-${index}`,
  traceId: `trace-report-${index}`,
  method: 'GET',
  routePattern: '/api/report',
  actualPath: '/api/report',
  statusCode: 200,
  timing: { start: now - index * 700, ttfb: 40, duration: 600 + (index % 8) * 25 },
  framework: 'express',
  runtime: 'node',
  request: {
    headers: { accept: 'application/json' },
    truncated: false,
    redactedHeaders: []
  }
}))

const nPlusOneChildSpans = Array.from({ length: 6 }, (unused, index) => ({
  id: `seed-child-db-${index}`,
  parentSpanId: 'seed-4',
  traceId: 'trace-4',
  kind: 'db',
  system: 'postgresql',
  statement: `SELECT * FROM comments WHERE user_id = ${index}`,
  operation: 'SELECT',
  target: 'appdb',
  rowCount: 1,
  timing: { start: now + index, ttfb: null, duration: 3 }
}))

await collector.store.insertBatch('seed-app', {
  spans: [...spans, ...reportSpans],
  childSpans: [
    {
      id: 'seed-child-1',
      parentSpanId: 'seed-0',
      traceId: 'trace-0',
      kind: 'fetch',
      url: 'http://127.0.0.1:9999/downstream',
      method: 'GET',
      statusCode: 200,
      timing: { start: now + 2, ttfb: 3, duration: 5 }
    },
    {
      id: 'seed-child-db',
      parentSpanId: 'seed-4',
      traceId: 'trace-4',
      kind: 'db',
      system: 'postgresql',
      statement: "SELECT * FROM users WHERE id = 4",
      operation: 'SELECT',
      target: 'appdb',
      rowCount: 1,
      timing: { start: now + 1, ttfb: null, duration: 2 }
    },
    ...nPlusOneChildSpans
  ]
})

console.log('seeded collector on 4655 with 65 spans')
