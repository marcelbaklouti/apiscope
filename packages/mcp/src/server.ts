import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { CollectorClient } from './client'

const serverInfo = { name: 'apiscope', version: '0.0.0' }

function jsonResult(result: unknown): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
}

export function createMcpServer(client: CollectorClient): McpServer {
  const server = new McpServer(serverInfo)

  server.registerTool(
    'list_routes',
    {
      description: "List apiscope's route registry across connected apps",
      inputSchema: {}
    },
    async () => jsonResult(await client.listRoutes())
  )

  server.registerTool(
    'query_spans',
    {
      description: 'Query recent request spans, optionally filtered to a load run',
      inputSchema: {
        limit: z.number().int().positive().optional(),
        loadRunId: z.string().optional()
      }
    },
    async ({ limit, loadRunId }) =>
      jsonResult(
        await client.querySpans({
          ...(limit === undefined ? {} : { limit }),
          ...(loadRunId === undefined ? {} : { loadRunId })
        })
      )
  )

  server.registerTool(
    'get_span_detail',
    {
      description: 'Get a single request span with its child spans, n+1 summary, and timings',
      inputSchema: {
        id: z.string()
      }
    },
    async ({ id }) => jsonResult(await client.getSpan(id))
  )

  server.registerTool(
    'run_load_scenario',
    {
      description: 'Start a load run for a scenario and return its run id without waiting for the result',
      inputSchema: {
        scenario: z.object({}).passthrough(),
        assertions: z.object({}).passthrough().optional()
      }
    },
    async ({ scenario, assertions }) =>
      jsonResult(await client.startLoadRun({ scenario, ...(assertions === undefined ? {} : { assertions }) }))
  )

  server.registerTool(
    'get_run_result',
    {
      description: 'Get a load run summary and result by run id',
      inputSchema: {
        runId: z.string()
      }
    },
    async ({ runId }) => jsonResult(await client.getRun(runId))
  )

  server.registerTool(
    'generate_scenario',
    {
      description: 'Generate a load scenario derived from recently observed traffic',
      inputSchema: {
        baseUrl: z.string(),
        windowMs: z.number().int().positive().optional(),
        shape: z.enum(['steady', 'ramp']).optional()
      }
    },
    async ({ baseUrl, windowMs, shape }) =>
      jsonResult(
        await client.generateScenario({
          baseUrl,
          ...(windowMs === undefined ? {} : { windowMs }),
          ...(shape === undefined ? {} : { shape })
        })
      )
  )

  return server
}
