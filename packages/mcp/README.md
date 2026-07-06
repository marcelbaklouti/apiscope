# @apiscope/mcp

MCP server exposing apiscope's collector API as tools for coding agents.

## Usage

### stdio (local agents)

Add an MCP server entry pointing at the `apiscope` CLI:

```json
{
  "mcpServers": {
    "apiscope": {
      "command": "apiscope",
      "args": ["mcp"]
    }
  }
}
```

By default the server resolves the collector base URL from `--collector`, else the `APISCOPE_COLLECTOR_URL` environment variable, else the configured collector host and port (`http://127.0.0.1:4620` unless overridden in `apiscope.config.ts`).

### Streamable HTTP (remote)

```bash
apiscope mcp --http --port 7000
```

Point a remote MCP client at `http://<host>:7000/`.

## Tools

- `list_routes` — the route registry across connected apps.
- `query_spans` — recent or load-run-filtered request spans.
- `get_span_detail` — a span with its child spans, n+1 summary, and timings.
- `run_load_scenario` — starts a load run and returns its run id.
- `get_run_result` — a load run's summary and result by run id.
- `generate_scenario` — a load scenario derived from recently observed traffic.
