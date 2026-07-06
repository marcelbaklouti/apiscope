import { afterEach, describe, expect, it } from 'vitest'
import { createCollector, type Collector } from '@apiscope/collector'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createCollectorClient } from '../src/client'
import { createMcpServer } from '../src/server'

let collector: Collector

afterEach(async () => {
  await collector.close()
})

function parseToolResultText(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const [first] = result.content
  if (first === undefined || first.type !== 'text' || first.text === undefined) {
    throw new Error('expected a single text content block')
  }
  return JSON.parse(first.text)
}

describe('mcp protocol round trip', () => {
  it('calls list_routes and query_spans as real mcp tool invocations over a linked transport pair', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0 })
    const { port } = await collector.listen()
    await collector.store.replaceRoutes('demo', [{ method: 'GET', pattern: '/users/:id' }])
    await collector.store.insertBatch('demo', {
      spans: [
        {
          id: '1',
          traceId: 't',
          method: 'GET',
          routePattern: '/users/:id',
          actualPath: '/users/1',
          statusCode: 200,
          timing: { start: 1, ttfb: null, duration: 5 },
          framework: 'express',
          runtime: 'node'
        }
      ],
      childSpans: []
    })

    const collectorClient = createCollectorClient(`http://127.0.0.1:${port}`)
    const mcpServer = createMcpServer(collectorClient)

    const mcpClient = new Client({ name: 'test-client', version: '0.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

    await Promise.all([mcpServer.connect(serverTransport), mcpClient.connect(clientTransport)])

    const listRoutesResult = await mcpClient.callTool({ name: 'list_routes', arguments: {} })
    const routes = parseToolResultText(listRoutesResult as { content: Array<{ type: string; text?: string }> })
    expect(Array.isArray(routes)).toBe(true)
    expect((routes as Array<{ pattern: string }>).some((route) => route.pattern === '/users/:id')).toBe(true)

    const querySpansResult = await mcpClient.callTool({ name: 'query_spans', arguments: { limit: 10 } })
    const spans = parseToolResultText(querySpansResult as { content: Array<{ type: string; text?: string }> })
    expect(Array.isArray(spans)).toBe(true)
    expect((spans as unknown[]).length).toBeGreaterThan(0)

    await mcpClient.close()
    await mcpServer.close()
  })
})
