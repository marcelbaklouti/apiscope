import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { CollectorClient } from './client'
import { createMcpServer } from './server'

export async function startStdioServer(client: CollectorClient): Promise<void> {
  const server = createMcpServer(client)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
