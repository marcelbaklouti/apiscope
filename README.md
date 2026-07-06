# apiscope

Free, local-first API observability and load testing for JavaScript frameworks — a route explorer, a live request inspector with latency waterfalls, a coordinated-omission-safe load engine, and CI latency budgets. No account, no cloud, your request data never leaves your machine.

[![npm](https://img.shields.io/npm/v/apiscope.svg)](https://www.npmjs.com/package/apiscope)
[![license](https://img.shields.io/npm/l/apiscope.svg)](LICENSE)

## What you get

- **Route explorer** — every route your app serves, discovered automatically.
- **Live request inspector** — a full-width latency waterfall that updates as traffic flows; click any request to see its headers, payloads, and timing.
- **Insights** — plain-language, paste-ready fixes: missing gzip/brotli, slow endpoints, N+1 database queries, and more.
- **Load testing** — out-of-process HTTP load with correct tail latencies (no coordinated omission).
- **CI budgets** — fail the build when p95 regresses, from a config file you commit.

## How it works

apiscope runs as a **local dashboard**. A small **adapter** you add to your app streams request data to it. Two pieces:

```
   your app                          apiscope
┌──────────────┐   spans over    ┌──────────────────┐
│  Next.js /   │ ──────────────▶ │  collector +     │
│  Express /   │   localhost     │  dashboard       │
│  Fastify …   │                 │  127.0.0.1:4620  │
│  + adapter   │                 └──────────────────┘
└──────────────┘
```

The dashboard on its own shows nothing — the adapter is what feeds it. Both run only on `127.0.0.1`.

## Get started

### 1. Start apiscope

```bash
npx apiscope dev
```

Starts the collector and dashboard on **http://127.0.0.1:4620** and opens it in your browser. Run it from your project root — it detects your framework and prints the exact adapter to add next. Leave it running (`Ctrl+C` to stop).

### 2. Add the adapter to your app

The adapter is a dev dependency plus a few lines of setup. Pick your framework:

<details open>
<summary><b>Next.js</b> (App or Pages Router)</summary>

```bash
npm i -D @apiscope/next
```

```ts
// instrumentation.ts
import { withApiscope } from '@apiscope/next'

const apiscope = withApiscope({ appName: 'web' })
export const register = apiscope.register
export const onRequestError = apiscope.onRequestError
```
</details>

<details>
<summary><b>Express</b></summary>

```bash
npm i -D @apiscope/express
```

```ts
import { apiscopeExpress } from '@apiscope/express'

app.use(apiscopeExpress({ appName: 'api' }))
```
</details>

<details>
<summary><b>Fastify</b></summary>

```bash
npm i -D @apiscope/fastify
```

```ts
import { apiscopeFastify } from '@apiscope/fastify'

await app.register(apiscopeFastify, { appName: 'api' })
```
</details>

<details>
<summary><b>NestJS</b></summary>

```bash
npm i -D @apiscope/nestjs
```

```ts
import { ApiscopeModule } from '@apiscope/nestjs'

@Module({ imports: [ApiscopeModule.forRoot({ appName: 'api' })] })
export class AppModule {}
```
</details>

<details>
<summary><b>Hono</b> (Node, Bun, Deno, Edge)</summary>

```bash
npm i -D @apiscope/hono
```

```ts
import { apiscopeHono } from '@apiscope/hono'

apiscopeHono(app, { appName: 'edge-api' })
```
</details>

### 3. Run your app and make some requests

Start your app as usual and hit a few routes. They appear in the dashboard live — routes, latency waterfalls, payloads, and Insights.

## Load testing and CI

apiscope also runs HTTP load tests and enforces latency budgets, both driven by one typed config file you commit. Load always runs out-of-process over real HTTP, so your app's event loop never skews the percentiles.

```ts
// apiscope.config.ts
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
apiscope ci                                   # run scenarios, check budgets and drift
apiscope ci --update-baseline                 # save a new baseline
apiscope ci --json report.json --junit report.xml
```

Exit codes: `0` pass, `1` a budget/diff/drift failure, `2` a runtime error.

## What makes it different

- **Local-first.** Runs entirely on `127.0.0.1`, no account, zero telemetry — your payloads, headers, and routes never leave your machine.
- **Honest latency numbers.** Open-model load is measured from the *intended* send time and generated out-of-process, so you never get coordinated omission or event-loop skew.
- **Config is the source of truth.** One typed, diffable `apiscope.config.ts` drives both dev and CI — no dashboard state to reproduce, what you commit is what runs.
- **Safe by default.** `authorization`/`cookie` headers are redacted and bodies are capped before anything is stored.
- **Actionable, not just charts.** The advisor turns captured traffic into paste-ready fixes.

## Self-hosting

The same codebase runs as a self-hostable **production** backend — ClickHouse storage, authenticated ingest and dashboard, tail sampling, and Valkey live fan-out. Dev mode is that backend with every seam at its zero-config default, so nothing about your local setup has to change to scale it up.

## Packages

You only install the CLI and one adapter. The rest are internal building blocks, listed for reference.

| Package | What it is |
| --- | --- |
| `apiscope` | The CLI (`npx apiscope`): dev collector + dashboard, load testing, CI budgets, scenario generation |
| `@apiscope/next` | Next.js adapter |
| `@apiscope/express` | Express adapter |
| `@apiscope/fastify` | Fastify adapter |
| `@apiscope/nestjs` | NestJS adapter |
| `@apiscope/hono` | Hono adapter (Node, Bun, Deno, Edge) |
| `@apiscope/core` | Span model and versioned wire protocol |
| `@apiscope/collector` | Local collector daemon: SQLite store, live streaming, load orchestration, CI runner |
| `@apiscope/load` | Coordinated-omission-safe load engine |
| `@apiscope/advisor` | Pure-function rules that turn captured traffic into paste-ready fixes |
| `@apiscope/adapter-node` | Shared Node.js adapter runtime (span context, undici capture) |
| `@apiscope/store-clickhouse` | ClickHouse span store for self-hosted production mode |
| `@apiscope/dashboard` | The dashboard UI, including the mobile-first Insights hub |
| `@apiscope/mcp` | MCP server exposing the collector API as tools for coding agents |

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
