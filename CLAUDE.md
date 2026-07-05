# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current State

apiscope is a greenfield, **plan-driven** project. The repository currently contains **no source code** — only a design spec and 20 sequential implementation plans under `.claude/superpowers/`. Work proceeds by executing those plans in order.

- **Spec (source of truth for architecture):** `.claude/superpowers/specs/2026-07-04-apiscope-design.md`
- **Implementation plans (20):** `.claude/superpowers/plans/2026-07-04-plan-N-*.md`
- **Strategic context:** `.claude/superpowers/COMPETITIVE-ANALYSIS.md` (Track A "own the wedge" vs Track B "platform parity")

> `.claude/` is currently gitignored, so these documents are local working files and won't appear in `git status`. Plan 1 replaces `.gitignore` when it scaffolds the monorepo.

**What apiscope is:** a free, MIT, dev-time API observability and load-testing tool for JavaScript frameworks (Next.js App+Pages, Express, Fastify, NestJS, Hono), with route introspection, a live latency waterfall, a coordinated-omission-safe load engine, and a headless CI mode with latency budgets — plus a self-hostable production observability backend built from the same codebase.

## Executing the Plans

Each plan is written to be run with the **`executing-plans` skill**, task-by-task. Steps use `- [ ]` checkboxes for tracking. Feature tasks follow strict TDD:

1. Write the failing test → 2. Run it, confirm it fails for the stated reason → 3. Write the implementation → 4. Run the test, confirm it passes → 5. Commit (the conventional-commit message is given in the plan).

Plans are **ordered and interdependent** — implement in numeric order:
- **Plans 1–10** — dev-mode product + release (core → collector → adapters → load engine → CLI/CI → dashboard → release engineering).
- **Plans 11–14** — production self-hosting track (pluggable storage/ClickHouse, auth, sampling/Valkey/metrics, deployment artifacts).
- **Plans 15–20** — Track A wedge features (OTLP interop, trace-context propagation, DB instrumentation + n+1, flamegraphs/dependency view, traffic-to-scenario, MCP server).

Load-bearing cross-plan dependencies: Plan 3 (`adapter-node`) precedes the framework adapters (4 Next, 5 Nest, 6 Hono); Plan 11 makes `SpanStore` **async** and ripples `await` through every prior consumer; Plan 16 depends on the W3C-compatible ids introduced in Plan 15; Plan 17 generalizes `ChildSpan` from fetch-only to a `fetch | db` union that ripples through the codec, both stores, and OTLP mapping.

Before implementing any framework adapter, verify the framework's current API via Context7 (`ctx7` CLI) — the spec mandates this, and several plans pin exact verified dependency versions with a "verified 2026-07-04" note.

## Commands

The pnpm workspace does not exist until Plan 1 runs. Once scaffolded:

```bash
pnpm install
pnpm build          # pnpm -r build     (tsup: esm + cjs + dts per package)
pnpm test           # pnpm -r test      (vitest run per package)
pnpm typecheck      # pnpm -r typecheck (tsc --noEmit)
```

Per-package and single-test:

```bash
pnpm --filter @apiscope/core test                            # one package
pnpm --filter @apiscope/core test test/validate.test.ts      # one test file
pnpm --filter @apiscope/core test -t "accepts a valid span"  # one test by name
pnpm --filter @apiscope/core build
```

## Architecture

**One codebase, two modes.** Dev mode is the zero-config local experience: one dev dependency plus one line of integration per framework, no account, SQLite, collector bound to `127.0.0.1`, data never leaving the machine. Production mode is a self-hostable, horizontally scalable backend: ClickHouse, authenticated ingest + dashboard, tail sampling, Valkey live fan-out, container/Helm/binary artifacts. **Dev mode is production mode with every seam set to its zero-config default.**

**The five seams** are the only things that differ between the two modes. Every consumer codes against these interfaces, never a concrete backend; they are resolved from config at startup:

| Seam | Dev default | Production |
|---|---|---|
| `SpanStore` | SQLite (row-count ring buffer) | ClickHouse (`MergeTree` + `TTL`) — both pass one shared conformance suite |
| `IngestAuthenticator` | none (loopback) | per-app token, or mTLS + token |
| `DashboardAuthenticator` | none (loopback) | sessions, OIDC/SSO, or trusted-proxy header |
| `LiveTransport` | in-process hub | Valkey pub/sub (multi-replica) |
| `Sampler` | keep-all | tail-based |

**Runtime topology:** adapter (in-process, passive) → span stream (WebSocket for Node runtimes, HTTP batch for Edge) → collector daemon → `SpanStore` → dashboard / CI report. The collector owns storage, the dashboard, the load engine, and the CI runner.

**Load generation always runs out-of-process over real HTTP** in collector worker threads, never inside the app's event loop, so latency percentiles aren't skewed. The open (fixed-RPS) model measures latency against the *intended* send time to avoid coordinated omission — a load-bearing correctness property with a dedicated regression test.

### Package layering (pnpm monorepo, `@apiscope/*` scope)

`@apiscope/core` is the **zero-runtime-dependency contract layer** every other package builds on: span model, versioned JSON wire-protocol codec (strict decode validation), header redaction / body capping, and the drop-oldest span buffer.

- `core` ← everything
- `adapter-node` (WebSocket transport with reconnect, AsyncLocalStorage span context, undici/`diagnostics_channel` child spans) ← `express`, `fastify`, `next`, `nestjs`
- `hono` depends on **`core` only** and must not import any `node:*` module (runs on Node/Bun/Deno/Edge; HTTP-batch transport, no child spans on Edge)
- `collector` (`node:http` + `ws`, SQLite store, live hub, load orchestration, CI runner) ← `cli`, `dashboard`
- `load` (`worker_threads`, undici pools, HDR histograms)
- `dashboard` (React + Vite, built and embedded into the collector as static assets)

### Cross-cutting invariants (hold across the whole codebase)

- **Adapters never throw into or block the host app.** Every hook body is wrapped; an unreachable collector degrades to a silent no-op. Spans buffer, then drop oldest while tracking `droppedCount`, which is surfaced explicitly in the dashboard.
- **Wire protocol is versioned (currently `1`).** Decode is strict; a version mismatch returns an explicit, actionable error (e.g. "adapter v2, collector v3 — update `@apiscope/next`"), never a crash. Codecs are property-tested with fast-check.
- **HTTP methods are free-form tokens end to end** (capture, route registry, load generation, OTLP mapping). No method allowlist anywhere; this includes the QUERY method (body-carrying, driven at GET-like concurrency).
- **Tail sampling never drops errors or slow outliers** — the base probability applies only to the remainder. Drop and sample counts are always metered and surfaced so retained-vs-total stays visible.
- **Redaction is on by default** (`authorization`, `cookie`, `set-cookie`); body cap 64 KB per direction; payload capture defaults to `headers`. Load targets are restricted to localhost unless explicitly allowlisted in config.
- The scenario builder never owns state: it **exports copy-pasteable `apiscope.config.ts`**, keeping the typed config file the single, diffable source of truth for both dev and CI.
- CI exit-code contract: **0 pass, 1 assertion/diff/drift failure, 2 runtime error.** Config validation errors report the exact path (e.g. `ci.scenarios[0].assertions.p95MaxMs`).

## Conventions (every plan restates these)

- **Node >= 24.** TypeScript `strict` plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. ESM sources, dual ESM+CJS output via tsup.
- **No code comments** — use readable variable names instead.
- **Conventional commit messages** (the exact message is given at the end of each plan task).
- MIT license; packages publish under `@apiscope` with `publishConfig.access: public`. Changesets drives versioning. The Next.js fixture stays private and is never published.
- Vitest everywhere; fast-check for protocol/codec property tests; Playwright for dashboard smoke + dual-theme visual snapshots; testcontainers for ClickHouse and DB-driver integration.

## Dashboard Design Language

Instrument aesthetic — dark-first, high density, restrained motion (dials: variance 4, motion 2, density 7). IBM Plex Sans (UI) + IBM Plex Mono (all numerals, with `font-variant-numeric: tabular-nums`). Base `#0A0A0B`; **accent international orange `#FF5C00` is for interaction only and never encodes data**; status scale 2xx `#8BA88E`, 3xx `#7C8B9E`, 4xx `#D9A621`, 5xx `#D64545`. Signature element: a persistent full-width live latency strip (canvas scatter/heatmap) atop every view; clicking a point opens the span. `prefers-reduced-motion` disables all transitions. Empty, data-loss (`droppedCount`), and disconnected-adapter states are explicit designs. UI work uses the `frontend-design` and design-taste skills.
