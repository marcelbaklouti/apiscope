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
  { method: 'POST', pattern: '/api/orders' }
])

const now = Date.now()
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
  }
}))

await collector.store.insertBatch('seed-app', {
  spans,
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
    }
  ]
})

console.log('seeded collector on 4655')
