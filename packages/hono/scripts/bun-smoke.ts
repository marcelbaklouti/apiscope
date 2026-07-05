import { Hono } from 'hono'
import { apiscopeHono } from '../src/index'

const receivedBodies: string[] = []

const fakeCollector = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    if (request.method === 'POST' && new URL(request.url).pathname === '/ingest') {
      receivedBodies.push(await request.text())
      return Response.json({ accepted: true }, { status: 202 })
    }
    return new Response('not found', { status: 404 })
  }
})

const app = new Hono()
const adapter = apiscopeHono(app, {
  appName: 'bun-smoke',
  collectorUrl: `http://127.0.0.1:${fakeCollector.port}`,
  mode: 'immediate'
})
app.get('/ping/:name', (c) => c.json({ pong: c.req.param('name') }))

const response = await app.request('http://localhost/ping/bun')
if (response.status !== 200) {
  console.error(`unexpected status ${response.status}`)
  process.exit(1)
}
await new Promise((resolve) => setTimeout(resolve, 500))
await adapter.shutdown()
fakeCollector.stop()

const types = receivedBodies.map((body) => (JSON.parse(body) as { type: string }).type)
if (!types.includes('handshake') || !types.includes('span-batch')) {
  console.error(`missing wire messages, received: ${types.join(', ')}`)
  process.exit(1)
}
const batch = receivedBodies
  .map((body) => JSON.parse(body) as { type: string; spans?: Array<{ routePattern: string | null; runtime: string }> })
  .find((message) => message.type === 'span-batch')
if (batch?.spans?.[0]?.routePattern !== '/ping/:name' || batch.spans[0].runtime !== 'bun') {
  console.error('span content mismatch')
  process.exit(1)
}
console.log('bun smoke passed')
