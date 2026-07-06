# apiscope

Free, local-first API observability and load testing for JavaScript frameworks. Route explorer, live request inspector with latency waterfalls, a coordinated-omission-safe load engine, and CI latency budgets — no account, no cloud, your data never leaves your machine.

## Why

Hosted API monitoring ships your request data to someone else's cloud and bills you for the privilege of watching your own traffic. Every payload, header, and route pattern your app handles ends up on a third party's servers, metered by request volume.

Framework devtools that actually matter — request waterfalls, route registries, payload inspection — are increasingly gated behind paid tiers, turning basic debugging visibility into a recurring line item.

Load-testing tools force a bad tradeoff: GUI-driven tools lock your scenarios into proprietary XML or point-and-click flows that don't diff cleanly in a pull request, while embedded-runtime tools (Lua, custom DSLs) cut you off from the npm ecosystem and the libraries you already use to build fixtures and assertions.

apiscope is MIT-licensed, runs entirely on localhost, and treats its config file as the single diffable source of truth — no dashboard state, no hosted account, no hidden configuration. What you commit is what runs, in dev and in CI.

## Quickstart

```bash
npx apiscope
```

Then add one line to your app:

Next.js (`instrumentation.ts`):

```ts
import { withApiscope } from '@apiscope/next'

const apiscope = withApiscope({ appName: 'web' })
export const register = apiscope.register
export const onRequestError = apiscope.onRequestError
```

Express:

```ts
import { apiscopeExpress } from '@apiscope/express'

app.use(apiscopeExpress({ appName: 'api' }))
```

Fastify:

```ts
import { apiscopeFastify } from '@apiscope/fastify'

await app.register(apiscopeFastify, { appName: 'api' })
```

NestJS:

```ts
import { ApiscopeModule } from '@apiscope/nestjs'

@Module({ imports: [ApiscopeModule.forRoot({ appName: 'api' })] })
export class AppModule {}
```

Hono:

```ts
import { apiscopeHono } from '@apiscope/hono'

apiscopeHono(app, { appName: 'edge-api' })
```

## Load testing and CI

```ts
import { defineConfig } from 'apiscope'

export default defineConfig({
  ci: {
    readiness: { url: 'http://127.0.0.1:3000/health' },
    baselinePath: '.apiscope/baseline.json',
    tolerances: { p95Pct: 10 },
    scenarios: [
      {
        scenario: {
          name: 'checkout',
          baseUrl: 'http://127.0.0.1:3000',
          targets: [{ method: 'POST', path: '/api/checkout', body: '{"items":[1]}' }],
          model: { kind: 'open', phases: [{ durationMs: 30000, rps: 100 }] },
          warmupMs: 2000
        },
        assertions: { p95MaxMs: 120, errorRateMax: 0.01 }
      }
    ]
  }
})
```

```bash
apiscope ci
apiscope ci --update-baseline
apiscope ci --json report.json --junit report.xml
```

## Design principles

- Open-model load generation measured from intended send time — no coordinated omission
- Out-of-process generation — the load engine never runs inside your app's own event loop
- Worker self-metrics reported with every run, so you can see when the load generator itself is the bottleneck
- Payload redaction on by default
- Collector bound to 127.0.0.1 — never exposed beyond localhost
- Zero telemetry
- `GET /metrics` is intentionally exempt from dashboard auth, matching standard Prometheus scrape conventions (Prometheus can't present a session cookie) — network-restrict it in production the same way you would any other unauthenticated scrape endpoint

## Packages

| Package | Description |
| --- | --- |
| `@apiscope/core` | Span model and wire protocol for apiscope |
| `@apiscope/collector` | Local collector daemon with SQLite store and live streaming |
| `@apiscope/store-clickhouse` | ClickHouse span store for apiscope |
| `@apiscope/adapter-node` | Shared Node.js adapter runtime with span context and undici capture |
| `@apiscope/express` | Express adapter for apiscope |
| `@apiscope/fastify` | Fastify adapter for apiscope |
| `@apiscope/nestjs` | NestJS adapter for apiscope |
| `@apiscope/next` | Next.js adapter for apiscope |
| `@apiscope/hono` | Hono adapter for apiscope (Node, Bun, Deno, Edge) |
| `@apiscope/load` | Coordinated-omission-safe load engine for apiscope |
| `@apiscope/advisor` | Pure-function advisor rules that turn captured traffic into paste-ready fixes |
| `apiscope` | The CLI (`npx apiscope`): dev collector + dashboard, load testing, CI budgets, scenario generation |
| `@apiscope/dashboard` | apiscope dashboard UI, including the mobile-first Insights hub |
| `@apiscope/mcp` | MCP server exposing apiscope's collector API as tools for coding agents |

## License

MIT
