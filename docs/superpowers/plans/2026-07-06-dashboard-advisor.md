# apiscope Dashboard Advisor & UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an active advisor to apiscope — a new `@apiscope/advisor` package of pure-function rules that analyzes already-captured spans, child spans, route stats, and app metadata to emit framework-aware, paste-ready findings; expose them at collector `GET /api/insights`; surface them in a new dashboard **Insights hub** landing view; and make the whole dashboard mobile-first responsive and more visually alive while keeping the instrument aesthetic.

**Architecture:** `@apiscope/advisor` holds the intelligence as pure functions over an `AdvisorContext`, depending only on `@apiscope/core` types (zero other runtime deps). The collector assembles the context from its async `SpanStore`, runs `analyze()`, and serves the result at `GET /api/insights`, gated by sample sizes and reusing the typed-config machinery for an `advisor` block. The dashboard's new Insights view consumes `/api/insights` over the existing live/HTTP layer and re-renders as traffic accumulates. Package layering: `core` ← `advisor` ← `collector` → `dashboard`; `advisor` imports only `core` types.

**Tech Stack:** TypeScript (strict), Node >= 24, ESM + dual CJS output via tsup, Vitest (advisor unit tests + collector integration tests), React 19 + Vite + zustand (dashboard), Playwright (dashboard e2e + visual snapshots). No new runtime dependencies: `@apiscope/advisor` depends only on `@apiscope/core` (`workspace:*`).

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the spec, `CLAUDE.md`, and the standing deviations (`/Users/marcelbaklouti/Projekte/apiscope/.superpowers/sdd/deviations.md`).

- **TypeScript pinned `^5.9.3`** in every new/edited `package.json` — never `6.x` (deviation **D1**: tsup 8.5.1's DTS pipeline injects `baseUrl`, which TS 6.x turns into a hard `TS5101` error; 5.9.3 treats it as a soft warning).
- **Node >= 24.** `tsconfig` extends `../../tsconfig.base.json` (which sets `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `types: []`). Any package whose `src/`/`test/` reaches a Node global adds `@types/node ^26.1.0` as a devDependency plus `"compilerOptions": { "types": ["node"] }` in its own `tsconfig.json` (deviation **D2**).
- **`onlyBuiltDependencies`** lives in `pnpm-workspace.yaml`, never in a root `package.json` `"pnpm"` field (deviation **D4**). No new native deps are introduced here, so no change to that list is needed.
- **`tsup shims: true`** is required in any package whose `tsup.config.ts` builds `format: ['esm', 'cjs']` and whose `src/` uses `import.meta` (deviation **D14**). The advisor package uses no `import.meta`, so its tsup config needs no `shims`. The collector already has `shims: true` and is unchanged on this point.
- **Playwright baseline regeneration** uses the explicit `--update-snapshots=all` mode, never the bare `--update-snapshots` flag (deviation **D41**: the bare flag's default `changed` preset silently no-ops for small diffs under `maxDiffPixelRatio: 0.02`). After regenerating, confirm via `git status` that the PNG bytes actually changed, or watch for Playwright's `is re-generated, writing actual` line.
- Committed Playwright visual baselines in this repo are macOS-only (`-darwin.png`) (deviation **D20**); generate/commit the `-darwin.png` variants on this machine.
- **No code comments** anywhere — use readable variable names instead (`CLAUDE.md`).
- **Conventional commit messages**, each ending with the trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` (the exact message is given per task).
- **MIT license**; new package publishes under `@apiscope` with `"publishConfig": { "access": "public" }` and the standard publish metadata (repository/homepage/bugs/keywords) matching every other package.
- **`@apiscope/advisor` depends only on `@apiscope/core` types** — zero runtime dependencies otherwise. `analyze()` is a pure function: **no I/O, no side effects**; every rule is a pure function.
- **Noise control:** a rule never fires below its `minimumSampleSize`; the engine isolates a throwing rule (skips it, never breaks the response) and returns `{ findings, rulesRun, insufficientData }`. Rule thresholds have sensible defaults, overridable in `apiscope.config.ts` under an `advisor` block.
- **Framework fixes never emit a wrong snippet:** an unknown/unavailable framework falls back to generic guidance plus a docs link. Framework is taken from app handshake metadata (`AppMetadata.framework`, a free-form string; supported literals `'express' | 'fastify' | 'next' | 'nestjs' | 'hono'`).
- **Design tokens (extend, never replace):** base `#0A0A0B`; accent international orange `#FF5C00` for interaction only, never data; status scale 2xx `#8BA88E` / 3xx `#7C8B9E` / 4xx `#D9A621` / 5xx `#D64545` (repo's dark `--status-5xx` is `#dc5252`); IBM Plex Sans (UI) + IBM Plex Mono (numerals) with `font-variant-numeric: tabular-nums`. Add a **distinct advisory severity scale** (critical/warning/advisory) separate from the 2xx–5xx data colors, warmer surface/elevation tokens, and a motion scale that fully collapses under `prefers-reduced-motion`.
- **Mobile-first responsive:** single-column card stream at <=640px; nav collapses (bottom tab bar / drawer); expert tables become stacked label→value cards or contained scroll and must never break the page layout; real touch targets; fluid type/spacing.
- **Purposeful motion only** (Emil's rule — motion reflects data, never decoration), all gated on `prefers-reduced-motion`.
- **UI craft (Phases 3–4) is driven by the design skills** `anthropic-skills:frontend-design`, `design-taste-frontend`, and `emil-design-eng`. For UI tasks this plan specifies the deterministic contracts (data shapes, API client calls, store slices, hash routes, component prop contracts, the exact states to handle, and the Playwright test that gates the deliverable) and directs the implementer to those skills for the visual/motion/responsive craft — it deliberately does **not** pre-bake exact JSX/CSS for the look.

---

## Architecture Notes (read before Phase 1)

**Why the advisor defines its own input types.** `@apiscope/core` has **no** `RouteStats` type and no per-route percentile shape (confirmed: `packages/core/src/types.ts` exposes `RequestSpan`, `ChildSpan` (`FetchChildSpan | DbChildSpan`), `AppMetadata`, `RouteRegistryEntry`, constants — nothing aggregate). The collector computes route stats in its own `SpanStore` (`packages/collector/src/store-interface.ts` `RouteStats = { routePattern, method, count, errorCount, p50, p95, p99 }`, where `errorCount` counts `statusCode >= 500`). Since `@apiscope/advisor` may depend only on `@apiscope/core`, it **defines its own `AdvisorRouteStats` and `AdvisorApp` input shapes** (structurally identical to what the collector already produces) and the collector maps its store output into an `AdvisorContext`. This keeps the advisor pure and core-only, and keeps the collector the single place that knows how to read the store.

**N+1 is re-derived in the advisor.** The collector already has `detectNPlusOne(childSpans)` and surfaces per-route counts, but that lives in the collector, not core. The advisor re-derives N+1 from `DbChildSpan` grouping (identical normalized `statement` + `target` repeated within one parent span) as a pure function, so the rule is self-contained and testable. The collector's own `nPlusOne` detection is unchanged.

**Statement normalization.** DB findings group by a normalized statement template: lowercase, collapse whitespace, and replace numeric/string literals and parameter placeholders with `?`. This is defined once in the advisor and reused by the N+1 and slow-query rules.

**Response byte size.** `RequestSpan.response` is a `CapturedPayload` with `headers: Record<string,string>`, optional `body?: string`, `truncated: boolean`. Compression/oversize rules read `response.headers['content-encoding']` and estimate uncompressed bytes from `response.headers['content-length']` when present, else `Buffer.byteLength(response.body ?? '')`. When `truncated` is true, byte size is treated as "at least the cap" and the rule uses `content-length` if available or is skipped for that span if neither is reliable.

## File Structure

**New package `@apiscope/advisor`** (`packages/advisor/`):

- `package.json` — name `@apiscope/advisor`, TS `^5.9.3`, dep `@apiscope/core: workspace:*`, standard publish metadata.
- `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts` — mirror `packages/core/*`.
- `src/index.ts` — public surface: `analyze`, `AdvisorContext`, `Finding` and sub-types, `AdvisorRouteStats`, `AdvisorApp`, `AdvisorConfig`, `defaultAdvisorConfig`, the rule registry, and `resolveFix`.
- `src/types.ts` — `Finding`, `FindingCategory`, `FindingSeverity`, `FindingScope`, `FindingEvidence`, `FindingFix`, `FindingImpact`, `AdvisorContext`, `AdvisorRouteStats`, `AdvisorApp`, `AnalyzeResult`.
- `src/config.ts` — `AdvisorConfig`, `AdvisorThresholds`, `defaultAdvisorConfig`, `resolveAdvisorConfig`.
- `src/engine.ts` — `Rule` interface, `runRules`, ranking (`severity × traffic-share × fixability`).
- `src/util/statement.ts` — `normalizeStatement`, `responseBytes`, `isTextyContentType`, `humanizeBytes`, `humanizeMs`, `formatPercent`.
- `src/fixes/index.ts` — `resolveFix(ruleId, framework, params)`; `src/fixes/templates.ts` — per-framework templates.
- `src/rules/` — one file per rule: `uncompressed.ts`, `missing-cache.ts`, `oversized-payload.ts`, `slow-route.ts`, `where-time-goes.ts`, `unstable-latency.ts`, `n-plus-one.ts`, `sequential-outbound.ts`, `slow-dependency.ts`, `error-hotspot.ts`, plus `src/rules/index.ts` (the registry array).
- `test/` — one test file per rule + `engine.test.ts`, `fixes.test.ts`, `config.test.ts`, `analyze.test.ts`, `fixtures.ts` (shared span/child-span builders).

**Collector changes** (`packages/collector/`):

- `src/insights.ts` (new) — `buildAdvisorContext(store, config)` mapping the store into an `AdvisorContext`; `resolveAdvisorConfigFromMeta(meta)`.
- `src/index.ts` (modify) — register `GET /api/insights`; thread `options.advisor`.
- `src/server.ts` (modify) — add `advisor?: AdvisorConfigInput` to `CollectorOptions`.
- `test/insights-api.test.ts` (new) — integration tests over a seeded store.
- `package.json` (modify) — add `@apiscope/advisor: workspace:*` dependency.

**CLI config changes** (`packages/cli/`):

- `src/config.ts` (modify) — add the `advisor` block to `configSchema` and `ApiscopeConfig`.
- `src/cli.ts` (modify) — pass the resolved advisor block to `createCollector`.
- `test/config.test.ts` (modify) — validate the advisor block.

**Dashboard changes** (`packages/dashboard/`):

- `src/lib/types.ts` (modify) — `Finding` and sub-types + `InsightsResponse` (mirroring the advisor's public JSON shape).
- `src/lib/api.ts` (modify) — `insights()` client call.
- `src/lib/store.ts` (modify) — insights slice (findings, meta, loading, error, dismissed set, grouping).
- `src/lib/live.ts` (modify) — handle an `insights` live event (re-fetch trigger).
- `src/views/Insights.tsx` (new) — the hub view.
- `src/components/FindingCard.tsx` (new) — collapsible finding card with copy-fix + deep-link.
- `src/components/HealthVerdict.tsx` (new) — the verdict hero.
- `src/App.tsx` (modify) — add `#/insights` route, make it the default landing, add nav link + mobile nav.
- `src/components/CommandPalette.tsx` (modify) — add `go to insights`.
- `src/styles/tokens.css` (modify) — advisory severity scale, warmer surfaces, motion scale.
- `src/styles/base.css` (modify) — responsive rules, mobile nav, table→card, finding-card styles.
- `e2e/serve.mjs` (modify) — seed advisor-triggering data (uncompressed responses, a slow route, an error).
- `e2e/dashboard.spec.ts` (modify) — insights hub tests (render/expand/copy/deep-link/empty/insufficient/responsive/reduced-motion).

---

## Phase 1 — `@apiscope/advisor` package

Deterministic backend. **Write COMPLETE code** — full rule logic, full `Finding` types, full framework-fix templates, real fixture spans. No placeholders.

### Task 1: Package scaffold + Finding model types

**Files:**
- Create: `packages/advisor/package.json`
- Create: `packages/advisor/tsconfig.json`
- Create: `packages/advisor/tsup.config.ts`
- Create: `packages/advisor/vitest.config.ts`
- Create: `packages/advisor/src/types.ts`
- Create: `packages/advisor/src/index.ts`
- Test: `packages/advisor/test/types.test.ts`

**Interfaces:**
- Consumes (from `@apiscope/core`): `RequestSpan`, `ChildSpan`, `FetchChildSpan`, `DbChildSpan`, `AppMetadata`, `RouteRegistryEntry`, `CapturedPayload`.
- Produces (used by every later task):

```ts
export type FindingCategory =
  | 'performance' | 'payload' | 'caching' | 'database' | 'dependencies' | 'reliability' | 'code'
export type FindingSeverity = 'critical' | 'warning' | 'advisory'

export interface FindingImpact { metric: string; humanized: string }
export interface FindingScope { level: 'global' | 'route' | 'app'; routePattern?: string; appName?: string }
export interface FindingEvidence { spanIds: string[]; deepLink: string }
export interface FindingFix { framework: string; explanation: string; codeSnippet?: string; docsUrl?: string }

export interface Finding {
  ruleId: string
  category: FindingCategory
  severity: FindingSeverity
  title: string
  whatAndWhy: string
  impact: FindingImpact
  scope: FindingScope
  evidence: FindingEvidence
  fix: FindingFix
  sampleSize: number
}

export interface AdvisorRouteStats {
  routePattern: string | null
  method: string
  count: number
  errorCount: number
  p50: number
  p95: number
  p99: number
}

export interface AdvisorApp { name: string; framework: string }

export interface AdvisorContext {
  spans: RequestSpan[]
  childSpans: ChildSpan[]
  routeStats: AdvisorRouteStats[]
  apps: AdvisorApp[]
  config: ResolvedAdvisorConfig
}

export interface AnalyzeResult {
  findings: Finding[]
  rulesRun: string[]
  insufficientData: boolean
}
```

`ResolvedAdvisorConfig` is produced by Task 2; in this task import its type from `./config` (Task 2 creates it — to keep Task 1 self-contained and buildable on its own, define a minimal placeholder **in `src/config.ts` as part of this task's scaffold** whose field *names* already match the final Task 2 shape, only narrower:

```ts
export type AdvisorThresholds = Record<string, number>
export interface ResolvedAdvisorConfig {
  enabled: boolean
  minimumOverallSampleSize: number
  thresholds: AdvisorThresholds
  rules: Record<string, { minimumSampleSize: number; enabled: boolean }>
}
```

Task 2 replaces `src/config.ts` wholesale with the full `AdvisorThresholds` and adds the config-input/default helpers, but keeps these exact field names so `src/types.ts` never references a field that later disappears). `src/index.ts` re-exports `export * from './types'` and `export * from './config'`.

- [ ] **Step 1: Write the failing test**

`packages/advisor/test/types.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Finding } from '../src/index'

describe('Finding model', () => {
  it('constructs a well-formed finding', () => {
    const finding: Finding = {
      ruleId: 'uncompressed-responses',
      category: 'payload',
      severity: 'warning',
      title: '3 routes send uncompressed responses',
      whatAndWhy: 'Text responses over ~1.4 KB are sent without gzip or brotli, so clients download more bytes than needed.',
      impact: { metric: 'avgBytes=143210', humanized: '~140 KB to ~28 KB, affects 45% of traffic' },
      scope: { level: 'global' },
      evidence: { spanIds: ['a', 'b'], deepLink: '#/routes' },
      fix: { framework: 'express', explanation: 'Enable the compression middleware.', codeSnippet: "app.use(compression())" },
      sampleSize: 20
    }
    expect(finding.category).toBe('payload')
    expect(finding.fix.framework).toBe('express')
    expect(finding.evidence.spanIds).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @apiscope/advisor test`
Expected: FAIL — package/modules missing (`@apiscope/advisor` not resolvable).

- [ ] **Step 3: Write minimal implementation**

Create `packages/advisor/package.json`:

```json
{
  "name": "@apiscope/advisor",
  "version": "0.0.0",
  "license": "MIT",
  "description": "Pure-function API advisor rules for apiscope",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/marcelbaklouti/apiscope.git",
    "directory": "packages/advisor"
  },
  "homepage": "https://github.com/marcelbaklouti/apiscope#readme",
  "bugs": "https://github.com/marcelbaklouti/apiscope/issues",
  "keywords": ["apiscope", "api", "monitoring", "load-testing", "devtools"],
  "publishConfig": { "access": "public" },
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@apiscope/core": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^26.1.0",
    "tsup": "^8.5.1",
    "typescript": "^5.9.3",
    "vitest": "^4.1.9"
  }
}
```

Create `packages/advisor/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "test", "tsup.config.ts", "vitest.config.ts"]
}
```

Create `packages/advisor/tsup.config.ts`:

```ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true
})
```

Create `packages/advisor/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['test/**/*.test.ts'] }
})
```

Create `packages/advisor/src/types.ts` with the full block from **Produces** above (all of `FindingCategory` through `AnalyzeResult`, importing `RequestSpan`, `ChildSpan`, `AppMetadata`, `RouteRegistryEntry` from `@apiscope/core`, and `ResolvedAdvisorConfig`/`AdvisorThresholds` from `./config`).

Create `packages/advisor/src/config.ts` with the minimal placeholder described in **Interfaces** (`AdvisorThresholds = Record<string, number>` and `ResolvedAdvisorConfig` with `enabled`, `minimumOverallSampleSize`, `thresholds`, `rules` — the same field names Task 2 keeps).

Create `packages/advisor/src/index.ts`:

```ts
export * from './types'
export * from './config'
```

Then `pnpm install` so the workspace graph resolves the new package.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @apiscope/advisor test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/advisor pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "$(cat <<'EOF'
feat(advisor): scaffold package and Finding model types

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Advisor config, thresholds, and resolution

**Files:**
- Modify (replace wholesale): `packages/advisor/src/config.ts`
- Modify: `packages/advisor/src/index.ts` (already re-exports `./config`; no change needed if it does)
- Test: `packages/advisor/test/config.test.ts`

**Interfaces:**
- Produces:

```ts
export interface AdvisorThresholds {
  compressibleMinBytes: number
  oversizedPayloadBytes: number
  slowRouteP95Ms: number
  criticalRouteP95Ms: number
  unstableLatencyRatio: number
  errorRateWarning: number
  errorRateCritical: number
  slowDependencyShare: number
  sequentialOutboundMinMs: number
}

export interface AdvisorRuleConfig { minimumSampleSize?: number; enabled?: boolean }

export interface AdvisorConfigInput {
  enabled?: boolean
  minimumOverallSampleSize?: number
  thresholds?: Partial<AdvisorThresholds>
  rules?: Record<string, AdvisorRuleConfig>
}

export interface ResolvedAdvisorConfig {
  enabled: boolean
  minimumOverallSampleSize: number
  thresholds: AdvisorThresholds
  rules: Record<string, { minimumSampleSize: number; enabled: boolean }>
}

export const DEFAULT_ADVISOR_THRESHOLDS: AdvisorThresholds
export const DEFAULT_RULE_MINIMUM_SAMPLE_SIZE: Record<string, number>
export function defaultAdvisorConfig(): ResolvedAdvisorConfig
export function resolveAdvisorConfig(input?: AdvisorConfigInput): ResolvedAdvisorConfig
```

- [ ] **Step 1: Write the failing test**

`packages/advisor/test/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_ADVISOR_THRESHOLDS, defaultAdvisorConfig, resolveAdvisorConfig } from '../src/config'

describe('advisor config resolution', () => {
  it('provides sensible defaults', () => {
    const config = defaultAdvisorConfig()
    expect(config.enabled).toBe(true)
    expect(config.thresholds.slowRouteP95Ms).toBe(500)
    expect(config.thresholds.compressibleMinBytes).toBe(1400)
    expect(config.minimumOverallSampleSize).toBe(20)
    expect(config.rules['uncompressed-responses']?.minimumSampleSize).toBeGreaterThan(0)
  })

  it('deep-merges thresholds and rule overrides', () => {
    const config = resolveAdvisorConfig({
      thresholds: { slowRouteP95Ms: 300 },
      rules: { 'slow-route': { minimumSampleSize: 50, enabled: false } }
    })
    expect(config.thresholds.slowRouteP95Ms).toBe(300)
    expect(config.thresholds.criticalRouteP95Ms).toBe(DEFAULT_ADVISOR_THRESHOLDS.criticalRouteP95Ms)
    expect(config.rules['slow-route']?.minimumSampleSize).toBe(50)
    expect(config.rules['slow-route']?.enabled).toBe(false)
  })

  it('treats enabled:false as globally disabled', () => {
    expect(resolveAdvisorConfig({ enabled: false }).enabled).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @apiscope/advisor test test/config.test.ts`
Expected: FAIL — `DEFAULT_ADVISOR_THRESHOLDS`/`defaultAdvisorConfig` not exported.

- [ ] **Step 3: Write minimal implementation**

Replace `packages/advisor/src/config.ts`:

```ts
export interface AdvisorThresholds {
  compressibleMinBytes: number
  oversizedPayloadBytes: number
  slowRouteP95Ms: number
  criticalRouteP95Ms: number
  unstableLatencyRatio: number
  errorRateWarning: number
  errorRateCritical: number
  slowDependencyShare: number
  sequentialOutboundMinMs: number
}

export interface AdvisorRuleConfig {
  minimumSampleSize?: number
  enabled?: boolean
}

export interface AdvisorConfigInput {
  enabled?: boolean
  minimumOverallSampleSize?: number
  thresholds?: Partial<AdvisorThresholds>
  rules?: Record<string, AdvisorRuleConfig>
}

export interface ResolvedAdvisorConfig {
  enabled: boolean
  minimumOverallSampleSize: number
  thresholds: AdvisorThresholds
  rules: Record<string, { minimumSampleSize: number; enabled: boolean }>
}

export const DEFAULT_ADVISOR_THRESHOLDS: AdvisorThresholds = {
  compressibleMinBytes: 1400,
  oversizedPayloadBytes: 100 * 1024,
  slowRouteP95Ms: 500,
  criticalRouteP95Ms: 1000,
  unstableLatencyRatio: 5,
  errorRateWarning: 0.02,
  errorRateCritical: 0.1,
  slowDependencyShare: 0.6,
  sequentialOutboundMinMs: 20
}

export const DEFAULT_RULE_MINIMUM_SAMPLE_SIZE: Record<string, number> = {
  'uncompressed-responses': 5,
  'missing-cache-headers': 5,
  'oversized-payload': 5,
  'slow-route': 20,
  'where-time-goes': 10,
  'unstable-latency': 30,
  'n-plus-one': 3,
  'sequential-outbound': 3,
  'slow-dependency': 10,
  'error-hotspot': 20
}

const ALL_RULE_IDS = Object.keys(DEFAULT_RULE_MINIMUM_SAMPLE_SIZE)

function resolveRules(input: Record<string, AdvisorRuleConfig> | undefined): ResolvedAdvisorConfig['rules'] {
  const resolved: ResolvedAdvisorConfig['rules'] = {}
  for (const ruleId of ALL_RULE_IDS) {
    const override = input?.[ruleId]
    resolved[ruleId] = {
      minimumSampleSize: override?.minimumSampleSize ?? DEFAULT_RULE_MINIMUM_SAMPLE_SIZE[ruleId] ?? 10,
      enabled: override?.enabled ?? true
    }
  }
  return resolved
}

export function resolveAdvisorConfig(input?: AdvisorConfigInput): ResolvedAdvisorConfig {
  return {
    enabled: input?.enabled ?? true,
    minimumOverallSampleSize: input?.minimumOverallSampleSize ?? 20,
    thresholds: { ...DEFAULT_ADVISOR_THRESHOLDS, ...(input?.thresholds ?? {}) },
    rules: resolveRules(input?.rules)
  }
}

export function defaultAdvisorConfig(): ResolvedAdvisorConfig {
  return resolveAdvisorConfig()
}
```

Update `packages/advisor/src/types.ts` to import `ResolvedAdvisorConfig` and `AdvisorThresholds` from `./config` (they now have their full shapes).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @apiscope/advisor test test/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/advisor/src/config.ts packages/advisor/src/types.ts packages/advisor/test/config.test.ts
git commit -m "$(cat <<'EOF'
feat(advisor): threshold defaults and config resolution

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Shared utilities (statement normalization, byte/format helpers)

**Files:**
- Create: `packages/advisor/src/util/statement.ts`
- Modify: `packages/advisor/src/index.ts` (add `export * from './util/statement'`)
- Test: `packages/advisor/test/util.test.ts`

**Interfaces:**
- Produces:

```ts
export function normalizeStatement(statement: string): string
export function responseBytes(response: CapturedPayload | undefined): number | null
export function isTextyContentType(contentType: string | undefined): boolean
export function humanizeBytes(bytes: number): string
export function humanizeMs(ms: number): string
export function formatPercent(fraction: number): string
export function headerValue(headers: Record<string, string>, name: string): string | undefined
```

`headerValue` does a case-insensitive lookup (headers may be stored with any casing). `responseBytes` returns `content-length` when a valid positive integer, else `Buffer.byteLength(body)` when a body is present, else `null` (unknown). `isTextyContentType` returns true for content types containing `json`, `html`, `text`, `javascript`, `css`, or `xml`.

- [ ] **Step 1: Write the failing test**

`packages/advisor/test/util.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  formatPercent,
  headerValue,
  humanizeBytes,
  humanizeMs,
  isTextyContentType,
  normalizeStatement,
  responseBytes
} from '../src/util/statement'

describe('normalizeStatement', () => {
  it('collapses literals and whitespace so parameterized queries group', () => {
    const a = normalizeStatement('SELECT * FROM comments WHERE post_id = 12')
    const b = normalizeStatement('select  *  from comments where post_id = 999')
    expect(a).toBe(b)
    expect(a).toBe('select * from comments where post_id = ?')
  })

  it('replaces quoted strings and bind placeholders', () => {
    expect(normalizeStatement("SELECT id FROM u WHERE name = 'ada' AND org = $1")).toBe(
      'select id from u where name = ? and org = ?'
    )
  })
})

describe('responseBytes', () => {
  it('prefers content-length', () => {
    expect(responseBytes({ headers: { 'content-length': '2048' }, truncated: false, redactedHeaders: [] })).toBe(2048)
  })
  it('falls back to body byte length', () => {
    expect(responseBytes({ headers: {}, body: 'hello', truncated: false, redactedHeaders: [] })).toBe(5)
  })
  it('returns null when neither is available', () => {
    expect(responseBytes({ headers: {}, truncated: false, redactedHeaders: [] })).toBeNull()
    expect(responseBytes(undefined)).toBeNull()
  })
})

describe('formatting helpers', () => {
  it('headerValue is case-insensitive', () => {
    expect(headerValue({ 'Content-Encoding': 'gzip' }, 'content-encoding')).toBe('gzip')
  })
  it('isTextyContentType matches common text types', () => {
    expect(isTextyContentType('application/json; charset=utf-8')).toBe(true)
    expect(isTextyContentType('image/png')).toBe(false)
    expect(isTextyContentType(undefined)).toBe(false)
  })
  it('humanizes bytes, ms and percent', () => {
    expect(humanizeBytes(143210)).toBe('140 KB')
    expect(humanizeBytes(512)).toBe('512 B')
    expect(humanizeMs(574)).toBe('574 ms')
    expect(humanizeMs(1500)).toBe('1.5 s')
    expect(formatPercent(0.45)).toBe('45%')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @apiscope/advisor test test/util.test.ts`
Expected: FAIL — module `../src/util/statement` missing.

- [ ] **Step 3: Write minimal implementation**

Create `packages/advisor/src/util/statement.ts`:

```ts
import type { CapturedPayload } from '@apiscope/core'

export function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const target = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return headers[key]
  }
  return undefined
}

export function normalizeStatement(statement: string): string {
  return statement
    .replace(/'[^']*'/g, '?')
    .replace(/"[^"]*"/g, '?')
    .replace(/\$\d+/g, '?')
    .replace(/\b\d+\b/g, '?')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function responseBytes(response: CapturedPayload | undefined): number | null {
  if (response === undefined) return null
  const declared = headerValue(response.headers, 'content-length')
  if (declared !== undefined) {
    const parsed = Number(declared)
    if (Number.isInteger(parsed) && parsed >= 0) return parsed
  }
  if (response.body !== undefined) return Buffer.byteLength(response.body)
  return null
}

export function isTextyContentType(contentType: string | undefined): boolean {
  if (contentType === undefined) return false
  const lower = contentType.toLowerCase()
  return ['json', 'html', 'text', 'javascript', 'css', 'xml'].some((token) => lower.includes(token))
}

export function humanizeBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kilobytes = bytes / 1024
  if (kilobytes < 1024) return `${Math.round(kilobytes)} KB`
  return `${(kilobytes / 1024).toFixed(1)} MB`
}

export function humanizeMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}
```

Add to `packages/advisor/src/index.ts`: `export * from './util/statement'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @apiscope/advisor test test/util.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/advisor/src/util packages/advisor/src/index.ts packages/advisor/test/util.test.ts
git commit -m "$(cat <<'EOF'
feat(advisor): statement normalization and humanize helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Framework-aware fix system

**Files:**
- Create: `packages/advisor/src/fixes/templates.ts`
- Create: `packages/advisor/src/fixes/index.ts`
- Modify: `packages/advisor/src/index.ts` (add `export { resolveFix } from './fixes'` and `export type { FixParams } from './fixes'`)
- Test: `packages/advisor/test/fixes.test.ts`

**Interfaces:**
- Consumes: `FindingFix` (Task 1).
- Produces:

```ts
export interface FixParams { routePattern?: string; system?: string; sourceFile?: string }
export type FixResolver = (framework: string, params: FixParams) => FindingFix
export function resolveFix(ruleId: string, framework: string, params?: FixParams): FindingFix
```

`resolveFix` looks up a per-rule map of framework -> template. Supported framework keys: `'express'`, `'fastify'`, `'next'`, `'nestjs'`, `'hono'`. On an unknown framework (or a rule that has no framework-specific template), it returns the rule's `generic` fallback: `{ framework, explanation, docsUrl }` with **no** `codeSnippet` — never a wrong snippet. Every returned `fix.framework` echoes the framework that was passed in (so the card shows the app's real framework even when falling back to generic text).

The templates below are the concrete, paste-ready snippets. Rules that only give guidance (no snippet) map to `generic` for all frameworks.

- [ ] **Step 1: Write the failing test**

`packages/advisor/test/fixes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveFix } from '../src/fixes'

describe('resolveFix — uncompressed responses', () => {
  it('gives Express the compression middleware', () => {
    const fix = resolveFix('uncompressed-responses', 'express')
    expect(fix.framework).toBe('express')
    expect(fix.codeSnippet).toContain("import compression from 'compression'")
    expect(fix.codeSnippet).toContain('app.use(compression())')
  })
  it('gives Fastify @fastify/compress', () => {
    const fix = resolveFix('uncompressed-responses', 'fastify')
    expect(fix.codeSnippet).toContain("@fastify/compress")
    expect(fix.codeSnippet).toContain('app.register(')
  })
  it('gives Hono the edge-safe compress middleware', () => {
    const fix = resolveFix('uncompressed-responses', 'hono')
    expect(fix.codeSnippet).toContain("import { compress } from 'hono/compress'")
    expect(fix.codeSnippet).toContain("app.use('*', compress())")
    expect(fix.codeSnippet).not.toContain('node:')
  })
  it('gives Next the next.config flag', () => {
    const fix = resolveFix('uncompressed-responses', 'next')
    expect(fix.codeSnippet).toContain('compress: true')
  })
  it('gives Nest compression in main.ts', () => {
    const fix = resolveFix('uncompressed-responses', 'nestjs')
    expect(fix.codeSnippet).toContain('app.use(compression())')
  })
  it('falls back to generic guidance with a docs link and no snippet on unknown framework', () => {
    const fix = resolveFix('uncompressed-responses', 'koa')
    expect(fix.framework).toBe('koa')
    expect(fix.codeSnippet).toBeUndefined()
    expect(fix.docsUrl).toBeTruthy()
  })
})

describe('resolveFix — cache headers', () => {
  it('gives Express an etag/cache-control snippet', () => {
    expect(resolveFix('missing-cache-headers', 'express').codeSnippet).toContain('Cache-Control')
  })
  it('gives Next App Router a revalidate export when the source file is under app/', () => {
    const fix = resolveFix('missing-cache-headers', 'next', { sourceFile: 'app/api/users/[id]/route.ts' })
    expect(fix.codeSnippet).toContain('export const revalidate')
  })
  it('gives Next Pages Router a res.setHeader snippet under pages/', () => {
    const fix = resolveFix('missing-cache-headers', 'next', { sourceFile: 'pages/api/users.ts' })
    expect(fix.codeSnippet).toContain('res.setHeader')
  })
})

describe('resolveFix — n+1 and slow-dependency give guidance', () => {
  it('n+1 explains eager-load/batch with a route in the text', () => {
    const fix = resolveFix('n-plus-one', 'express', { routePattern: '/api/posts' })
    expect(fix.explanation.toLowerCase()).toContain('n+1')
    expect(fix.explanation).toContain('/api/posts')
  })
  it('slow-dependency suggests index/cache/timeout', () => {
    const fix = resolveFix('slow-dependency', 'fastify')
    expect(fix.explanation.toLowerCase()).toMatch(/index|cache|timeout/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @apiscope/advisor test test/fixes.test.ts`
Expected: FAIL — module `../src/fixes` missing.

- [ ] **Step 3: Write minimal implementation**

Create `packages/advisor/src/fixes/templates.ts`:

```ts
import type { FindingFix } from '../types'

export interface FixParams {
  routePattern?: string
  system?: string
  sourceFile?: string
}

type Template = (framework: string, params: FixParams) => FindingFix

function generic(explanation: string, docsUrl: string): Template {
  return (framework) => ({ framework, explanation, docsUrl })
}

const compressionDocs = 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Encoding'
const cacheDocs = 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control'

const uncompressed: Record<string, Template> = {
  express: (framework) => ({
    framework,
    explanation: 'Add the compression middleware before your routes so text responses are gzip-compressed.',
    codeSnippet: "import compression from 'compression'\n\napp.use(compression())",
    docsUrl: compressionDocs
  }),
  fastify: (framework) => ({
    framework,
    explanation: 'Register @fastify/compress so responses are compressed with gzip or brotli.',
    codeSnippet: "import compress from '@fastify/compress'\n\nawait app.register(compress)",
    docsUrl: compressionDocs
  }),
  hono: (framework) => ({
    framework,
    explanation: 'Add the edge-safe compress middleware from hono/compress at the top of your app.',
    codeSnippet: "import { compress } from 'hono/compress'\n\napp.use('*', compress())",
    docsUrl: compressionDocs
  }),
  next: (framework) => ({
    framework,
    explanation: 'Next compresses responses when compress is enabled in next.config.',
    codeSnippet: "// next.config.mjs\nexport default {\n  compress: true\n}",
    docsUrl: 'https://nextjs.org/docs/app/api-reference/config/next-config-js/compress'
  }),
  nestjs: (framework) => ({
    framework,
    explanation: 'Enable the compression middleware in main.ts before app.listen().',
    codeSnippet: "import compression from 'compression'\n\napp.use(compression())",
    docsUrl: compressionDocs
  })
}

function nextCacheTemplate(framework: string, params: FixParams): FindingFix {
  const isPages = (params.sourceFile ?? '').includes('pages/')
  if (isPages) {
    return {
      framework,
      explanation: 'Set Cache-Control on the response in your Pages API handler.',
      codeSnippet: "res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')",
      docsUrl: cacheDocs
    }
  }
  return {
    framework,
    explanation: 'Export a revalidate window from the App Router route to cache it.',
    codeSnippet: 'export const revalidate = 60',
    docsUrl: 'https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config#revalidate'
  }
}

const missingCache: Record<string, Template> = {
  express: (framework) => ({
    framework,
    explanation: 'Send Cache-Control (and let Express compute an ETag) for cacheable GET responses.',
    codeSnippet: "response.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')",
    docsUrl: cacheDocs
  }),
  fastify: (framework) => ({
    framework,
    explanation: 'Set Cache-Control on cacheable GET replies with reply.header.',
    codeSnippet: "reply.header('cache-control', 'public, max-age=60, stale-while-revalidate=300')",
    docsUrl: cacheDocs
  }),
  hono: (framework) => ({
    framework,
    explanation: 'Set Cache-Control on the context for cacheable GET responses.',
    codeSnippet: "c.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')",
    docsUrl: cacheDocs
  }),
  next: nextCacheTemplate,
  nestjs: (framework) => ({
    framework,
    explanation: 'Use @Header or the CacheInterceptor to set Cache-Control on cacheable GET handlers.',
    codeSnippet: "@Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')",
    docsUrl: cacheDocs
  })
}

function oversizedTemplate(framework: string, params: FixParams): FindingFix {
  const route = params.routePattern ?? 'this route'
  return {
    framework,
    explanation: `${route} returns a large JSON body on every request. Paginate the result, select only the fields the client needs, or cap the array length.`,
    docsUrl: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Range_requests'
  }
}

function nPlusOneTemplate(framework: string, params: FixParams): FindingFix {
  const route = params.routePattern ?? 'this route'
  return {
    framework,
    explanation: `${route} runs the same query once per row (an n+1 pattern). Fetch the related rows in one query with a join, an IN (...) batch, or your ORM's eager-load / include option instead of querying inside a loop.`,
    docsUrl: 'https://www.prisma.io/docs/orm/prisma-client/queries/relation-queries#nested-reads'
  }
}

function sequentialOutboundTemplate(framework: string, params: FixParams): FindingFix {
  const route = params.routePattern ?? 'this route'
  return {
    framework,
    explanation: `${route} awaits outbound calls one after another. Start the independent requests together and await them with Promise.all so they run in parallel.`,
    codeSnippet: 'const [a, b] = await Promise.all([fetchA(), fetchB()])',
    docsUrl: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all'
  }
}

function slowDependencyTemplate(framework: string, params: FixParams): FindingFix {
  const target = params.system ?? 'the dependency'
  const route = params.routePattern ?? 'this route'
  return {
    framework,
    explanation: `A single call to ${target} dominates ${route}'s time. Add an index for the query, cache the result, set a tighter timeout, or parallelize it with the rest of the request.`,
    docsUrl: 'https://use-the-index-luke.com/'
  }
}

const genericGuidance: Record<string, Template> = {
  'oversized-payload': oversizedTemplate,
  'n-plus-one': nPlusOneTemplate,
  'sequential-outbound': sequentialOutboundTemplate,
  'slow-dependency': slowDependencyTemplate,
  'slow-route': (framework, params) => ({
    framework,
    explanation: `${params.routePattern ?? 'This route'} is slower than the latency budget. Open "where the time goes" to see whether the time is in your code, the database, or an outbound call, then address the dominant slice.`,
    docsUrl: 'https://web.dev/articles/ttfb'
  }),
  'where-time-goes': (framework, params) => ({
    framework,
    explanation: `The chart above splits ${params.routePattern ?? 'this route'}'s p95 across your code, the database, and outbound calls. Focus on the largest slice.`,
    docsUrl: 'https://web.dev/articles/ttfb'
  }),
  'unstable-latency': (framework, params) => ({
    framework,
    explanation: `${params.routePattern ?? 'This route'} is usually fast but a minority of requests hit a cliff. Open the slow tail in the Inspector to find what those requests have in common (cold cache, a missing index, or a slow dependency).`,
    docsUrl: 'https://web.dev/articles/ttfb'
  }),
  'error-hotspot': (framework, params) => ({
    framework,
    explanation: `${params.routePattern ?? 'This route'} returns errors more often than expected. Open the failing spans to see the status codes and messages, then fix the most common cause.`,
    docsUrl: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status'
  })
}

export const FIX_TEMPLATES: Record<string, Record<string, Template> | Template> = {
  'uncompressed-responses': uncompressed,
  'missing-cache-headers': missingCache,
  'oversized-payload': genericGuidance['oversized-payload'] as Template,
  'slow-route': genericGuidance['slow-route'] as Template,
  'where-time-goes': genericGuidance['where-time-goes'] as Template,
  'unstable-latency': genericGuidance['unstable-latency'] as Template,
  'n-plus-one': genericGuidance['n-plus-one'] as Template,
  'sequential-outbound': genericGuidance['sequential-outbound'] as Template,
  'slow-dependency': genericGuidance['slow-dependency'] as Template,
  'error-hotspot': genericGuidance['error-hotspot'] as Template
}

export const GENERIC_FALLBACK: Record<string, Template> = {
  'uncompressed-responses': generic(
    'Enable response compression (gzip or brotli) in your server or a reverse proxy so text responses download faster.',
    compressionDocs
  ),
  'missing-cache-headers': generic(
    'Send Cache-Control (and an ETag) on cacheable GET responses so clients and proxies can reuse them.',
    cacheDocs
  )
}
```

Create `packages/advisor/src/fixes/index.ts`:

```ts
import type { FindingFix } from '../types'
import { FIX_TEMPLATES, GENERIC_FALLBACK, type FixParams } from './templates'

export type { FixParams } from './templates'

const SUPPORTED_FRAMEWORKS = new Set(['express', 'fastify', 'next', 'nestjs', 'hono'])

export function resolveFix(ruleId: string, framework: string, params: FixParams = {}): FindingFix {
  const entry = FIX_TEMPLATES[ruleId]
  if (typeof entry === 'function') return entry(framework, params)
  if (entry !== undefined && SUPPORTED_FRAMEWORKS.has(framework)) {
    const template = entry[framework]
    if (template !== undefined) return template(framework, params)
  }
  const fallback = GENERIC_FALLBACK[ruleId]
  if (fallback !== undefined) return fallback(framework, params)
  return {
    framework,
    explanation: 'Review this finding and apply the standard remedy for your framework.',
    docsUrl: 'https://developer.mozilla.org/en-US/docs/Web/HTTP'
  }
}
```

Add to `packages/advisor/src/index.ts`: `export { resolveFix } from './fixes'` and `export type { FixParams } from './fixes'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @apiscope/advisor test test/fixes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/advisor/src/fixes packages/advisor/src/index.ts packages/advisor/test/fixes.test.ts
git commit -m "$(cat <<'EOF'
feat(advisor): framework-aware fix resolver with generic fallback

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Shared fixtures + rule engine (registration, isolation, ranking)

**Files:**
- Create: `packages/advisor/test/fixtures.ts`
- Create: `packages/advisor/src/engine.ts`
- Modify: `packages/advisor/src/index.ts` (add `export * from './engine'`)
- Test: `packages/advisor/test/engine.test.ts`

**Interfaces:**
- Consumes: `AdvisorContext`, `Finding`, `AnalyzeResult` (Task 1); `ResolvedAdvisorConfig` (Task 2).
- Produces:

```ts
export interface Rule {
  id: string
  category: FindingCategory
  detect(context: AdvisorContext): Finding[]
}

export function runRules(rules: Rule[], context: AdvisorContext): AnalyzeResult
export function rankFindings(findings: Finding[], totalSpans: number): Finding[]
```

`runRules` skips a rule when `context.config.rules[rule.id]?.enabled === false`, wraps each `detect` in try/catch (a throw is swallowed, the rule is still listed in `rulesRun`), collects findings, ranks them, and sets `insufficientData` to `true` when `context.spans.length < context.config.minimumOverallSampleSize`. `rankFindings` sorts by a score of `severityWeight × trafficShare × fixability` descending, where `severityWeight` is critical=3/warning=2/advisory=1, `trafficShare` is `finding.sampleSize / max(totalSpans, 1)` clamped to `[0.05, 1]`, and `fixability` is `1.0` when `fix.codeSnippet` is present else `0.6`.

`test/fixtures.ts` provides builders reused by all rule tests:

```ts
export function span(overrides?: Partial<RequestSpan>): RequestSpan
export function dbChild(parentSpanId: string, overrides?: Partial<DbChildSpan>): DbChildSpan
export function fetchChild(parentSpanId: string, overrides?: Partial<FetchChildSpan>): FetchChildSpan
export function routeStat(overrides?: Partial<AdvisorRouteStats>): AdvisorRouteStats
export function context(parts: Partial<AdvisorContext>): AdvisorContext
```

- [ ] **Step 1: Write the failing test**

Create `packages/advisor/test/fixtures.ts`:

```ts
import type { DbChildSpan, FetchChildSpan, RequestSpan } from '@apiscope/core'
import type { AdvisorContext, AdvisorRouteStats } from '../src/types'
import { defaultAdvisorConfig } from '../src/config'

let counter = 0
function nextId(prefix: string): string {
  counter += 1
  return `${prefix}-${counter}`
}

export function span(overrides: Partial<RequestSpan> = {}): RequestSpan {
  return {
    id: nextId('span'),
    traceId: nextId('trace'),
    method: 'GET',
    routePattern: '/api/users/:id',
    actualPath: '/api/users/1',
    statusCode: 200,
    timing: { start: 0, ttfb: 2, duration: 10 },
    framework: 'express',
    runtime: 'node',
    ...overrides
  }
}

export function dbChild(parentSpanId: string, overrides: Partial<DbChildSpan> = {}): DbChildSpan {
  return {
    id: nextId('db'),
    parentSpanId,
    traceId: nextId('trace'),
    kind: 'db',
    system: 'postgresql',
    statement: 'SELECT * FROM comments WHERE post_id = 1',
    operation: 'SELECT',
    target: 'appdb',
    rowCount: 1,
    timing: { start: 0, ttfb: null, duration: 3 },
    ...overrides
  }
}

export function fetchChild(parentSpanId: string, overrides: Partial<FetchChildSpan> = {}): FetchChildSpan {
  return {
    id: nextId('fetch'),
    parentSpanId,
    traceId: nextId('trace'),
    kind: 'fetch',
    url: 'http://127.0.0.1:9000/api',
    method: 'GET',
    statusCode: 200,
    timing: { start: 0, ttfb: 5, duration: 40 },
    ...overrides
  }
}

export function routeStat(overrides: Partial<AdvisorRouteStats> = {}): AdvisorRouteStats {
  return { routePattern: '/api/users/:id', method: 'GET', count: 40, errorCount: 0, p50: 10, p95: 20, p99: 30, ...overrides }
}

export function context(parts: Partial<AdvisorContext>): AdvisorContext {
  return {
    spans: [],
    childSpans: [],
    routeStats: [],
    apps: [{ name: 'demo', framework: 'express' }],
    config: defaultAdvisorConfig(),
    ...parts
  }
}
```

Create `packages/advisor/test/engine.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Rule } from '../src/engine'
import { rankFindings, runRules } from '../src/engine'
import { context, span } from './fixtures'
import type { Finding } from '../src/types'

function finding(overrides: Partial<Finding>): Finding {
  return {
    ruleId: 'r',
    category: 'performance',
    severity: 'warning',
    title: 't',
    whatAndWhy: 'w',
    impact: { metric: 'm', humanized: 'h' },
    scope: { level: 'global' },
    evidence: { spanIds: [], deepLink: '#/' },
    fix: { framework: 'express', explanation: 'e' },
    sampleSize: 10,
    ...overrides
  }
}

describe('runRules', () => {
  it('isolates a throwing rule but still records it as run', () => {
    const good: Rule = { id: 'good', category: 'performance', detect: () => [finding({ ruleId: 'good' })] }
    const bad: Rule = {
      id: 'bad',
      category: 'performance',
      detect: () => {
        throw new Error('boom')
      }
    }
    const result = runRules([good, bad], context({ spans: [span(), span()] }))
    expect(result.findings.map((entry) => entry.ruleId)).toEqual(['good'])
    expect(result.rulesRun).toEqual(['good', 'bad'])
  })

  it('skips a rule disabled in config', () => {
    const config = { ...context({}).config }
    config.rules = { ...config.rules, good: { minimumSampleSize: 1, enabled: false } }
    const good: Rule = { id: 'good', category: 'performance', detect: () => [finding({ ruleId: 'good' })] }
    const result = runRules([good], { ...context({ spans: [span()] }), config })
    expect(result.findings).toHaveLength(0)
    expect(result.rulesRun).toEqual([])
  })

  it('flags insufficientData below the overall minimum sample size', () => {
    const noop: Rule = { id: 'noop', category: 'performance', detect: () => [] }
    const result = runRules([noop], context({ spans: [span()] }))
    expect(result.insufficientData).toBe(true)
  })
})

describe('rankFindings', () => {
  it('orders critical with a paste-ready fix ahead of an advisory guidance-only finding', () => {
    const critical = finding({
      ruleId: 'c',
      severity: 'critical',
      sampleSize: 100,
      fix: { framework: 'express', explanation: 'e', codeSnippet: 'x' }
    })
    const advisory = finding({ ruleId: 'a', severity: 'advisory', sampleSize: 5 })
    const ranked = rankFindings([advisory, critical], 100)
    expect(ranked.map((entry) => entry.ruleId)).toEqual(['c', 'a'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @apiscope/advisor test test/engine.test.ts`
Expected: FAIL — module `../src/engine` missing.

- [ ] **Step 3: Write minimal implementation**

Create `packages/advisor/src/engine.ts`:

```ts
import type { AdvisorContext, AnalyzeResult, Finding, FindingCategory, FindingSeverity } from './types'

export interface Rule {
  id: string
  category: FindingCategory
  detect(context: AdvisorContext): Finding[]
}

const SEVERITY_WEIGHT: Record<FindingSeverity, number> = { critical: 3, warning: 2, advisory: 1 }

function scoreOf(finding: Finding, totalSpans: number): number {
  const trafficShare = Math.min(1, Math.max(0.05, finding.sampleSize / Math.max(totalSpans, 1)))
  const fixability = finding.fix.codeSnippet !== undefined ? 1 : 0.6
  return SEVERITY_WEIGHT[finding.severity] * trafficShare * fixability
}

export function rankFindings(findings: Finding[], totalSpans: number): Finding[] {
  return [...findings].sort((left, right) => scoreOf(right, totalSpans) - scoreOf(left, totalSpans))
}

export function runRules(rules: Rule[], context: AdvisorContext): AnalyzeResult {
  const findings: Finding[] = []
  const rulesRun: string[] = []
  for (const rule of rules) {
    if (context.config.rules[rule.id]?.enabled === false) continue
    rulesRun.push(rule.id)
    try {
      findings.push(...rule.detect(context))
    } catch {
      continue
    }
  }
  return {
    findings: rankFindings(findings, context.spans.length),
    rulesRun,
    insufficientData: context.spans.length < context.config.minimumOverallSampleSize
  }
}
```

Add to `packages/advisor/src/index.ts`: `export * from './engine'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @apiscope/advisor test test/engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/advisor/src/engine.ts packages/advisor/src/index.ts packages/advisor/test/fixtures.ts packages/advisor/test/engine.test.ts
git commit -m "$(cat <<'EOF'
feat(advisor): rule engine with failure isolation and ranking

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Rule — uncompressed responses

**Files:**
- Create: `packages/advisor/src/rules/uncompressed.ts`
- Test: `packages/advisor/test/rules/uncompressed.test.ts`

**Interfaces:**
- Consumes: `Rule`, `AdvisorContext`, `resolveFix`, helpers (`responseBytes`, `headerValue`, `isTextyContentType`, `humanizeBytes`, `formatPercent`), thresholds `compressibleMinBytes`.
- Produces: `export const uncompressedResponsesRule: Rule` with `id: 'uncompressed-responses'`, `category: 'payload'`.

Detection: consider spans whose `response` content-type is texty (`isTextyContentType(headerValue(response.headers,'content-type'))`), whose `responseBytes >= compressibleMinBytes`, and whose `content-encoding` is absent or not `gzip`/`br`/`deflate`. Group offenders by `routePattern`; a route qualifies once it has `>= minimumSampleSize` such spans (rule min from `context.config.rules['uncompressed-responses'].minimumSampleSize`). Emit **one global finding** summarizing the offending routes, with `sampleSize` = total offending spans across qualifying routes, `severity: 'warning'`. `impact.metric = "avgBytes=<rounded mean>"`; `impact.humanized = "~<bytes> to ~<bytes*0.2> · affects <pct>% of traffic"` (compression ~5x on text; pct = offending spans / total spans). `scope.level='global'`. `evidence.spanIds` = up to 10 offending span ids; `deepLink = '#/routes'`. `fix = resolveFix('uncompressed-responses', framework)` where `framework` is the most common framework among offenders. `title = "<n> route(s) send uncompressed responses"`.

- [ ] **Step 1: Write the failing test**

`packages/advisor/test/rules/uncompressed.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { uncompressedResponsesRule } from '../../src/rules/uncompressed'
import { context, span } from '../fixtures'

function jsonResponse(bytes: number, encoding?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'content-length': String(bytes) }
  if (encoding !== undefined) headers['content-encoding'] = encoding
  return { headers, truncated: false, redactedHeaders: [] }
}

describe('uncompressed-responses rule', () => {
  it('fires for a route serving large uncompressed JSON', () => {
    const spans = Array.from({ length: 8 }, () =>
      span({ routePattern: '/api/list', framework: 'express', response: jsonResponse(20000) })
    )
    const findings = uncompressedResponsesRule.detect(context({ spans }))
    expect(findings).toHaveLength(1)
    const finding = findings[0]!
    expect(finding.ruleId).toBe('uncompressed-responses')
    expect(finding.severity).toBe('warning')
    expect(finding.sampleSize).toBe(8)
    expect(finding.fix.framework).toBe('express')
    expect(finding.fix.codeSnippet).toContain('compression')
    expect(finding.impact.humanized).toContain('%')
  })

  it('stays silent when responses are already gzip-encoded', () => {
    const spans = Array.from({ length: 8 }, () =>
      span({ routePattern: '/api/list', response: jsonResponse(20000, 'gzip') })
    )
    expect(uncompressedResponsesRule.detect(context({ spans }))).toHaveLength(0)
  })

  it('stays silent below the small-body threshold', () => {
    const spans = Array.from({ length: 8 }, () => span({ response: jsonResponse(200) }))
    expect(uncompressedResponsesRule.detect(context({ spans }))).toHaveLength(0)
  })

  it('stays silent below the minimum sample size', () => {
    const spans = Array.from({ length: 2 }, () => span({ response: jsonResponse(20000) }))
    expect(uncompressedResponsesRule.detect(context({ spans }))).toHaveLength(0)
  })

  it('does not flag non-text content types', () => {
    const spans = Array.from({ length: 8 }, () =>
      span({ response: { headers: { 'content-type': 'image/png', 'content-length': '90000' }, truncated: false, redactedHeaders: [] } })
    )
    expect(uncompressedResponsesRule.detect(context({ spans }))).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @apiscope/advisor test test/rules/uncompressed.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

Create `packages/advisor/src/rules/uncompressed.ts`:

```ts
import type { RequestSpan } from '@apiscope/core'
import type { Finding } from '../types'
import type { Rule } from '../engine'
import { resolveFix } from '../fixes'
import { formatPercent, headerValue, humanizeBytes, isTextyContentType, responseBytes } from '../util/statement'

const COMPRESSED_ENCODINGS = new Set(['gzip', 'br', 'deflate'])

function isUncompressedTextyOffender(span: RequestSpan, minBytes: number): boolean {
  if (span.response === undefined) return false
  const contentType = headerValue(span.response.headers, 'content-type')
  if (!isTextyContentType(contentType)) return false
  const bytes = responseBytes(span.response)
  if (bytes === null || bytes < minBytes) return false
  const encoding = headerValue(span.response.headers, 'content-encoding')?.toLowerCase()
  if (encoding !== undefined && COMPRESSED_ENCODINGS.has(encoding)) return false
  return true
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  let best = values[0] ?? 'unknown'
  let bestCount = 0
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }
  return best
}

export const uncompressedResponsesRule: Rule = {
  id: 'uncompressed-responses',
  category: 'payload',
  detect(context): Finding[] {
    const minSample = context.config.rules['uncompressed-responses']?.minimumSampleSize ?? 5
    const minBytes = context.config.thresholds.compressibleMinBytes
    const offenders = context.spans.filter((span) => isUncompressedTextyOffender(span, minBytes))
    if (offenders.length === 0) return []
    const byRoute = new Map<string, RequestSpan[]>()
    for (const span of offenders) {
      const key = span.routePattern ?? span.actualPath
      byRoute.set(key, [...(byRoute.get(key) ?? []), span])
    }
    const qualifyingRoutes = [...byRoute.entries()].filter(([, spans]) => spans.length >= minSample)
    if (qualifyingRoutes.length === 0) return []
    const qualifyingSpans = qualifyingRoutes.flatMap(([, spans]) => spans)
    const totalBytes = qualifyingSpans.reduce((sum, span) => sum + (responseBytes(span.response) ?? 0), 0)
    const meanBytes = Math.round(totalBytes / qualifyingSpans.length)
    const framework = mostCommon(qualifyingSpans.map((span) => span.framework))
    const trafficPct = formatPercent(qualifyingSpans.length / Math.max(context.spans.length, 1))
    return [
      {
        ruleId: 'uncompressed-responses',
        category: 'payload',
        severity: 'warning',
        title: `${qualifyingRoutes.length} route${qualifyingRoutes.length === 1 ? '' : 's'} send uncompressed responses`,
        whatAndWhy:
          'Text responses over ~1.4 KB are sent without gzip or brotli, so clients download several times more bytes than they need to.',
        impact: {
          metric: `avgBytes=${meanBytes}`,
          humanized: `~${humanizeBytes(meanBytes)} to ~${humanizeBytes(Math.round(meanBytes * 0.2))} · affects ${trafficPct} of traffic`
        },
        scope: { level: 'global' },
        evidence: { spanIds: qualifyingSpans.slice(0, 10).map((span) => span.id), deepLink: '#/routes' },
        fix: resolveFix('uncompressed-responses', framework),
        sampleSize: qualifyingSpans.length
      }
    ]
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @apiscope/advisor test test/rules/uncompressed.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/advisor/src/rules/uncompressed.ts packages/advisor/test/rules/uncompressed.test.ts
git commit -m "$(cat <<'EOF'
feat(advisor): uncompressed-responses rule

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Rule — missing cache headers

**Files:**
- Create: `packages/advisor/src/rules/missing-cache.ts`
- Test: `packages/advisor/test/rules/missing-cache.test.ts`

**Interfaces:**
- Consumes: `Rule`, helpers, `resolveFix`.
- Produces: `export const missingCacheHeadersRule: Rule` with `id: 'missing-cache-headers'`, `category: 'caching'`.

Detection: consider only `GET` spans with `statusCode === 200`. An offender has **neither** `cache-control` **nor** `etag` in `response.headers`. Group by `routePattern`; a route qualifies when the same `method GET` + `routePattern` appears `>= minimumSampleSize` times with identical `actualPath` repeated (a *repeated identical GET*) — approximate "repeated identical" by: at least `minimumSampleSize` offender spans on that route AND at least one `actualPath` value occurs at least twice. Emit **one finding per qualifying route** (advisory). `severity: 'advisory'`. `scope.level='route'`, `routePattern` set. For the fix, pass `sourceFile` from any matching `routeStats`/span if available (Next needs it) — here take it from the span's own metadata is unavailable, so pass `{ routePattern, sourceFile: undefined }`; the Next template defaults to App Router. `impact.metric = "repeatedGets=<n>"`, `impact.humanized = "<n> identical GETs with no cache-control or etag"`. `evidence.deepLink = "#/routes"`. `fix = resolveFix('missing-cache-headers', framework, { routePattern })`. `title = "<method> <routePattern> is cacheable but has no cache headers"`.

- [ ] **Step 1: Write the failing test**

`packages/advisor/test/rules/missing-cache.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { missingCacheHeadersRule } from '../../src/rules/missing-cache'
import { context, span } from '../fixtures'

function bareResponse() {
  return { headers: { 'content-type': 'application/json' }, truncated: false, redactedHeaders: [] }
}

describe('missing-cache-headers rule', () => {
  it('fires for a repeated identical GET returning 200 with no cache headers', () => {
    const spans = Array.from({ length: 6 }, () =>
      span({ method: 'GET', statusCode: 200, routePattern: '/api/config', actualPath: '/api/config', response: bareResponse() })
    )
    const findings = missingCacheHeadersRule.detect(context({ spans }))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.ruleId).toBe('missing-cache-headers')
    expect(findings[0]!.severity).toBe('advisory')
    expect(findings[0]!.scope.routePattern).toBe('/api/config')
  })

  it('stays silent when cache-control is present', () => {
    const spans = Array.from({ length: 6 }, () =>
      span({ method: 'GET', statusCode: 200, actualPath: '/api/config', response: { headers: { 'cache-control': 'max-age=60' }, truncated: false, redactedHeaders: [] } })
    )
    expect(missingCacheHeadersRule.detect(context({ spans }))).toHaveLength(0)
  })

  it('stays silent when an etag is present', () => {
    const spans = Array.from({ length: 6 }, () =>
      span({ method: 'GET', statusCode: 200, actualPath: '/api/config', response: { headers: { etag: 'W/"x"' }, truncated: false, redactedHeaders: [] } })
    )
    expect(missingCacheHeadersRule.detect(context({ spans }))).toHaveLength(0)
  })

  it('ignores non-GET and non-200', () => {
    const spans = [
      ...Array.from({ length: 6 }, () => span({ method: 'POST', statusCode: 200, response: bareResponse() })),
      ...Array.from({ length: 6 }, () => span({ method: 'GET', statusCode: 500, response: bareResponse() }))
    ]
    expect(missingCacheHeadersRule.detect(context({ spans }))).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @apiscope/advisor test test/rules/missing-cache.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

Create `packages/advisor/src/rules/missing-cache.ts`:

```ts
import type { RequestSpan } from '@apiscope/core'
import type { Finding } from '../types'
import type { Rule } from '../engine'
import { resolveFix } from '../fixes'
import { headerValue } from '../util/statement'

function lacksCacheHeaders(span: RequestSpan): boolean {
  if (span.method !== 'GET' || span.statusCode !== 200 || span.response === undefined) return false
  const cacheControl = headerValue(span.response.headers, 'cache-control')
  const etag = headerValue(span.response.headers, 'etag')
  return cacheControl === undefined && etag === undefined
}

function hasRepeatedPath(spans: RequestSpan[]): boolean {
  const counts = new Map<string, number>()
  for (const span of spans) counts.set(span.actualPath, (counts.get(span.actualPath) ?? 0) + 1)
  for (const count of counts.values()) if (count >= 2) return true
  return false
}

export const missingCacheHeadersRule: Rule = {
  id: 'missing-cache-headers',
  category: 'caching',
  detect(context): Finding[] {
    const minSample = context.config.rules['missing-cache-headers']?.minimumSampleSize ?? 5
    const offenders = context.spans.filter(lacksCacheHeaders)
    if (offenders.length === 0) return []
    const byRoute = new Map<string, RequestSpan[]>()
    for (const span of offenders) {
      if (span.routePattern === null) continue
      const key = span.routePattern
      byRoute.set(key, [...(byRoute.get(key) ?? []), span])
    }
    const findings: Finding[] = []
    for (const [routePattern, spans] of byRoute) {
      if (spans.length < minSample || !hasRepeatedPath(spans)) continue
      const framework = spans[0]!.framework
      findings.push({
        ruleId: 'missing-cache-headers',
        category: 'caching',
        severity: 'advisory',
        title: `GET ${routePattern} is cacheable but has no cache headers`,
        whatAndWhy:
          'The same GET is requested repeatedly and returns 200 with no cache-control or etag, so clients and proxies cannot reuse the response.',
        impact: { metric: `repeatedGets=${spans.length}`, humanized: `${spans.length} identical GETs with no cache-control or etag` },
        scope: { level: 'route', routePattern },
        evidence: { spanIds: spans.slice(0, 10).map((span) => span.id), deepLink: '#/routes' },
        fix: resolveFix('missing-cache-headers', framework, { routePattern }),
        sampleSize: spans.length
      })
    }
    return findings
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @apiscope/advisor test test/rules/missing-cache.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/advisor/src/rules/missing-cache.ts packages/advisor/test/rules/missing-cache.test.ts
git commit -m "$(cat <<'EOF'
feat(advisor): missing-cache-headers rule

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Rule — oversized payload

**Files:**
- Create: `packages/advisor/src/rules/oversized-payload.ts`
- Test: `packages/advisor/test/rules/oversized-payload.test.ts`

**Interfaces:**
- Consumes: `Rule`, helpers (`responseBytes`, `headerValue`, `humanizeBytes`), threshold `oversizedPayloadBytes`, `resolveFix`.
- Produces: `export const oversizedPayloadRule: Rule` with `id: 'oversized-payload'`, `category: 'payload'`.

Detection: consider spans whose response `responseBytes >= oversizedPayloadBytes` (default 100 KB). Group by `routePattern`; a route qualifies when it has `>= minimumSampleSize` such spans AND its **median** offending byte size `>= oversizedPayloadBytes` (consistently large, not a one-off). Emit **one finding per qualifying route**, `severity: 'warning'`. `impact.metric = "p50Bytes=<median>"`, `impact.humanized = "~<median> per response on <route>"`. `scope.level='route'`. `fix = resolveFix('oversized-payload', framework, { routePattern })` (guidance-only). `title = "<method> <route> returns a large payload every call"`.

- [ ] **Step 1: Write the failing test**

`packages/advisor/test/rules/oversized-payload.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { oversizedPayloadRule } from '../../src/rules/oversized-payload'
import { context, span } from '../fixtures'

function jsonBytes(bytes: number) {
  return { headers: { 'content-type': 'application/json', 'content-length': String(bytes) }, truncated: false, redactedHeaders: [] }
}

describe('oversized-payload rule', () => {
  it('fires for a list route consistently returning >100 KB JSON', () => {
    const spans = Array.from({ length: 6 }, () => span({ routePattern: '/api/products', response: jsonBytes(250000) }))
    const findings = oversizedPayloadRule.detect(context({ spans }))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.ruleId).toBe('oversized-payload')
    expect(findings[0]!.severity).toBe('warning')
    expect(findings[0]!.scope.routePattern).toBe('/api/products')
    expect(findings[0]!.impact.humanized).toContain('KB')
    expect(findings[0]!.fix.explanation.toLowerCase()).toContain('paginate')
  })

  it('stays silent for small payloads', () => {
    const spans = Array.from({ length: 6 }, () => span({ response: jsonBytes(2000) }))
    expect(oversizedPayloadRule.detect(context({ spans }))).toHaveLength(0)
  })

  it('stays silent when only an occasional response is large', () => {
    const spans = [
      span({ routePattern: '/api/products', response: jsonBytes(250000) }),
      ...Array.from({ length: 6 }, () => span({ routePattern: '/api/products', response: jsonBytes(2000) }))
    ]
    expect(oversizedPayloadRule.detect(context({ spans }))).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @apiscope/advisor test test/rules/oversized-payload.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

Create `packages/advisor/src/rules/oversized-payload.ts`:

```ts
import type { RequestSpan } from '@apiscope/core'
import type { Finding } from '../types'
import type { Rule } from '../engine'
import { resolveFix } from '../fixes'
import { humanizeBytes, responseBytes } from '../util/statement'

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length === 0) return 0
  if (sorted.length % 2 === 1) return sorted[middle]!
  return Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
}

export const oversizedPayloadRule: Rule = {
  id: 'oversized-payload',
  category: 'payload',
  detect(context): Finding[] {
    const minSample = context.config.rules['oversized-payload']?.minimumSampleSize ?? 5
    const threshold = context.config.thresholds.oversizedPayloadBytes
    const byRoute = new Map<string, RequestSpan[]>()
    for (const span of context.spans) {
      if (span.routePattern === null) continue
      const bytes = responseBytes(span.response)
      if (bytes === null || bytes < threshold) continue
      byRoute.set(span.routePattern, [...(byRoute.get(span.routePattern) ?? []), span])
    }
    const findings: Finding[] = []
    for (const [routePattern, spans] of byRoute) {
      if (spans.length < minSample) continue
      const sizes = spans.map((span) => responseBytes(span.response) ?? 0)
      const medianBytes = median(sizes)
      if (medianBytes < threshold) continue
      const method = spans[0]!.method
      const framework = spans[0]!.framework
      findings.push({
        ruleId: 'oversized-payload',
        category: 'payload',
        severity: 'warning',
        title: `${method} ${routePattern} returns a large payload every call`,
        whatAndWhy:
          'This route returns a large JSON body on every request, which slows the response and increases memory and bandwidth for every client.',
        impact: { metric: `p50Bytes=${medianBytes}`, humanized: `~${humanizeBytes(medianBytes)} per response on ${routePattern}` },
        scope: { level: 'route', routePattern },
        evidence: { spanIds: spans.slice(0, 10).map((span) => span.id), deepLink: '#/routes' },
        fix: resolveFix('oversized-payload', framework, { routePattern }),
        sampleSize: spans.length
      })
    }
    return findings
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @apiscope/advisor test test/rules/oversized-payload.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/advisor/src/rules/oversized-payload.ts packages/advisor/test/rules/oversized-payload.test.ts
git commit -m "$(cat <<'EOF'
feat(advisor): oversized-payload rule

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Rule — slow route

**Files:**
- Create: `packages/advisor/src/rules/slow-route.ts`
- Test: `packages/advisor/test/rules/slow-route.test.ts`

**Interfaces:**
- Consumes: `Rule`, `AdvisorRouteStats`, thresholds `slowRouteP95Ms`/`criticalRouteP95Ms`, helpers (`humanizeMs`), `resolveFix`.
- Produces: `export const slowRouteRule: Rule` with `id: 'slow-route'`, `category: 'performance'`.

Detection: iterate `context.routeStats`. A route qualifies when `stats.count >= minimumSampleSize` (rule min, default 20) and `stats.p95 >= slowRouteP95Ms`. `severity: 'warning'` normally, `'critical'` when `stats.p95 >= criticalRouteP95Ms`. `impact.metric = "p95=<p95>ms"`. `impact.humanized = "p95 <p95> ms means about 1 in 20 requests waits over <humanizeMs(p95)> — users feel that"`. `scope.level='route'`, `routePattern = stats.routePattern ?? '(unmatched)'`. Framework: look up the most common framework among `context.spans` for this route (`span.routePattern === stats.routePattern && span.method === stats.method`), else the first app's framework. `evidence.spanIds` = up to 10 span ids for the slowest such spans (sort those spans by `timing.duration` desc). `deepLink = "#/inspector"`. `fix = resolveFix('slow-route', framework, { routePattern })`. `title = "<method> <route> is slow (p95 <humanizeMs(p95)>)"`.

- [ ] **Step 1: Write the failing test**

`packages/advisor/test/rules/slow-route.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { slowRouteRule } from '../../src/rules/slow-route'
import { context, routeStat, span } from '../fixtures'

describe('slow-route rule', () => {
  it('warns when p95 exceeds the budget with enough samples', () => {
    const stats = [routeStat({ routePattern: '/api/report', p95: 574, count: 40 })]
    const spans = Array.from({ length: 40 }, (_unused, index) =>
      span({ routePattern: '/api/report', framework: 'fastify', timing: { start: 0, ttfb: 10, duration: 500 + index } })
    )
    const findings = slowRouteRule.detect(context({ spans, routeStats: stats }))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.severity).toBe('warning')
    expect(findings[0]!.impact.metric).toBe('p95=574ms')
    expect(findings[0]!.fix.framework).toBe('fastify')
    expect(findings[0]!.evidence.spanIds.length).toBeGreaterThan(0)
  })

  it('escalates to critical past the higher bound', () => {
    const stats = [routeStat({ routePattern: '/api/slow', p95: 1500, count: 40 })]
    const spans = Array.from({ length: 40 }, () => span({ routePattern: '/api/slow' }))
    const findings = slowRouteRule.detect(context({ spans, routeStats: stats }))
    expect(findings[0]!.severity).toBe('critical')
  })

  it('stays silent below the budget', () => {
    const stats = [routeStat({ routePattern: '/api/fast', p95: 120, count: 40 })]
    expect(slowRouteRule.detect(context({ spans: [], routeStats: stats }))).toHaveLength(0)
  })

  it('stays silent below the minimum sample size', () => {
    const stats = [routeStat({ routePattern: '/api/report', p95: 900, count: 3 })]
    expect(slowRouteRule.detect(context({ spans: [], routeStats: stats }))).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @apiscope/advisor test test/rules/slow-route.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

Create `packages/advisor/src/rules/slow-route.ts`:

```ts
import type { RequestSpan } from '@apiscope/core'
import type { AdvisorContext, Finding } from '../types'
import type { Rule } from '../engine'
import { resolveFix } from '../fixes'
import { humanizeMs } from '../util/statement'

function spansForRoute(context: AdvisorContext, routePattern: string | null, method: string): RequestSpan[] {
  return context.spans.filter((span) => span.routePattern === routePattern && span.method === method)
}

function frameworkFor(spans: RequestSpan[], fallback: string): string {
  return spans[0]?.framework ?? fallback
}

export const slowRouteRule: Rule = {
  id: 'slow-route',
  category: 'performance',
  detect(context): Finding[] {
    const minSample = context.config.rules['slow-route']?.minimumSampleSize ?? 20
    const warnMs = context.config.thresholds.slowRouteP95Ms
    const criticalMs = context.config.thresholds.criticalRouteP95Ms
    const fallbackFramework = context.apps[0]?.framework ?? 'unknown'
    const findings: Finding[] = []
    for (const stats of context.routeStats) {
      if (stats.count < minSample || stats.p95 < warnMs) continue
      const routePattern = stats.routePattern ?? '(unmatched)'
      const routeSpans = spansForRoute(context, stats.routePattern, stats.method)
      const slowest = [...routeSpans].sort((left, right) => right.timing.duration - left.timing.duration)
      const severity = stats.p95 >= criticalMs ? 'critical' : 'warning'
      findings.push({
        ruleId: 'slow-route',
        category: 'performance',
        severity,
        title: `${stats.method} ${routePattern} is slow (p95 ${humanizeMs(stats.p95)})`,
        whatAndWhy: `Its 95th-percentile response time is over the ${humanizeMs(warnMs)} budget, so a noticeable share of requests are slow.`,
        impact: {
          metric: `p95=${Math.round(stats.p95)}ms`,
          humanized: `p95 ${Math.round(stats.p95)} ms means about 1 in 20 requests waits over ${humanizeMs(stats.p95)} — users feel that`
        },
        scope: { level: 'route', routePattern },
        evidence: { spanIds: slowest.slice(0, 10).map((span) => span.id), deepLink: '#/inspector' },
        fix: resolveFix('slow-route', frameworkFor(routeSpans, fallbackFramework), { routePattern }),
        sampleSize: stats.count
      })
    }
    return findings
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @apiscope/advisor test test/rules/slow-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/advisor/src/rules/slow-route.ts packages/advisor/test/rules/slow-route.test.ts
git commit -m "$(cat <<'EOF'
feat(advisor): slow-route rule

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Rule — where the time goes (code vs DB vs outbound attribution)

**Files:**
- Create: `packages/advisor/src/rules/where-time-goes.ts`
- Test: `packages/advisor/test/rules/where-time-goes.test.ts`

**Interfaces:**
- Consumes: `Rule`, `AdvisorContext`, child spans, `AdvisorRouteStats`, `resolveFix`, `formatPercent`.
- Produces: `export const whereTimeGoesRule: Rule` with `id: 'where-time-goes'`, `category: 'performance'`.

Detection: for each slow route (same qualification as slow-route: `count >= its own rule min` (default 10) and `p95 >= slowRouteP95Ms`), attribute time. For each span on that route, sum child-span durations by kind: `dbMs` = sum of `db` child durations, `fetchMs` = sum of `fetch` child durations, `codeMs = max(0, span.timing.duration − dbMs − fetchMs)`. Average each bucket across the route's spans that have at least one child span (skip routes with no child spans — attribution is meaningless without them, return nothing for that route). Determine the dominant bucket. Emit one finding, severity `'warning'` if the dominant share `>= 0.5` else `'advisory'`. `impact.metric = "db=<pct>,code=<pct>,outbound=<pct>"`. `impact.humanized = "<dominantPct> of the time is <dominant label>"` e.g. "72% of the time is one or more database queries". `scope.level='route'`. `evidence.spanIds` = up to 10 span ids on the route with child spans. `deepLink = "#/inspector"`. `fix = resolveFix('where-time-goes', framework, { routePattern })`. `title = "Where <method> <route>'s time goes"`.

- [ ] **Step 1: Write the failing test**

`packages/advisor/test/rules/where-time-goes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { whereTimeGoesRule } from '../../src/rules/where-time-goes'
import { context, dbChild, routeStat, span } from '../fixtures'

describe('where-time-goes rule', () => {
  it('attributes most of a slow route to the database when db child spans dominate', () => {
    const spans = Array.from({ length: 12 }, () =>
      span({ routePattern: '/api/report', timing: { start: 0, ttfb: 5, duration: 100 } })
    )
    const childSpans = spans.map((parent) =>
      dbChild(parent.id, { timing: { start: 0, ttfb: null, duration: 90 } })
    )
    const stats = [routeStat({ routePattern: '/api/report', p95: 700, count: 12 })]
    const findings = whereTimeGoesRule.detect(context({ spans, childSpans, routeStats: stats }))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.ruleId).toBe('where-time-goes')
    expect(findings[0]!.impact.metric).toContain('db=')
    expect(findings[0]!.impact.humanized.toLowerCase()).toContain('database')
    expect(findings[0]!.severity).toBe('warning')
  })

  it('stays silent for a slow route with no child spans (nothing to attribute)', () => {
    const spans = Array.from({ length: 12 }, () => span({ routePattern: '/api/cpu' }))
    const stats = [routeStat({ routePattern: '/api/cpu', p95: 700, count: 12 })]
    expect(whereTimeGoesRule.detect(context({ spans, childSpans: [], routeStats: stats }))).toHaveLength(0)
  })

  it('stays silent when the route is within budget', () => {
    const spans = Array.from({ length: 12 }, () => span({ routePattern: '/api/fast' }))
    const childSpans = spans.map((parent) => dbChild(parent.id))
    const stats = [routeStat({ routePattern: '/api/fast', p95: 50, count: 12 })]
    expect(whereTimeGoesRule.detect(context({ spans, childSpans, routeStats: stats }))).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @apiscope/advisor test test/rules/where-time-goes.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

Create `packages/advisor/src/rules/where-time-goes.ts`:

```ts
import type { ChildSpan, RequestSpan } from '@apiscope/core'
import type { AdvisorContext, Finding } from '../types'
import type { Rule } from '../engine'
import { resolveFix } from '../fixes'
import { formatPercent } from '../util/statement'

interface Attribution {
  codeMs: number
  dbMs: number
  fetchMs: number
  spanIds: string[]
}

function attributeRoute(spans: RequestSpan[], childrenByParent: Map<string, ChildSpan[]>): Attribution | null {
  let codeMs = 0
  let dbMs = 0
  let fetchMs = 0
  const spanIds: string[] = []
  let withChildren = 0
  for (const span of spans) {
    const children = childrenByParent.get(span.id) ?? []
    if (children.length === 0) continue
    withChildren += 1
    spanIds.push(span.id)
    let spanDb = 0
    let spanFetch = 0
    for (const child of children) {
      if (child.kind === 'db') spanDb += child.timing.duration
      else spanFetch += child.timing.duration
    }
    dbMs += spanDb
    fetchMs += spanFetch
    codeMs += Math.max(0, span.timing.duration - spanDb - spanFetch)
  }
  if (withChildren === 0) return null
  return { codeMs: codeMs / withChildren, dbMs: dbMs / withChildren, fetchMs: fetchMs / withChildren, spanIds }
}

function childrenByParentMap(childSpans: ChildSpan[]): Map<string, ChildSpan[]> {
  const map = new Map<string, ChildSpan[]>()
  for (const child of childSpans) map.set(child.parentSpanId, [...(map.get(child.parentSpanId) ?? []), child])
  return map
}

export const whereTimeGoesRule: Rule = {
  id: 'where-time-goes',
  category: 'performance',
  detect(context: AdvisorContext): Finding[] {
    const minSample = context.config.rules['where-time-goes']?.minimumSampleSize ?? 10
    const warnMs = context.config.thresholds.slowRouteP95Ms
    const childrenByParent = childrenByParentMap(context.childSpans)
    const fallbackFramework = context.apps[0]?.framework ?? 'unknown'
    const findings: Finding[] = []
    for (const stats of context.routeStats) {
      if (stats.count < minSample || stats.p95 < warnMs) continue
      const routeSpans = context.spans.filter(
        (span) => span.routePattern === stats.routePattern && span.method === stats.method
      )
      const attribution = attributeRoute(routeSpans, childrenByParent)
      if (attribution === null) continue
      const total = attribution.codeMs + attribution.dbMs + attribution.fetchMs
      if (total <= 0) continue
      const buckets: Array<{ key: 'db' | 'code' | 'outbound'; label: string; ms: number }> = [
        { key: 'db', label: 'one or more database queries', ms: attribution.dbMs },
        { key: 'code', label: 'your own code (CPU or blocking work)', ms: attribution.codeMs },
        { key: 'outbound', label: 'outbound calls to other services', ms: attribution.fetchMs }
      ]
      const dominant = [...buckets].sort((left, right) => right.ms - left.ms)[0]!
      const dominantShare = dominant.ms / total
      const routePattern = stats.routePattern ?? '(unmatched)'
      findings.push({
        ruleId: 'where-time-goes',
        category: 'performance',
        severity: dominantShare >= 0.5 ? 'warning' : 'advisory',
        title: `Where ${stats.method} ${routePattern}'s time goes`,
        whatAndWhy: 'This slow route breaks down across your code, the database, and outbound calls so you can fix the part that actually matters.',
        impact: {
          metric: `db=${formatPercent(attribution.dbMs / total)},code=${formatPercent(attribution.codeMs / total)},outbound=${formatPercent(attribution.fetchMs / total)}`,
          humanized: `${formatPercent(dominantShare)} of the time is ${dominant.label}`
        },
        scope: { level: 'route', routePattern },
        evidence: { spanIds: attribution.spanIds.slice(0, 10), deepLink: '#/inspector' },
        fix: resolveFix('where-time-goes', routeSpans[0]?.framework ?? fallbackFramework, { routePattern }),
        sampleSize: stats.count
      })
    }
    return findings
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @apiscope/advisor test test/rules/where-time-goes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/advisor/src/rules/where-time-goes.ts packages/advisor/test/rules/where-time-goes.test.ts
git commit -m "$(cat <<'EOF'
feat(advisor): where-time-goes attribution rule

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Rule — unstable latency

**Files:**
- Create: `packages/advisor/src/rules/unstable-latency.ts`
- Test: `packages/advisor/test/rules/unstable-latency.test.ts`

**Interfaces:**
- Consumes: `Rule`, `AdvisorRouteStats`, threshold `unstableLatencyRatio`, `resolveFix`, `humanizeMs`.
- Produces: `export const unstableLatencyRule: Rule` with `id: 'unstable-latency'`, `category: 'performance'`.

Detection: for each `stats` with `count >= minimumSampleSize` (default 30) and `p50 > 0` and `p99 / p50 >= unstableLatencyRatio` (default 5). `severity: 'warning'` when the ratio `>= unstableLatencyRatio * 2`, else `'advisory'`. `impact.metric = "p99/p50=<ratio.toFixed(1)>"`. `impact.humanized = "most requests finish in ~<humanizeMs(p50)> but the slow tail hits ~<humanizeMs(p99)>"`. `scope.level='route'`. `evidence.deepLink = "#/inspector"`; `spanIds` = up to 10 slowest span ids for the route. `fix = resolveFix('unstable-latency', framework, { routePattern })`. `title = "<method> <route> has an unstable latency tail"`.

- [ ] **Step 1: Write the failing test**

`packages/advisor/test/rules/unstable-latency.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { unstableLatencyRule } from '../../src/rules/unstable-latency'
import { context, routeStat, span } from '../fixtures'

describe('unstable-latency rule', () => {
  it('fires when p99/p50 exceeds the ratio', () => {
    const stats = [routeStat({ routePattern: '/api/spiky', p50: 20, p95: 120, p99: 400, count: 60 })]
    const spans = Array.from({ length: 60 }, () => span({ routePattern: '/api/spiky' }))
    const findings = unstableLatencyRule.detect(context({ spans, routeStats: stats }))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.ruleId).toBe('unstable-latency')
    expect(findings[0]!.impact.metric).toBe('p99/p50=20.0')
  })

  it('stays silent for a stable route', () => {
    const stats = [routeStat({ routePattern: '/api/stable', p50: 20, p95: 30, p99: 45, count: 60 })]
    expect(unstableLatencyRule.detect(context({ spans: [], routeStats: stats }))).toHaveLength(0)
  })

  it('stays silent below the minimum sample size', () => {
    const stats = [routeStat({ routePattern: '/api/spiky', p50: 20, p99: 400, count: 5 })]
    expect(unstableLatencyRule.detect(context({ spans: [], routeStats: stats }))).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @apiscope/advisor test test/rules/unstable-latency.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

Create `packages/advisor/src/rules/unstable-latency.ts`:

```ts
import type { Finding } from '../types'
import type { Rule } from '../engine'
import { resolveFix } from '../fixes'
import { humanizeMs } from '../util/statement'

export const unstableLatencyRule: Rule = {
  id: 'unstable-latency',
  category: 'performance',
  detect(context): Finding[] {
    const minSample = context.config.rules['unstable-latency']?.minimumSampleSize ?? 30
    const ratioThreshold = context.config.thresholds.unstableLatencyRatio
    const fallbackFramework = context.apps[0]?.framework ?? 'unknown'
    const findings: Finding[] = []
    for (const stats of context.routeStats) {
      if (stats.count < minSample || stats.p50 <= 0) continue
      const ratio = stats.p99 / stats.p50
      if (ratio < ratioThreshold) continue
      const routePattern = stats.routePattern ?? '(unmatched)'
      const routeSpans = context.spans.filter(
        (span) => span.routePattern === stats.routePattern && span.method === stats.method
      )
      const slowest = [...routeSpans].sort((left, right) => right.timing.duration - left.timing.duration)
      findings.push({
        ruleId: 'unstable-latency',
        category: 'performance',
        severity: ratio >= ratioThreshold * 2 ? 'warning' : 'advisory',
        title: `${stats.method} ${routePattern} has an unstable latency tail`,
        whatAndWhy: 'Most requests are fast but a minority hit a cliff, which shows up as a large gap between the median and the 99th percentile.',
        impact: {
          metric: `p99/p50=${ratio.toFixed(1)}`,
          humanized: `most requests finish in ~${humanizeMs(stats.p50)} but the slow tail hits ~${humanizeMs(stats.p99)}`
        },
        scope: { level: 'route', routePattern },
        evidence: { spanIds: slowest.slice(0, 10).map((span) => span.id), deepLink: '#/inspector' },
        fix: resolveFix('unstable-latency', routeSpans[0]?.framework ?? fallbackFramework, { routePattern }),
        sampleSize: stats.count
      })
    }
    return findings
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @apiscope/advisor test test/rules/unstable-latency.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/advisor/src/rules/unstable-latency.ts packages/advisor/test/rules/unstable-latency.test.ts
git commit -m "$(cat <<'EOF'
feat(advisor): unstable-latency rule

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Rule — N+1 queries

**Files:**
- Create: `packages/advisor/src/rules/n-plus-one.ts`
- Test: `packages/advisor/test/rules/n-plus-one.test.ts`

**Interfaces:**
- Consumes: `Rule`, `DbChildSpan`, `normalizeStatement`, `resolveFix`, `humanizeMs`.
- Produces: `export const nPlusOneRule: Rule` with `id: 'n-plus-one'`, `category: 'database'`; plus an exported pure helper `export function detectNPlusOneGroups(childSpans: ChildSpan[]): Array<{ template: string; system: string; count: number; totalDurationMs: number }>` (grouping `db` children of one parent by `normalizeStatement(statement)` + `system`, keeping groups with `count >= 2`).

Detection: group `context.childSpans` by `parentSpanId`, keep only `db` children, run `detectNPlusOneGroups` per parent. A parent span "has n+1" when any group has `count >= 3` (the repeated-query threshold; matches the collector's own `detectNPlusOne` spirit but stricter to reduce noise). Group affected parent spans by their route (`routePattern`). A route qualifies when `>= minimumSampleSize` affected requests (rule min default 3). Emit one finding per qualifying route, `severity: 'warning'`. Use the worst group (highest `count × totalDurationMs`) for the numbers. `impact.metric = "queries=<count>"`. `impact.humanized = "~<count> repeated queries per request (~<humanizeMs(totalDurationMs)> total)"`. `scope.level='route'`. `evidence.spanIds` = up to 10 affected parent span ids. `deepLink = "#/inspector"`. `fix = resolveFix('n-plus-one', framework, { routePattern, system })`. `title = "N+1 queries on <method> <route>"`.

- [ ] **Step 1: Write the failing test**

`packages/advisor/test/rules/n-plus-one.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { detectNPlusOneGroups, nPlusOneRule } from '../../src/rules/n-plus-one'
import { context, dbChild, span } from '../fixtures'

describe('detectNPlusOneGroups', () => {
  it('groups repeated parameterized queries into one template', () => {
    const parent = span()
    const children = Array.from({ length: 6 }, (_unused, index) =>
      dbChild(parent.id, { statement: `SELECT * FROM comments WHERE post_id = ${index}`, timing: { start: 0, ttfb: null, duration: 2 } })
    )
    const groups = detectNPlusOneGroups(children)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.count).toBe(6)
    expect(groups[0]!.template).toContain('post_id = ?')
    expect(groups[0]!.totalDurationMs).toBe(12)
  })
})

describe('n-plus-one rule', () => {
  it('fires for a route whose requests each run the same query many times', () => {
    const parents = Array.from({ length: 4 }, () => span({ routePattern: '/api/posts', framework: 'express' }))
    const childSpans = parents.flatMap((parent) =>
      Array.from({ length: 6 }, (_unused, index) => dbChild(parent.id, { statement: `SELECT * FROM comments WHERE post_id = ${index}` }))
    )
    const findings = nPlusOneRule.detect(context({ spans: parents, childSpans }))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.ruleId).toBe('n-plus-one')
    expect(findings[0]!.severity).toBe('warning')
    expect(findings[0]!.scope.routePattern).toBe('/api/posts')
    expect(findings[0]!.fix.explanation.toLowerCase()).toContain('n+1')
  })

  it('stays silent when a request runs only distinct queries', () => {
    const parent = span({ routePattern: '/api/posts' })
    const childSpans = [
      dbChild(parent.id, { statement: 'SELECT * FROM posts' }),
      dbChild(parent.id, { statement: 'SELECT * FROM users' })
    ]
    expect(nPlusOneRule.detect(context({ spans: [parent], childSpans }))).toHaveLength(0)
  })

  it('stays silent below the minimum affected-request count', () => {
    const parent = span({ routePattern: '/api/posts' })
    const childSpans = Array.from({ length: 6 }, (_unused, index) =>
      dbChild(parent.id, { statement: `SELECT * FROM comments WHERE post_id = ${index}` })
    )
    const findings = nPlusOneRule.detect({
      ...context({ spans: [parent], childSpans }),
      config: { ...context({}).config, rules: { ...context({}).config.rules, 'n-plus-one': { minimumSampleSize: 3, enabled: true } } }
    })
    expect(findings).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @apiscope/advisor test test/rules/n-plus-one.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

Create `packages/advisor/src/rules/n-plus-one.ts`:

```ts
import type { ChildSpan, DbChildSpan, RequestSpan } from '@apiscope/core'
import type { Finding } from '../types'
import type { Rule } from '../engine'
import { resolveFix } from '../fixes'
import { humanizeMs, normalizeStatement } from '../util/statement'

interface QueryGroup {
  template: string
  system: string
  count: number
  totalDurationMs: number
}

function isDbChild(child: ChildSpan): child is DbChildSpan {
  return child.kind === 'db'
}

export function detectNPlusOneGroups(childSpans: ChildSpan[]): QueryGroup[] {
  const groups = new Map<string, QueryGroup>()
  for (const child of childSpans) {
    if (!isDbChild(child)) continue
    const template = normalizeStatement(child.statement)
    const key = `${child.system}::${template}`
    const existing = groups.get(key)
    if (existing === undefined) {
      groups.set(key, { template, system: child.system, count: 1, totalDurationMs: child.timing.duration })
    } else {
      existing.count += 1
      existing.totalDurationMs += child.timing.duration
    }
  }
  return [...groups.values()].filter((group) => group.count >= 2)
}

function childrenByParent(childSpans: ChildSpan[]): Map<string, ChildSpan[]> {
  const map = new Map<string, ChildSpan[]>()
  for (const child of childSpans) map.set(child.parentSpanId, [...(map.get(child.parentSpanId) ?? []), child])
  return map
}

export const nPlusOneRule: Rule = {
  id: 'n-plus-one',
  category: 'database',
  detect(context): Finding[] {
    const minSample = context.config.rules['n-plus-one']?.minimumSampleSize ?? 3
    const byParent = childrenByParent(context.childSpans)
    const spansById = new Map(context.spans.map((span) => [span.id, span]))
    const affectedByRoute = new Map<string, { spans: RequestSpan[]; worst: QueryGroup }>()
    for (const [parentSpanId, children] of byParent) {
      const parent = spansById.get(parentSpanId)
      if (parent === undefined || parent.routePattern === null) continue
      const groups = detectNPlusOneGroups(children).filter((group) => group.count >= 3)
      if (groups.length === 0) continue
      const worst = [...groups].sort(
        (left, right) => right.count * right.totalDurationMs - left.count * left.totalDurationMs
      )[0]!
      const key = `${parent.method} ${parent.routePattern}`
      const entry = affectedByRoute.get(key)
      if (entry === undefined) {
        affectedByRoute.set(key, { spans: [parent], worst })
      } else {
        entry.spans.push(parent)
        if (worst.count * worst.totalDurationMs > entry.worst.count * entry.worst.totalDurationMs) entry.worst = worst
      }
    }
    const findings: Finding[] = []
    for (const [, entry] of affectedByRoute) {
      if (entry.spans.length < minSample) continue
      const parent = entry.spans[0]!
      const routePattern = parent.routePattern ?? '(unmatched)'
      findings.push({
        ruleId: 'n-plus-one',
        category: 'database',
        severity: 'warning',
        title: `N+1 queries on ${parent.method} ${routePattern}`,
        whatAndWhy: 'Each request runs the same query once per row instead of fetching the related rows in a single query, multiplying database round-trips.',
        impact: {
          metric: `queries=${entry.worst.count}`,
          humanized: `~${entry.worst.count} repeated queries per request (~${humanizeMs(entry.worst.totalDurationMs)} total)`
        },
        scope: { level: 'route', routePattern },
        evidence: { spanIds: entry.spans.slice(0, 10).map((span) => span.id), deepLink: '#/inspector' },
        fix: resolveFix('n-plus-one', parent.framework, { routePattern, system: entry.worst.system }),
        sampleSize: entry.spans.length
      })
    }
    return findings
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @apiscope/advisor test test/rules/n-plus-one.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/advisor/src/rules/n-plus-one.ts packages/advisor/test/rules/n-plus-one.test.ts
git commit -m "$(cat <<'EOF'
feat(advisor): n-plus-one query rule

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Rule — sequential outbound calls

**Files:**
- Create: `packages/advisor/src/rules/sequential-outbound.ts`
- Test: `packages/advisor/test/rules/sequential-outbound.test.ts`

**Interfaces:**
- Consumes: `Rule`, `FetchChildSpan`, threshold `sequentialOutboundMinMs`, `resolveFix`, `humanizeMs`.
- Produces: `export const sequentialOutboundRule: Rule` with `id: 'sequential-outbound'`, `category: 'dependencies'`; plus `export function nonOverlappingFetches(children: ChildSpan[]): FetchChildSpan[]` returning the fetch children when there are 2+ and **none overlap in time** (each fetch starts at or after the previous one ends, within a small tolerance), each lasting `>= sequentialOutboundMinMs`.

Time model: a child's interval is `[timing.start, timing.start + timing.duration]`. Sort fetch children by `start`. They are "sequential" (parallelizable) when for every adjacent pair `next.start >= prev.start + prev.duration - tolerance` (tolerance 2 ms) and every fetch duration `>= sequentialOutboundMinMs`. Detection: for each parent span, if `nonOverlappingFetches(children).length >= 2`, the request is affected. Group affected requests by route; qualify at `>= minimumSampleSize` (default 3). Emit one finding per route, `severity: 'warning'`. `impact.metric = "serialFetches=<n>"`, `impact.humanized = "<n> outbound calls run one after another (~<humanizeMs(sumDurations)> serial); running them together could cut this"`. `evidence.deepLink="#/inspector"`. `fix = resolveFix('sequential-outbound', framework, { routePattern })`. `title = "Sequential outbound calls on <method> <route>"`.

- [ ] **Step 1: Write the failing test**

`packages/advisor/test/rules/sequential-outbound.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { nonOverlappingFetches, sequentialOutboundRule } from '../../src/rules/sequential-outbound'
import { context, fetchChild, span } from '../fixtures'

describe('nonOverlappingFetches', () => {
  it('detects two back-to-back fetches as sequential', () => {
    const parent = span()
    const children = [
      fetchChild(parent.id, { timing: { start: 0, ttfb: 10, duration: 40 } }),
      fetchChild(parent.id, { timing: { start: 40, ttfb: 10, duration: 40 } })
    ]
    expect(nonOverlappingFetches(children)).toHaveLength(2)
  })

  it('returns empty when fetches overlap (already parallel)', () => {
    const parent = span()
    const children = [
      fetchChild(parent.id, { timing: { start: 0, ttfb: 10, duration: 40 } }),
      fetchChild(parent.id, { timing: { start: 5, ttfb: 10, duration: 40 } })
    ]
    expect(nonOverlappingFetches(children)).toHaveLength(0)
  })
})

describe('sequential-outbound rule', () => {
  it('fires for a route that serializes independent outbound calls', () => {
    const parents = Array.from({ length: 4 }, () => span({ routePattern: '/api/aggregate', framework: 'express' }))
    const childSpans = parents.flatMap((parent) => [
      fetchChild(parent.id, { timing: { start: 0, ttfb: 10, duration: 40 } }),
      fetchChild(parent.id, { timing: { start: 40, ttfb: 10, duration: 40 } })
    ])
    const findings = sequentialOutboundRule.detect(context({ spans: parents, childSpans }))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.ruleId).toBe('sequential-outbound')
    expect(findings[0]!.fix.codeSnippet).toContain('Promise.all')
  })

  it('stays silent when the calls already overlap', () => {
    const parents = Array.from({ length: 4 }, () => span({ routePattern: '/api/aggregate' }))
    const childSpans = parents.flatMap((parent) => [
      fetchChild(parent.id, { timing: { start: 0, ttfb: 10, duration: 40 } }),
      fetchChild(parent.id, { timing: { start: 2, ttfb: 10, duration: 40 } })
    ])
    expect(sequentialOutboundRule.detect(context({ spans: parents, childSpans }))).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @apiscope/advisor test test/rules/sequential-outbound.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

Create `packages/advisor/src/rules/sequential-outbound.ts`:

```ts
import type { ChildSpan, FetchChildSpan, RequestSpan } from '@apiscope/core'
import type { Finding } from '../types'
import type { Rule } from '../engine'
import { resolveFix } from '../fixes'
import { humanizeMs } from '../util/statement'

const OVERLAP_TOLERANCE_MS = 2

function isFetchChild(child: ChildSpan): child is FetchChildSpan {
  return child.kind === 'fetch'
}

export function nonOverlappingFetches(children: ChildSpan[], minDurationMs = 0): FetchChildSpan[] {
  const fetches = children.filter(isFetchChild).sort((left, right) => left.timing.start - right.timing.start)
  if (fetches.length < 2) return []
  for (const fetch of fetches) if (fetch.timing.duration < minDurationMs) return []
  for (let index = 1; index < fetches.length; index += 1) {
    const previous = fetches[index - 1]!
    const current = fetches[index]!
    const previousEnd = previous.timing.start + previous.timing.duration
    if (current.timing.start < previousEnd - OVERLAP_TOLERANCE_MS) return []
  }
  return fetches
}

function childrenByParent(childSpans: ChildSpan[]): Map<string, ChildSpan[]> {
  const map = new Map<string, ChildSpan[]>()
  for (const child of childSpans) map.set(child.parentSpanId, [...(map.get(child.parentSpanId) ?? []), child])
  return map
}

export const sequentialOutboundRule: Rule = {
  id: 'sequential-outbound',
  category: 'dependencies',
  detect(context): Finding[] {
    const minSample = context.config.rules['sequential-outbound']?.minimumSampleSize ?? 3
    const minDuration = context.config.thresholds.sequentialOutboundMinMs
    const byParent = childrenByParent(context.childSpans)
    const spansById = new Map(context.spans.map((span) => [span.id, span]))
    const affectedByRoute = new Map<string, { spans: RequestSpan[]; serialMs: number; count: number }>()
    for (const [parentSpanId, children] of byParent) {
      const parent = spansById.get(parentSpanId)
      if (parent === undefined || parent.routePattern === null) continue
      const fetches = nonOverlappingFetches(children, minDuration)
      if (fetches.length < 2) continue
      const serialMs = fetches.reduce((sum, fetch) => sum + fetch.timing.duration, 0)
      const key = `${parent.method} ${parent.routePattern}`
      const entry = affectedByRoute.get(key)
      if (entry === undefined) affectedByRoute.set(key, { spans: [parent], serialMs, count: fetches.length })
      else {
        entry.spans.push(parent)
        entry.serialMs = Math.max(entry.serialMs, serialMs)
        entry.count = Math.max(entry.count, fetches.length)
      }
    }
    const findings: Finding[] = []
    for (const [, entry] of affectedByRoute) {
      if (entry.spans.length < minSample) continue
      const parent = entry.spans[0]!
      const routePattern = parent.routePattern ?? '(unmatched)'
      findings.push({
        ruleId: 'sequential-outbound',
        category: 'dependencies',
        severity: 'warning',
        title: `Sequential outbound calls on ${parent.method} ${routePattern}`,
        whatAndWhy: 'This route makes independent outbound calls one after another, so their durations add up instead of overlapping.',
        impact: {
          metric: `serialFetches=${entry.count}`,
          humanized: `${entry.count} outbound calls run one after another (~${humanizeMs(entry.serialMs)} serial); running them together could cut this`
        },
        scope: { level: 'route', routePattern },
        evidence: { spanIds: entry.spans.slice(0, 10).map((span) => span.id), deepLink: '#/inspector' },
        fix: resolveFix('sequential-outbound', parent.framework, { routePattern }),
        sampleSize: entry.spans.length
      })
    }
    return findings
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @apiscope/advisor test test/rules/sequential-outbound.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/advisor/src/rules/sequential-outbound.ts packages/advisor/test/rules/sequential-outbound.test.ts
git commit -m "$(cat <<'EOF'
feat(advisor): sequential-outbound rule

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Rule — slow dependency / slow query

**Files:**
- Create: `packages/advisor/src/rules/slow-dependency.ts`
- Test: `packages/advisor/test/rules/slow-dependency.test.ts`

**Interfaces:**
- Consumes: `Rule`, child spans, threshold `slowDependencyShare`, `resolveFix`, `humanizeMs`, `formatPercent`, `normalizeStatement`.
- Produces: `export const slowDependencyRule: Rule` with `id: 'slow-dependency'`, `category: 'dependencies'`.

Detection: for each parent span with child spans, find the single child (db or fetch) with the largest `timing.duration`; if that child's duration `>= slowDependencyShare × span.timing.duration` AND the child duration is meaningful (`>= 20 ms`), the request is affected, attributed to that child's identity: for a `db` child the identity is `normalizeStatement(statement)` and `system`; for a `fetch` child the identity is its `url` host and `'http'`. Group affected requests by `route + dependency identity`. Qualify at `>= minimumSampleSize` (default 10). Emit one finding per group, `severity: 'warning'`. `impact.metric = "share=<pct>,ms=<avgChildMs>"`, `impact.humanized = "one <db|dependency> takes ~<pct> of <route>'s time (~<humanizeMs(avgChildMs)>)"`. `scope.level='route'`. `evidence.deepLink="#/inspector"`. `fix = resolveFix('slow-dependency', framework, { routePattern, system })`. `title = "Slow <dependency label> on <method> <route>"`.

- [ ] **Step 1: Write the failing test**

`packages/advisor/test/rules/slow-dependency.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { slowDependencyRule } from '../../src/rules/slow-dependency'
import { context, dbChild, fetchChild, span } from '../fixtures'

describe('slow-dependency rule', () => {
  it('fires when one db query dominates the route time', () => {
    const parents = Array.from({ length: 12 }, () =>
      span({ routePattern: '/api/report', framework: 'express', timing: { start: 0, ttfb: 5, duration: 200 } })
    )
    const childSpans = parents.map((parent) =>
      dbChild(parent.id, { statement: 'SELECT * FROM big_table WHERE x = 1', timing: { start: 0, ttfb: null, duration: 180 } })
    )
    const findings = slowDependencyRule.detect(context({ spans: parents, childSpans }))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.ruleId).toBe('slow-dependency')
    expect(findings[0]!.impact.humanized).toContain('%')
    expect(findings[0]!.fix.explanation.toLowerCase()).toMatch(/index|cache|timeout/)
  })

  it('fires for a dominating outbound fetch', () => {
    const parents = Array.from({ length: 12 }, () =>
      span({ routePattern: '/api/proxy', timing: { start: 0, ttfb: 5, duration: 200 } })
    )
    const childSpans = parents.map((parent) =>
      fetchChild(parent.id, { url: 'http://payments.internal/charge', timing: { start: 0, ttfb: 5, duration: 170 } })
    )
    const findings = slowDependencyRule.detect(context({ spans: parents, childSpans }))
    expect(findings).toHaveLength(1)
  })

  it('stays silent when no single dependency dominates', () => {
    const parents = Array.from({ length: 12 }, () => span({ routePattern: '/api/report', timing: { start: 0, ttfb: 5, duration: 200 } }))
    const childSpans = parents.map((parent) => dbChild(parent.id, { timing: { start: 0, ttfb: null, duration: 10 } }))
    expect(slowDependencyRule.detect(context({ spans: parents, childSpans }))).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @apiscope/advisor test test/rules/slow-dependency.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

Create `packages/advisor/src/rules/slow-dependency.ts`:

```ts
import type { ChildSpan, RequestSpan } from '@apiscope/core'
import type { Finding } from '../types'
import type { Rule } from '../engine'
import { resolveFix } from '../fixes'
import { formatPercent, humanizeMs, normalizeStatement } from '../util/statement'

const MINIMUM_DEPENDENCY_MS = 20

interface AffectedGroup {
  spans: RequestSpan[]
  totalChildMs: number
  totalShare: number
  label: string
  system: string
}

function dependencyIdentity(child: ChildSpan): { key: string; label: string; system: string } {
  if (child.kind === 'db') {
    const template = normalizeStatement(child.statement)
    return { key: `db::${child.system}::${template}`, label: `${child.system} query`, system: child.system }
  }
  let host = child.url
  try {
    host = new URL(child.url).host
  } catch {
    host = child.url
  }
  return { key: `fetch::${host}`, label: `call to ${host}`, system: 'http' }
}

function slowestChild(children: ChildSpan[]): ChildSpan | null {
  if (children.length === 0) return null
  return [...children].sort((left, right) => right.timing.duration - left.timing.duration)[0]!
}

function childrenByParent(childSpans: ChildSpan[]): Map<string, ChildSpan[]> {
  const map = new Map<string, ChildSpan[]>()
  for (const child of childSpans) map.set(child.parentSpanId, [...(map.get(child.parentSpanId) ?? []), child])
  return map
}

export const slowDependencyRule: Rule = {
  id: 'slow-dependency',
  category: 'dependencies',
  detect(context): Finding[] {
    const minSample = context.config.rules['slow-dependency']?.minimumSampleSize ?? 10
    const shareThreshold = context.config.thresholds.slowDependencyShare
    const byParent = childrenByParent(context.childSpans)
    const spansById = new Map(context.spans.map((span) => [span.id, span]))
    const groups = new Map<string, AffectedGroup>()
    for (const [parentSpanId, children] of byParent) {
      const parent = spansById.get(parentSpanId)
      if (parent === undefined || parent.routePattern === null || parent.timing.duration <= 0) continue
      const child = slowestChild(children)
      if (child === null || child.timing.duration < MINIMUM_DEPENDENCY_MS) continue
      const share = child.timing.duration / parent.timing.duration
      if (share < shareThreshold) continue
      const identity = dependencyIdentity(child)
      const key = `${parent.method} ${parent.routePattern}::${identity.key}`
      const entry = groups.get(key)
      if (entry === undefined) {
        groups.set(key, { spans: [parent], totalChildMs: child.timing.duration, totalShare: share, label: identity.label, system: identity.system })
      } else {
        entry.spans.push(parent)
        entry.totalChildMs += child.timing.duration
        entry.totalShare += share
      }
    }
    const findings: Finding[] = []
    for (const [, entry] of groups) {
      if (entry.spans.length < minSample) continue
      const parent = entry.spans[0]!
      const routePattern = parent.routePattern ?? '(unmatched)'
      const avgChildMs = entry.totalChildMs / entry.spans.length
      const avgShare = entry.totalShare / entry.spans.length
      findings.push({
        ruleId: 'slow-dependency',
        category: 'dependencies',
        severity: 'warning',
        title: `Slow ${entry.label} on ${parent.method} ${routePattern}`,
        whatAndWhy: 'A single query or outbound call takes the majority of this route\'s time, so it is the one thing worth optimizing first.',
        impact: {
          metric: `share=${formatPercent(avgShare)},ms=${Math.round(avgChildMs)}`,
          humanized: `one ${entry.label} takes ~${formatPercent(avgShare)} of ${routePattern}'s time (~${humanizeMs(avgChildMs)})`
        },
        scope: { level: 'route', routePattern },
        evidence: { spanIds: entry.spans.slice(0, 10).map((span) => span.id), deepLink: '#/inspector' },
        fix: resolveFix('slow-dependency', parent.framework, { routePattern, system: entry.system }),
        sampleSize: entry.spans.length
      })
    }
    return findings
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @apiscope/advisor test test/rules/slow-dependency.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/advisor/src/rules/slow-dependency.ts packages/advisor/test/rules/slow-dependency.test.ts
git commit -m "$(cat <<'EOF'
feat(advisor): slow-dependency rule

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Rule — error hotspot

**Files:**
- Create: `packages/advisor/src/rules/error-hotspot.ts`
- Test: `packages/advisor/test/rules/error-hotspot.test.ts`

**Interfaces:**
- Consumes: `Rule`, `AdvisorRouteStats`, thresholds `errorRateWarning`/`errorRateCritical`, `formatPercent`, `resolveFix`.
- Produces: `export const errorHotspotRule: Rule` with `id: 'error-hotspot'`, `category: 'reliability'`.

Detection: `routeStats.errorCount` already counts `statusCode >= 500` (server errors). For each `stats` with `count >= minimumSampleSize` (default 20): compute `serverErrorRate = errorCount / count`. Also compute a `clientErrorRate` from `context.spans` for that route (`statusCode >= 400 && < 500`) since routeStats doesn't carry 4xx. Fire when `serverErrorRate >= errorRateWarning` OR `clientErrorRate >= max(0.25, errorRateWarning*10)` (a heavy clustered-4xx rate). Severity: `'critical'` when `serverErrorRate >= errorRateCritical`, else `'warning'`. Use the server rate for the headline when it triggers, else the client rate. `impact.metric = "errorRate=<pct>"`, `impact.humanized = "<pct> of requests to <route> return <5xx|4xx> errors"`. `scope.level='route'`. `evidence.spanIds` = up to 10 span ids on the route with `statusCode >= 400`. `deepLink = "#/inspector"`. `fix = resolveFix('error-hotspot', framework, { routePattern })`. `title = "Errors on <method> <route>"`.

- [ ] **Step 1: Write the failing test**

`packages/advisor/test/rules/error-hotspot.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { errorHotspotRule } from '../../src/rules/error-hotspot'
import { context, routeStat, span } from '../fixtures'

describe('error-hotspot rule', () => {
  it('warns on an elevated 5xx rate', () => {
    const stats = [routeStat({ routePattern: '/api/checkout', count: 100, errorCount: 8 })]
    const spans = Array.from({ length: 8 }, () => span({ routePattern: '/api/checkout', statusCode: 500 }))
    const findings = errorHotspotRule.detect(context({ spans, routeStats: stats }))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.ruleId).toBe('error-hotspot')
    expect(findings[0]!.severity).toBe('warning')
    expect(findings[0]!.impact.metric).toBe('errorRate=8%')
  })

  it('escalates to critical past the high bound', () => {
    const stats = [routeStat({ routePattern: '/api/checkout', count: 100, errorCount: 20 })]
    const spans = Array.from({ length: 20 }, () => span({ routePattern: '/api/checkout', statusCode: 503 }))
    expect(errorHotspotRule.detect(context({ spans, routeStats: stats }))[0]!.severity).toBe('critical')
  })

  it('fires on a heavy clustered-4xx rate even with no 5xx', () => {
    const stats = [routeStat({ routePattern: '/api/login', count: 100, errorCount: 0 })]
    const spans = Array.from({ length: 40 }, () => span({ routePattern: '/api/login', statusCode: 401 }))
    const findings = errorHotspotRule.detect(context({ spans, routeStats: stats }))
    expect(findings).toHaveLength(1)
    expect(findings[0]!.impact.humanized).toContain('4xx')
  })

  it('stays silent at a healthy error rate', () => {
    const stats = [routeStat({ routePattern: '/api/ok', count: 100, errorCount: 1 })]
    const spans = Array.from({ length: 1 }, () => span({ routePattern: '/api/ok', statusCode: 500 }))
    expect(errorHotspotRule.detect(context({ spans, routeStats: stats }))).toHaveLength(0)
  })

  it('stays silent below the minimum sample size', () => {
    const stats = [routeStat({ routePattern: '/api/checkout', count: 5, errorCount: 3 })]
    expect(errorHotspotRule.detect(context({ spans: [], routeStats: stats }))).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @apiscope/advisor test test/rules/error-hotspot.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

Create `packages/advisor/src/rules/error-hotspot.ts`:

```ts
import type { RequestSpan } from '@apiscope/core'
import type { Finding, FindingSeverity } from '../types'
import type { Rule } from '../engine'
import { resolveFix } from '../fixes'
import { formatPercent } from '../util/statement'

export const errorHotspotRule: Rule = {
  id: 'error-hotspot',
  category: 'reliability',
  detect(context): Finding[] {
    const minSample = context.config.rules['error-hotspot']?.minimumSampleSize ?? 20
    const warnRate = context.config.thresholds.errorRateWarning
    const criticalRate = context.config.thresholds.errorRateCritical
    const clientRateFloor = Math.max(0.25, warnRate * 10)
    const fallbackFramework = context.apps[0]?.framework ?? 'unknown'
    const findings: Finding[] = []
    for (const stats of context.routeStats) {
      if (stats.count < minSample) continue
      const routeSpans = context.spans.filter(
        (span) => span.routePattern === stats.routePattern && span.method === stats.method
      )
      const clientErrors = routeSpans.filter((span) => span.statusCode >= 400 && span.statusCode < 500).length
      const serverErrorRate = stats.errorCount / stats.count
      const clientErrorRate = routeSpans.length === 0 ? 0 : clientErrors / routeSpans.length
      const serverTriggered = serverErrorRate >= warnRate
      const clientTriggered = clientErrorRate >= clientRateFloor
      if (!serverTriggered && !clientTriggered) continue
      const rate = serverTriggered ? serverErrorRate : clientErrorRate
      const family = serverTriggered ? '5xx' : '4xx'
      const severity: FindingSeverity = serverTriggered && serverErrorRate >= criticalRate ? 'critical' : 'warning'
      const routePattern = stats.routePattern ?? '(unmatched)'
      const failing = routeSpans.filter((span) => span.statusCode >= 400)
      findings.push({
        ruleId: 'error-hotspot',
        category: 'reliability',
        severity,
        title: `Errors on ${stats.method} ${routePattern}`,
        whatAndWhy: `This route returns ${family} errors more often than expected, so a real share of requests are failing.`,
        impact: { metric: `errorRate=${formatPercent(rate)}`, humanized: `${formatPercent(rate)} of requests to ${routePattern} return ${family} errors` },
        scope: { level: 'route', routePattern },
        evidence: { spanIds: failing.slice(0, 10).map((span) => span.id), deepLink: '#/inspector' },
        fix: resolveFix('error-hotspot', routeSpans[0]?.framework ?? fallbackFramework, { routePattern }),
        sampleSize: stats.count
      })
    }
    return findings
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @apiscope/advisor test test/rules/error-hotspot.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/advisor/src/rules/error-hotspot.ts packages/advisor/test/rules/error-hotspot.test.ts
git commit -m "$(cat <<'EOF'
feat(advisor): error-hotspot rule

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Rule registry + `analyze()` public entry

**Files:**
- Create: `packages/advisor/src/rules/index.ts`
- Create: `packages/advisor/src/analyze.ts`
- Modify: `packages/advisor/src/index.ts` (add `export { analyze } from './analyze'` and `export { ALL_RULES } from './rules'`)
- Test: `packages/advisor/test/analyze.test.ts`

**Interfaces:**
- Consumes: every rule from Tasks 6–15; `runRules` (Task 5); `AdvisorContext`, `AnalyzeResult`.
- Produces:

```ts
export const ALL_RULES: Rule[]
export function analyze(context: AdvisorContext): AnalyzeResult
```

`analyze` returns `{ findings: [], rulesRun: [], insufficientData: true }` immediately when `context.config.enabled === false`. Otherwise it delegates to `runRules(ALL_RULES, context)`.

- [ ] **Step 1: Write the failing test**

`packages/advisor/test/analyze.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { analyze } from '../src/analyze'
import { context, dbChild, routeStat, span } from './fixtures'
import { resolveAdvisorConfig } from '../src/config'

describe('analyze', () => {
  it('runs every rule and returns a ranked mixed set of findings', () => {
    const jsonBig = { headers: { 'content-type': 'application/json', 'content-length': '30000' }, truncated: false, redactedHeaders: [] }
    const spans = [
      ...Array.from({ length: 40 }, () => span({ routePattern: '/api/report', framework: 'express', response: jsonBig, timing: { start: 0, ttfb: 5, duration: 200 } })),
      ...Array.from({ length: 8 }, () => span({ routePattern: '/api/checkout', statusCode: 500 }))
    ]
    const childSpans = spans
      .filter((entry) => entry.routePattern === '/api/report')
      .flatMap((parent) => Array.from({ length: 6 }, (_unused, index) => dbChild(parent.id, { statement: `SELECT * FROM x WHERE id = ${index}` })))
    const routeStats = [
      routeStat({ routePattern: '/api/report', p50: 40, p95: 700, p99: 900, count: 40 }),
      routeStat({ routePattern: '/api/checkout', count: 100, errorCount: 8, p95: 50 })
    ]
    const result = analyze(context({ spans, childSpans, routeStats }))
    const ruleIds = new Set(result.findings.map((finding) => finding.ruleId))
    expect(ruleIds.has('uncompressed-responses')).toBe(true)
    expect(ruleIds.has('slow-route')).toBe(true)
    expect(ruleIds.has('n-plus-one')).toBe(true)
    expect(ruleIds.has('error-hotspot')).toBe(true)
    expect(result.rulesRun.length).toBe(10)
    expect(result.insufficientData).toBe(false)
  })

  it('returns nothing when disabled', () => {
    const result = analyze(context({ spans: [span(), span()], config: resolveAdvisorConfig({ enabled: false }) }))
    expect(result.findings).toHaveLength(0)
    expect(result.rulesRun).toHaveLength(0)
    expect(result.insufficientData).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @apiscope/advisor test test/analyze.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Write minimal implementation**

Create `packages/advisor/src/rules/index.ts`:

```ts
import type { Rule } from '../engine'
import { uncompressedResponsesRule } from './uncompressed'
import { missingCacheHeadersRule } from './missing-cache'
import { oversizedPayloadRule } from './oversized-payload'
import { slowRouteRule } from './slow-route'
import { whereTimeGoesRule } from './where-time-goes'
import { unstableLatencyRule } from './unstable-latency'
import { nPlusOneRule } from './n-plus-one'
import { sequentialOutboundRule } from './sequential-outbound'
import { slowDependencyRule } from './slow-dependency'
import { errorHotspotRule } from './error-hotspot'

export const ALL_RULES: Rule[] = [
  uncompressedResponsesRule,
  missingCacheHeadersRule,
  oversizedPayloadRule,
  slowRouteRule,
  whereTimeGoesRule,
  unstableLatencyRule,
  nPlusOneRule,
  sequentialOutboundRule,
  slowDependencyRule,
  errorHotspotRule
]
```

Create `packages/advisor/src/analyze.ts`:

```ts
import type { AdvisorContext, AnalyzeResult } from './types'
import { runRules } from './engine'
import { ALL_RULES } from './rules'

export function analyze(context: AdvisorContext): AnalyzeResult {
  if (!context.config.enabled) return { findings: [], rulesRun: [], insufficientData: true }
  return runRules(ALL_RULES, context)
}
```

Add to `packages/advisor/src/index.ts`: `export { analyze } from './analyze'` and `export { ALL_RULES } from './rules'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @apiscope/advisor test`
Expected: PASS (all advisor tests green).

- [ ] **Step 5: Verify build + typecheck**

Run: `pnpm --filter @apiscope/advisor build && pnpm --filter @apiscope/advisor typecheck`
Expected: ESM + CJS + DTS emitted clean; typecheck passes with no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/advisor/src/rules/index.ts packages/advisor/src/analyze.ts packages/advisor/src/index.ts packages/advisor/test/analyze.test.ts
git commit -m "$(cat <<'EOF'
feat(advisor): rule registry and analyze entry point

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2 — collector `GET /api/insights` + `advisor` config block

Deterministic backend. **Write COMPLETE code** — the context builder, the endpoint handler, the config wiring, and integration tests over a seeded store (including the rule-throws degradation path and the `insufficientData` shape).

### Task 17: Context builder + `GET /api/insights` endpoint

**Files:**
- Create: `packages/collector/src/insights.ts`
- Modify: `packages/collector/src/server.ts` (add `advisor?` to `CollectorOptions`)
- Modify: `packages/collector/src/index.ts` (register `GET /api/insights`; thread `options.advisor`)
- Modify: `packages/collector/package.json` (add `@apiscope/advisor: workspace:*`)
- Test: `packages/collector/test/insights-api.test.ts`

**Interfaces:**
- Consumes (from `@apiscope/advisor`): `analyze`, `resolveAdvisorConfig`, types `AdvisorContext`, `AdvisorConfigInput`, `AnalyzeResult`. Consumes the collector's own `SpanStore` (async): `recentSpans(limit)`, `routeStats()`, `spanById(id)`, `listRoutes()`.
- Produces:

```ts
export const INSIGHTS_RECENT_SPAN_WINDOW = 2000
export function buildAdvisorContext(store: SpanStore, config: ResolvedAdvisorConfig): Promise<AdvisorContext>
export function resolveAdvisorConfigFromMeta(meta: unknown): ResolvedAdvisorConfig
```

`buildAdvisorContext` reads `recentSpans(INSIGHTS_RECENT_SPAN_WINDOW)`, collects their child spans via `spanById` for each span that has any (bounded to the window — one pass), reads `routeStats()`, derives `apps` from `listRoutes()` joined with the framework observed on spans (map each `appName` to the most common `framework` among spans of routes registered to that app; fall back to the first span's framework, else `'unknown'`). Maps everything to the advisor's input shapes. `resolveAdvisorConfigFromMeta` reads `meta.advisor` when `meta` is an object and passes it through `resolveAdvisorConfig`; on any shape mismatch it returns `resolveAdvisorConfig()` (defaults).

The endpoint `GET /api/insights` returns `200` with the `AnalyzeResult` plus an `advisorEnabled` boolean and the `windowSampleSize`:

```ts
{ findings, rulesRun, insufficientData, advisorEnabled, windowSampleSize }
```

On a thrown error inside `buildAdvisorContext`/`analyze`, the handler catches and returns `200` with `{ findings: [], rulesRun: [], insufficientData: false, advisorEnabled: true, error: 'analysis-failed', windowSampleSize: 0 }` (never a 500 — the dashboard shows a graceful "couldn't analyze" state).

- [ ] **Step 1: Write the failing test**

`packages/collector/test/insights-api.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import type { DbChildSpan, RequestSpan } from '@apiscope/core'
import { createCollector, type Collector } from '../src/index'

let collector: Collector

afterEach(async () => {
  await collector.close()
})

function jsonBig(): RequestSpan['response'] {
  return { headers: { 'content-type': 'application/json', 'content-length': '30000' }, truncated: false, redactedHeaders: [] }
}

async function seed(collector: Collector) {
  await collector.store.replaceRoutes('demo', [{ method: 'GET', pattern: '/api/report' }])
  const spans: RequestSpan[] = Array.from({ length: 40 }, (_unused, index) => ({
    id: `s-${index}`,
    traceId: `t-${index}`,
    method: 'GET',
    routePattern: '/api/report',
    actualPath: '/api/report',
    statusCode: 200,
    timing: { start: 0, ttfb: 5, duration: 60 },
    framework: 'express',
    runtime: 'node',
    response: jsonBig()
  }))
  await collector.store.insertBatch('demo', { spans, childSpans: [] })
}

describe('GET /api/insights', () => {
  it('returns findings over a seeded store', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0 })
    const { port } = await collector.listen()
    await seed(collector)
    const body = (await (await fetch(`http://127.0.0.1:${port}/api/insights`)).json()) as {
      findings: Array<{ ruleId: string }>
      rulesRun: string[]
      insufficientData: boolean
      advisorEnabled: boolean
      windowSampleSize: number
    }
    expect(body.advisorEnabled).toBe(true)
    expect(body.insufficientData).toBe(false)
    expect(body.windowSampleSize).toBe(40)
    expect(body.findings.some((finding) => finding.ruleId === 'uncompressed-responses')).toBe(true)
  })

  it('reports insufficientData below the overall minimum sample size', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0 })
    const { port } = await collector.listen()
    await collector.store.insertBatch('demo', {
      spans: [
        { id: 's1', traceId: 't1', method: 'GET', routePattern: '/x', actualPath: '/x', statusCode: 200, timing: { start: 0, ttfb: 1, duration: 5 }, framework: 'express', runtime: 'node' }
      ],
      childSpans: []
    })
    const body = (await (await fetch(`http://127.0.0.1:${port}/api/insights`)).json()) as { insufficientData: boolean }
    expect(body.insufficientData).toBe(true)
  })

  it('can be disabled via the advisor config option', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0, advisor: { enabled: false } })
    const { port } = await collector.listen()
    await seed(collector)
    const body = (await (await fetch(`http://127.0.0.1:${port}/api/insights`)).json()) as { advisorEnabled: boolean; findings: unknown[] }
    expect(body.advisorEnabled).toBe(false)
    expect(body.findings).toHaveLength(0)
  })

  it('honors a lowered slow-route threshold from advisor config', async () => {
    collector = createCollector({ dbPath: ':memory:', port: 0, advisor: { thresholds: { slowRouteP95Ms: 10 }, rules: { 'slow-route': { minimumSampleSize: 5 } } } })
    const { port } = await collector.listen()
    await seed(collector)
    const body = (await (await fetch(`http://127.0.0.1:${port}/api/insights`)).json()) as { findings: Array<{ ruleId: string }> }
    expect(body.findings.some((finding) => finding.ruleId === 'slow-route')).toBe(true)
  })
})
```

Also add a degradation test that forces `analyze` to throw by seeding a corrupt store double: since forcing an internal throw requires a store stub, instead assert the handler's resilience by passing a custom `store` whose `routeStats` rejects. Add this test to the same file:

```ts
import type { SpanStore } from '../src/store-interface'

it('degrades to an empty analysis when the store throws', async () => {
  const throwingStore = {
    recoveredFromCorruption: false,
    async insertBatch() {},
    async replaceRoutes() {},
    async listRoutes() { return [] },
    async recentSpans() { return [] },
    async spansByLoadRun() { return [] },
    async spanById() { return null },
    async routeStats(): Promise<never> { throw new Error('store down') },
    async insertLoadRun() {},
    async listLoadRuns() { return [] },
    async loadRunById() { return null },
    async init() {},
    async close() {}
  } satisfies SpanStore
  collector = createCollector({ dbPath: ':memory:', port: 0, store: throwingStore })
  const { port } = await collector.listen()
  const body = (await (await fetch(`http://127.0.0.1:${port}/api/insights`)).json()) as { error?: string; findings: unknown[]; advisorEnabled: boolean }
  expect(body.error).toBe('analysis-failed')
  expect(body.findings).toHaveLength(0)
  expect(body.advisorEnabled).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @apiscope/collector test test/insights-api.test.ts`
Expected: FAIL — `advisor` option not accepted / `/api/insights` returns 404 / `@apiscope/advisor` unresolved.

- [ ] **Step 3: Write minimal implementation**

Add `@apiscope/advisor: workspace:*` to `packages/collector/package.json` dependencies, then `pnpm install`.

Create `packages/collector/src/insights.ts`:

```ts
import {
  analyze,
  resolveAdvisorConfig,
  type AdvisorApp,
  type AdvisorConfigInput,
  type AdvisorContext,
  type AdvisorRouteStats,
  type AnalyzeResult,
  type ResolvedAdvisorConfig
} from '@apiscope/advisor'
import type { ChildSpan, RequestSpan } from '@apiscope/core'
import type { SpanStore } from './store-interface'

export const INSIGHTS_RECENT_SPAN_WINDOW = 2000

export function resolveAdvisorConfigFromMeta(meta: unknown): ResolvedAdvisorConfig {
  if (meta !== null && typeof meta === 'object' && 'advisor' in meta) {
    const advisor = (meta as { advisor?: AdvisorConfigInput }).advisor
    return resolveAdvisorConfig(advisor)
  }
  return resolveAdvisorConfig()
}

function mostCommonFramework(spans: RequestSpan[]): string {
  const counts = new Map<string, number>()
  for (const span of spans) counts.set(span.framework, (counts.get(span.framework) ?? 0) + 1)
  let best = 'unknown'
  let bestCount = 0
  for (const [framework, count] of counts) {
    if (count > bestCount) {
      best = framework
      bestCount = count
    }
  }
  return best
}

export async function buildAdvisorContext(store: SpanStore, config: ResolvedAdvisorConfig): Promise<AdvisorContext> {
  const spans = await store.recentSpans(INSIGHTS_RECENT_SPAN_WINDOW)
  const childSpans: ChildSpan[] = []
  for (const span of spans) {
    const detail = await store.spanById(span.id)
    if (detail !== null && detail.childSpans.length > 0) childSpans.push(...detail.childSpans)
  }
  const rawStats = await store.routeStats()
  const routeStats: AdvisorRouteStats[] = rawStats.map((stats) => ({
    routePattern: stats.routePattern,
    method: stats.method,
    count: stats.count,
    errorCount: stats.errorCount,
    p50: stats.p50,
    p95: stats.p95,
    p99: stats.p99
  }))
  const registry = await store.listRoutes()
  const appNames = new Set(registry.map((entry) => entry.appName))
  const apps: AdvisorApp[] = [...appNames].map((name) => ({ name, framework: mostCommonFramework(spans) }))
  if (apps.length === 0 && spans.length > 0) apps.push({ name: 'app', framework: mostCommonFramework(spans) })
  return { spans, childSpans, routeStats, apps, config }
}

export async function computeInsights(store: SpanStore, config: ResolvedAdvisorConfig): Promise<AnalyzeResult & { windowSampleSize: number }> {
  const context = await buildAdvisorContext(store, config)
  const result = analyze(context)
  return { ...result, windowSampleSize: context.spans.length }
}
```

In `packages/collector/src/server.ts`, add to `CollectorOptions`:

```ts
import type { AdvisorConfigInput } from '@apiscope/advisor'
// ... inside CollectorOptions:
  advisor?: AdvisorConfigInput
```

In `packages/collector/src/index.ts`:
- Import: `import { computeInsights, resolveAdvisorConfigFromMeta } from './insights'` and `import { resolveAdvisorConfig } from '@apiscope/advisor'`.
- After the store/hub/sampler setup (near line 183), resolve the advisor config once: `const advisorConfig = options.advisor !== undefined ? resolveAdvisorConfig(options.advisor) : resolveAdvisorConfigFromMeta(options.meta)`.
- Register the route alongside the other `routes.set(...)` calls:

```ts
routes.set('GET /api/insights', async (request, response) => {
  try {
    const result = await computeInsights(store, advisorConfig)
    sendJson(response, 200, {
      findings: result.findings,
      rulesRun: result.rulesRun,
      insufficientData: result.insufficientData,
      advisorEnabled: advisorConfig.enabled,
      windowSampleSize: result.windowSampleSize
    })
  } catch {
    sendJson(response, 200, {
      findings: [],
      rulesRun: [],
      insufficientData: false,
      advisorEnabled: advisorConfig.enabled,
      error: 'analysis-failed',
      windowSampleSize: 0
    })
  }
})
```

Note: `options.advisor` takes precedence over `options.meta.advisor`; when the CLI supplies `meta: config`, `resolveAdvisorConfigFromMeta` picks up `config.advisor` for free even if `options.advisor` is not separately passed.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @apiscope/collector test test/insights-api.test.ts`
Expected: PASS (all cases including the disabled, insufficient-data, lowered-threshold, and store-throws degradation).

- [ ] **Step 5: Commit**

```bash
git add packages/collector/src/insights.ts packages/collector/src/server.ts packages/collector/src/index.ts packages/collector/package.json packages/collector/test/insights-api.test.ts pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(collector): serve GET /api/insights from the advisor

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 18: CLI `advisor` config block

**Files:**
- Modify: `packages/cli/src/config.ts` (add `advisor` to `configSchema` and `ApiscopeConfig`)
- Test: `packages/cli/test/config.test.ts` (validate the advisor block)

**Interfaces:**
- Consumes: the existing `configSchema`/`ApiscopeConfig` and `loadConfig`.
- Produces: `ApiscopeConfig.advisor?: AdvisorConfigShape` where:

```ts
advisor?: {
  enabled?: boolean
  minimumOverallSampleSize?: number
  thresholds?: {
    compressibleMinBytes?: number
    oversizedPayloadBytes?: number
    slowRouteP95Ms?: number
    criticalRouteP95Ms?: number
    unstableLatencyRatio?: number
    errorRateWarning?: number
    errorRateCritical?: number
    slowDependencyShare?: number
    sequentialOutboundMinMs?: number
  }
  rules?: Record<string, { minimumSampleSize?: number; enabled?: boolean }>
}
```

The config already reaches the collector via `meta: config` (cli.ts line 253), so `resolveAdvisorConfigFromMeta` will pick up `config.advisor` with no additional wiring. This task only widens the schema so a config file carrying an `advisor` block validates instead of being rejected/stripped.

- [ ] **Step 1: Write the failing test**

Add to `packages/cli/test/config.test.ts` (mirror the file's existing `loadConfig` test style — write a temp config file, load it, assert it parses; the existing tests show the exact harness):

```ts
it('accepts an advisor block with thresholds and rule overrides', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'apiscope-advisor-'))
  const configPath = join(dir, 'apiscope.config.ts')
  await writeFile(
    configPath,
    `import { defineConfig } from '../../src/config'
export default defineConfig({
  advisor: {
    enabled: true,
    minimumOverallSampleSize: 30,
    thresholds: { slowRouteP95Ms: 300, errorRateCritical: 0.2 },
    rules: { 'slow-route': { minimumSampleSize: 50, enabled: false } }
  }
})
`
  )
  const config = await loadConfig(configPath)
  expect(config.advisor?.thresholds?.slowRouteP95Ms).toBe(300)
  expect(config.advisor?.rules?.['slow-route']?.enabled).toBe(false)
})

it('rejects an advisor threshold of the wrong type', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'apiscope-advisor-bad-'))
  const configPath = join(dir, 'apiscope.config.ts')
  await writeFile(
    configPath,
    `export default { advisor: { thresholds: { slowRouteP95Ms: 'fast' } } }
`
  )
  await expect(loadConfig(configPath)).rejects.toThrow(/advisor/)
})
```

If `mkdtemp`/`writeFile`/`join`/`tmpdir` are not already imported in this test file, add them from `node:fs/promises`, `node:path`, and `node:os` matching the file's existing imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @apiscope/cli test test/config.test.ts`
Expected: FAIL — the advisor block is stripped (so `config.advisor` is undefined) and/or the bad-type case does not throw.

- [ ] **Step 3: Write minimal implementation**

In `packages/cli/src/config.ts`, add before `configSchema`:

```ts
const advisorSchema = z
  .object({
    enabled: z.boolean().optional(),
    minimumOverallSampleSize: z.number().int().positive().optional(),
    thresholds: z
      .object({
        compressibleMinBytes: z.number().positive().optional(),
        oversizedPayloadBytes: z.number().positive().optional(),
        slowRouteP95Ms: z.number().positive().optional(),
        criticalRouteP95Ms: z.number().positive().optional(),
        unstableLatencyRatio: z.number().positive().optional(),
        errorRateWarning: z.number().min(0).max(1).optional(),
        errorRateCritical: z.number().min(0).max(1).optional(),
        slowDependencyShare: z.number().min(0).max(1).optional(),
        sequentialOutboundMinMs: z.number().nonnegative().optional()
      })
      .optional(),
    rules: z
      .record(z.string(), z.object({ minimumSampleSize: z.number().int().positive().optional(), enabled: z.boolean().optional() }))
      .optional()
  })
  .optional()
```

Add `advisor: advisorSchema` as a key in `configSchema` (the `z.object({...})` at line 127). Add the `advisor?` field to the `ApiscopeConfig` interface (line 202) using the shape from **Produces** above.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @apiscope/cli test test/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/config.ts packages/cli/test/config.test.ts
git commit -m "$(cat <<'EOF'
feat(cli): validate the advisor config block

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 19: Phase 1+2 full-pipeline verification

- [ ] **Step 1: Build, typecheck, and test the whole workspace**

Run: `pnpm build && pnpm typecheck && APISCOPE_SKIP_CONTAINERS=true pnpm test`
Expected: all packages green, including the new `@apiscope/advisor` and the collector's `insights-api` tests. The collector test script is `vitest run --no-file-parallelism` — keep it; do not change it.

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: verify advisor package and insights endpoint

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — Dashboard Insights hub

UI craft. For every task here: the **deterministic parts are specified in full** (types, API client, store slice, hash route, prop contracts, the exact states, and the Playwright test that gates the deliverable). The **visual/motion/responsive craft is explicitly delegated** to the `anthropic-skills:frontend-design`, `design-taste-frontend`, and `emil-design-eng` skills. Do **not** pre-bake exact JSX/CSS for the look — build to the contracts and tests, and use the skills for the appearance. Each task states its acceptance criteria.

> **Instrument DNA (applies to every Phase 3/4 UI task):** keep the dark base, IBM Plex Sans + Mono, tabular numerals, and the 2xx–5xx status colors for *data*. The new advisory severity scale (Task 24 token work) is for *guidance* and must be visually distinct from the data-status colors. Accent `#FF5C00` is interaction-only, never encodes data. All motion is gated on `prefers-reduced-motion`.

### Task 20: Dashboard insights types, API client, and store slice

**Files:**
- Modify: `packages/dashboard/src/lib/types.ts` (add `Finding` + sub-types + `InsightsResponse`)
- Modify: `packages/dashboard/src/lib/api.ts` (add `insights()`)
- Modify: `packages/dashboard/src/lib/store.ts` (add the insights slice)
- Test: `packages/dashboard/e2e/dashboard.spec.ts` is extended later (Task 23). This task is unit-contract-only; its gate is `typecheck` + the store behaving as specified, verified by the Task 23 e2e once the view exists. To keep this task independently checkable, add a **tiny** store unit check is not part of the dashboard's test runner (dashboard uses Playwright only). Therefore this task's verification is `pnpm --filter @apiscope/dashboard typecheck` plus a manual store assertion via a throwaway `node -e` against the built types is not practical; instead gate on typecheck and defer behavior verification to Task 23.

**Interfaces:**
- Produces (in `types.ts`, mirroring the advisor's public JSON exactly):

```ts
export type FindingCategory =
  | 'performance' | 'payload' | 'caching' | 'database' | 'dependencies' | 'reliability' | 'code'
export type FindingSeverity = 'critical' | 'warning' | 'advisory'

export interface Finding {
  ruleId: string
  category: FindingCategory
  severity: FindingSeverity
  title: string
  whatAndWhy: string
  impact: { metric: string; humanized: string }
  scope: { level: 'global' | 'route' | 'app'; routePattern?: string; appName?: string }
  evidence: { spanIds: string[]; deepLink: string }
  fix: { framework: string; explanation: string; codeSnippet?: string; docsUrl?: string }
  sampleSize: number
}

export interface InsightsResponse {
  findings: Finding[]
  rulesRun: string[]
  insufficientData: boolean
  advisorEnabled: boolean
  windowSampleSize: number
  error?: string
}
```

- Produces (in `api.ts`): `insights: () => getJson<InsightsResponse>('/api/insights')` added to the `api` object.
- Produces (in `store.ts`): an insights slice on `DashboardState`:

```ts
insights: InsightsResponse | null
insightsLoading: boolean
insightsError: string | null
insightsDismissed: string[]
insightsGrouping: 'severity' | 'category' | 'route'
setInsights(response: InsightsResponse): void
setInsightsLoading(loading: boolean): void
setInsightsError(error: string | null): void
dismissFinding(ruleId: string, routePattern: string | undefined): void
restoreDismissed(): void
setInsightsGrouping(grouping: 'severity' | 'category' | 'route'): void
```

Dismissal is session-scoped and keyed by `` `${ruleId}::${routePattern ?? ''}` ``. `restoreDismissed` clears the dismissed list. A finding is considered dismissed when its key is in `insightsDismissed`.

- [ ] **Step 1: Write the failing check (typecheck-driven)**

Because the dashboard has no unit-test runner (Playwright only), drive this task by writing the consuming code in the store/types/api first as specified, then rely on `typecheck`. Before implementing, confirm it fails: add the `insights()` call to `api.ts` referencing the not-yet-defined `InsightsResponse` type.

Run: `pnpm --filter @apiscope/dashboard typecheck`
Expected: FAIL — `InsightsResponse` not found.

- [ ] **Step 2: Implement types**

Add the `Finding`/`FindingCategory`/`FindingSeverity`/`InsightsResponse` block to `packages/dashboard/src/lib/types.ts`.

- [ ] **Step 3: Implement the API client call**

Add to the `api` object in `packages/dashboard/src/lib/api.ts`:

```ts
insights: () => getJson<InsightsResponse>('/api/insights'),
```

Import `InsightsResponse` from `./types` in `api.ts`.

- [ ] **Step 4: Implement the store slice**

Add the fields and actions above to `DashboardState` and the store body in `packages/dashboard/src/lib/store.ts`:

```ts
insights: null,
insightsLoading: false,
insightsError: null,
insightsDismissed: [],
insightsGrouping: 'severity',
setInsights: (response) => set({ insights: response, insightsError: null, insightsLoading: false }),
setInsightsLoading: (loading) => set({ insightsLoading: loading }),
setInsightsError: (error) => set({ insightsError: error, insightsLoading: false }),
dismissFinding: (ruleId, routePattern) =>
  set((state) => {
    const key = `${ruleId}::${routePattern ?? ''}`
    return state.insightsDismissed.includes(key)
      ? state
      : { insightsDismissed: [...state.insightsDismissed, key] }
  }),
restoreDismissed: () => set({ insightsDismissed: [] }),
setInsightsGrouping: (grouping) => set({ insightsGrouping: grouping }),
```

Import `InsightsResponse` into `store.ts` from `./types`.

- [ ] **Step 5: Run typecheck to verify it passes**

Run: `pnpm --filter @apiscope/dashboard typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/lib/types.ts packages/dashboard/src/lib/api.ts packages/dashboard/src/lib/store.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): insights types, api client, and store slice

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 21: FindingCard + HealthVerdict components

**Files:**
- Create: `packages/dashboard/src/components/FindingCard.tsx`
- Create: `packages/dashboard/src/components/HealthVerdict.tsx`
- Modify: `packages/dashboard/src/styles/base.css` (finding-card + verdict styles — visual craft per skills)

**Interfaces (deterministic prop contracts — these are load-bearing and must be implemented exactly):**

```ts
// FindingCard.tsx
export interface FindingCardProps {
  finding: Finding
  expanded: boolean
  onToggle(): void
  onDismiss(): void
}
export function FindingCard(props: FindingCardProps): ReactNode

// HealthVerdict.tsx
export interface HealthVerdictProps {
  findings: Finding[]        // already filtered (not dismissed)
  windowSampleSize: number
  topStats: { slowestRoute: string | null; slowestP95Ms: number | null; errorRatePct: number | null }
}
export function HealthVerdict(props: HealthVerdictProps): ReactNode
```

**Required behavior / testable states (must exist regardless of styling):**
- `FindingCard` collapsed shows: a severity chip (`data-testid="finding-severity"` with `data-severity={finding.severity}`), a category chip, the plain `finding.title` (`data-testid="finding-title"`), the one-line `finding.whatAndWhy`, and the `finding.impact.humanized` (`data-testid="finding-impact"`). The whole header is a `<button>` toggling expansion (`data-testid="finding-toggle"`), with `aria-expanded={expanded}`.
- `FindingCard` expanded additionally shows: `finding.fix.explanation`; when `finding.fix.codeSnippet` is present, a `<pre data-testid="finding-snippet">` with the snippet and a copy button (`data-testid="finding-copy"`) that writes the snippet to `navigator.clipboard` and briefly shows "copied" (`data-testid="finding-copied"` appears after click); a "show me the evidence" link (`data-testid="finding-evidence"`) whose `href` is `#${finding.evidence.deepLink}` when the deepLink starts with `/`, else `finding.evidence.deepLink`; and, when `finding.fix.docsUrl` is present, a docs link.
- A dismiss control (`data-testid="finding-dismiss"`) calls `onDismiss()`.
- `HealthVerdict` renders `data-testid="health-verdict"`. When `findings.length === 0` it reads "Looking healthy". Otherwise it reads a single confident line summarizing count + traffic share, e.g. `"${findings.length} things worth fixing"` with the total affected-traffic share beneath. The top stats (slowest route + its p95 humanized, error rate) render beneath, each framed as meaning (`data-testid="verdict-slowest"`, `data-testid="verdict-errorrate"`), using `humanizeMs`-style phrasing (import small helpers or inline them). Numbers use the `mono` class + tabular-nums.

**Copy-to-clipboard note:** guard `navigator.clipboard` (may be undefined); fall back to a hidden `textarea` + `document.execCommand('copy')` if needed. Show the "copied" affirmation for ~1.2 s.

**Design skills (visual craft — REQUIRED):** Use `anthropic-skills:frontend-design`, `design-taste-frontend`, and `emil-design-eng` to design the card and verdict. Acceptance: the verdict is a single confident hero element (the antidote to "boring"); findings read as guidance (advisory severity palette from Task 24, not data-status colors); expand is a satisfying, purposeful motion gated on `prefers-reduced-motion`; copy feedback and hover/press states feel crafted. Keep the instrument DNA (dark, Plex, tabular numerals). Do not invent data colors for severity — use the advisory scale.

- [ ] **Step 1: Write the failing test (added to the e2e spec; full runnable form in Task 23)**

This task's components are exercised by the Task 23 Playwright tests. To keep Task 21 independently gated, add a **temporary** minimal render smoke by wiring the Insights view in Task 22 — so Task 21's own gate is `pnpm --filter @apiscope/dashboard typecheck` (the components compile against the prop contracts) plus a visual review using the design skills. Behavior (expand/copy/deep-link/dismiss) is gated by Task 23's e2e.

Run: `pnpm --filter @apiscope/dashboard typecheck`
Expected: FAIL first (components reference `Finding` and helpers before they're imported) — implement, then it passes.

- [ ] **Step 2: Implement `FindingCard.tsx` and `HealthVerdict.tsx`** to the prop contracts and testable states above. Use the design skills for the appearance. Ensure every listed `data-testid` is present — those are the contract the e2e depends on.

- [ ] **Step 3: Add base styles** in `packages/dashboard/src/styles/base.css` for the card and verdict (structure + the responsive/motion behavior), using the advisory tokens introduced in Task 24 (this task may reference `var(--severity-critical)` etc.; Task 24 defines them — if Task 24 runs after, add the tokens now as a small placeholder block at the top of `tokens.css` and let Task 24 finalize).

- [ ] **Step 4: Verify typecheck**

Run: `pnpm --filter @apiscope/dashboard typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/components/FindingCard.tsx packages/dashboard/src/components/HealthVerdict.tsx packages/dashboard/src/styles/base.css
git commit -m "$(cat <<'EOF'
feat(dashboard): finding card and health verdict components

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 22: Insights view + routing + live wiring + palette entry

**Files:**
- Create: `packages/dashboard/src/views/Insights.tsx`
- Modify: `packages/dashboard/src/App.tsx` (add `#/insights` route, make it the default landing, add the nav link)
- Modify: `packages/dashboard/src/lib/live.ts` (re-fetch insights on relevant live events)
- Modify: `packages/dashboard/src/components/CommandPalette.tsx` (add `go to insights`)

**Interfaces:**
- Consumes: `api.insights()`, the store insights slice (Task 20), `FindingCard` + `HealthVerdict` (Task 21), `useDashboardStore`, `Link`.
- Produces: `export function Insights(): ReactNode`.

**Required behavior / testable states:**
- On mount, `Insights` sets `insightsLoading`, calls `api.insights()`, and stores the result via `setInsights`; on throw calls `setInsightsError`.
- It re-fetches when the live span count changes (subscribe to `state.spans.length` and re-run the fetch, debounced/throttled to at most once per ~1500 ms) so findings update as traffic accumulates. Simpler acceptable approach: re-fetch on an interval of 4000 ms while mounted AND immediately on mount; either satisfies "re-renders as traffic accumulates."
- States to render (each with a stable testid):
  - **loading (first load, no data yet):** `data-testid="insights-loading"`.
  - **error / analysis-failed** (`insights.error` set OR `insightsError` set): `data-testid="insights-error"` reading "couldn't analyze right now".
  - **advisor disabled** (`insights.advisorEnabled === false`): `data-testid="insights-disabled"` with a short explanatory line.
  - **insufficient data** (`insights.insufficientData === true` and not disabled): `data-testid="insights-insufficient"` reading "still gathering — drive some traffic".
  - **empty / all-clear** (advisor enabled, sufficient data, zero non-dismissed findings): `data-testid="insights-empty"` reading "No issues found — here's what we checked", listing `insights.rulesRun` as passed checks (`data-testid="insights-checked"`).
  - **findings present:** the `HealthVerdict` hero on top, then the ranked, non-dismissed `FindingCard`s, collapsed by default (`data-testid="insights-list"`). A grouping control (`data-testid="insights-grouping"`) switches `insightsGrouping` between severity/category/route; the list groups accordingly with a group heading per group. A "restore dismissed" control appears when `insightsDismissed.length > 0` (`data-testid="insights-restore"`).
- Expansion state lives in the view (a `Set<string>` of expanded finding keys keyed by `` `${ruleId}::${routePattern ?? ''}` ``); only one card expanded at a time is NOT required — allow multiple. `HealthVerdict.topStats` is computed from `insights.findings` + `useDashboardStore` route stats: slowest route = the `slow-route`/highest-p95 finding's route, else null; error rate = from the `error-hotspot` finding if present, else null.

**Routing changes in `App.tsx`:**
- Add `import { Insights } from './views/Insights'`.
- Add the nav link **first** in the `<nav>`: `<Link to="/insights">Insights</Link>` (before Overview). Keep the existing links.
- Change the default view: `const view = segments[0] ?? 'insights'` (was `'overview'`). This makes Insights the landing view.
- Add the render branch: `{view === 'insights' && <Insights />}`. Keep `{view === 'overview' && <Overview />}`. Note: the old bare `<Link to="/">Overview</Link>` marks Overview active at path `/`; since the default view is now `insights`, change the Overview link to `<Link to="/overview">Overview</Link>` and add `{(view === 'overview') && <Overview />}` (already present). Ensure visiting `#/` shows Insights and `#/overview` shows Overview. The Insights nav link should be `<Link to="/insights">Insights</Link>` and also treat path `/` as active for Insights — acceptable to add a small `data-active` special-case or simply rely on `#/insights`.

**Live wiring in `live.ts`:** in `socket.onmessage`, after handling `spans`/`registry` events, trigger an insights refresh. Minimal approach: export a module-level `let onTrafficChanged: (() => void) | null = null` that `Insights` registers on mount and clears on unmount; call it (throttled) when a `spans` event arrives. Simpler acceptable approach: leave `live.ts` unchanged and rely on the view's own interval/`spans.length` subscription (preferred — less coupling). If you take the simpler approach, **do not modify `live.ts`**; note that in the commit.

**Palette entry:** add `{ label: 'go to insights', target: '/insights' }` as the first entry in the `commands` array in `CommandPalette.tsx`.

- [ ] **Step 1: Implement the view and wiring** per the contracts above (states, testids, routing default change, palette entry). Use the design skills for layout/spacing/motion of the hub (spacious and guided, per spec), keeping instrument DNA.

- [ ] **Step 2: Manual smoke via the dev server**

Run the dashboard against a seeded collector (reuse `e2e/serve.mjs` once Task 23 updates it, or run `pnpm --filter @apiscope/dashboard dev` with a collector on 4620). Confirm `#/` lands on Insights, cards render, expand/copy/deep-link work, and the empty/insufficient states appear with no traffic.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @apiscope/dashboard typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/views/Insights.tsx packages/dashboard/src/App.tsx packages/dashboard/src/components/CommandPalette.tsx packages/dashboard/src/lib/live.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): insights hub view as the landing page

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 23: Insights hub e2e — seed data, render/expand/copy/deep-link, empty + insufficient states

**Files:**
- Modify: `packages/dashboard/e2e/serve.mjs` (seed advisor-triggering data)
- Modify: `packages/dashboard/e2e/dashboard.spec.ts` (insights hub tests)

**Interfaces:**
- Consumes: the seeded collector (`e2e/serve.mjs`) and the Insights view + components.

**Seed changes in `serve.mjs`:** the existing seed sends 40 spans on `/api/users/:id` and `/api/orders`. To make the advisor fire deterministically, extend it so that: (a) the `/api/users/:id` GET responses carry `response: { headers: { 'content-type': 'application/json', 'content-length': '30000' }, truncated: false, redactedHeaders: [] }` (triggers uncompressed-responses across >=5 spans); (b) add a slow route: 25 spans on `GET /api/report` with `timing.duration` around 600–800 ms so its p95 exceeds 500 ms and `slow-route` fires (register the route in `replaceRoutes`); (c) keep the single 500 on `seed-5` (or add several) so a modest error rate exists but is below the hotspot threshold unless you want error-hotspot too — to make the hub non-empty and stable, the uncompressed + slow-route findings suffice. Keep the existing n+1 seed (`seed-4`) intact. Keep the overview-related seed (span-count 40) unchanged so the existing Overview tests still pass — **add** the report spans on top rather than replacing (adjust the existing `overview` test's expected count only if the total changes; prefer keeping `/api/report` spans counted so update the Overview `span-count` expectation accordingly, or seed report spans under the same 40 by repurposing — the cleanest path: raise the seeded total and update the one Overview assertion `40 requests` to the new total in the same commit).

**Tests to add in `dashboard.spec.ts`:**

```ts
test('insights hub is the landing view and shows the health verdict', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('health-verdict')).toBeVisible()
  await expect(page.getByTestId('insights-list')).toBeVisible()
})

test('a finding expands to reveal a paste-ready fix and evidence deep-link', async ({ page }) => {
  await page.goto('/#/insights')
  const firstToggle = page.getByTestId('finding-toggle').first()
  await firstToggle.click()
  await expect(page.getByTestId('finding-snippet').first()).toBeVisible()
  const evidence = page.getByTestId('finding-evidence').first()
  await expect(evidence).toHaveAttribute('href', /#\//)
})

test('copy-fix writes the snippet and confirms', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/#/insights')
  await page.getByTestId('finding-toggle').first().click()
  await page.getByTestId('finding-copy').first().click()
  await expect(page.getByTestId('finding-copied').first()).toBeVisible()
})

test('the evidence deep-link navigates into the pre-filtered expert view', async ({ page }) => {
  await page.goto('/#/insights')
  await page.getByTestId('finding-toggle').first().click()
  await page.getByTestId('finding-evidence').first().click()
  await expect(page).toHaveURL(/#\/(routes|inspector)/)
})

test('dismissing a finding removes its card and offers restore', async ({ page }) => {
  await page.goto('/#/insights')
  const before = await page.getByTestId('finding-title').count()
  await page.getByTestId('finding-dismiss').first().click()
  await expect(page.getByTestId('finding-title')).toHaveCount(before - 1)
  await expect(page.getByTestId('insights-restore')).toBeVisible()
})
```

For the empty and insufficient states, add tests that seed a **second** collector variant. Since `serve.mjs` seeds one fixed dataset, add two dedicated serve scripts and Playwright projects, OR assert these states with query-param-gated seeding. Simplest robust approach: add `e2e/serve-empty.mjs` (a collector with the advisor enabled but **zero** spans → insufficient) and `e2e/serve-clean.mjs` (enough spans, all healthy → empty/all-clear), each on its own port, and add a second and third `webServer` entry with matching Playwright `projects`, or run them as separate `test.describe` blocks using `page.goto` against those ports. Given the existing single-webServer config, the pragmatic path is:

- Add `e2e/serve-states.mjs` that starts **two** extra collectors: one on `4656` (no spans → insufficient) and one on `4657` (healthy traffic, advisor enabled, no findings → empty). Start it from a second `webServer` array entry.
- Add tests hitting absolute URLs:

```ts
test('insufficient-data state before enough traffic', async ({ page }) => {
  await page.goto('http://127.0.0.1:4656/#/insights')
  await expect(page.getByTestId('insights-insufficient')).toBeVisible()
})

test('all-clear empty state lists what was checked', async ({ page }) => {
  await page.goto('http://127.0.0.1:4657/#/insights')
  await expect(page.getByTestId('insights-empty')).toBeVisible()
  await expect(page.getByTestId('insights-checked')).toBeVisible()
})
```

`playwright.config.ts` `webServer` accepts an array; add the extra server entry (`command: 'node e2e/serve-states.mjs'`, `url: 'http://127.0.0.1:4656/health'`, `reuseExistingServer: false`). If a `/health` route isn't served by the extra collectors, seed them to serve the dashboard `dist` and hit `/api/meta` as the readiness URL, or add a trivial readiness by pointing `url` at `http://127.0.0.1:4656/api/spans`.

- [ ] **Step 1: Update `serve.mjs`** to seed the uncompressed + slow-route data (and adjust the Overview count assertion in the same commit if the total changed). Add `serve-states.mjs` for the insufficient (4656) and empty/all-clear (4657) collectors.

- [ ] **Step 2: Add the insights tests** above to `dashboard.spec.ts` and the extra `webServer` entry to `playwright.config.ts`.

- [ ] **Step 3: Run the e2e**

Run: `pnpm --filter @apiscope/dashboard test`
Expected: all tests pass, including the new insights render/expand/copy/deep-link/dismiss and the insufficient + empty states, and the pre-existing Overview/Routes/Inspector tests still pass.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/e2e/serve.mjs packages/dashboard/e2e/serve-states.mjs packages/dashboard/e2e/dashboard.spec.ts packages/dashboard/playwright.config.ts
git commit -m "$(cat <<'EOF'
test(dashboard): e2e for the insights hub and its states

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 4 — Mobile-first responsive + "more alive" design language + explanatory layer

UI craft. Deterministic contracts (tokens to add, the exact breakpoints and states, the Playwright snapshots/assertions that gate each deliverable) are specified; the **visual/motion craft is delegated to the design skills**. Do not pre-bake the exact look.

### Task 24: Design tokens — advisory severity scale, warmer surfaces, motion scale

**Files:**
- Modify: `packages/dashboard/src/styles/tokens.css`

**Deterministic requirements (the token *names* are a contract other tasks reference):**
- Add an **advisory severity scale**, distinct from the 2xx–5xx data colors, defined in both the `:root` (dark) and `[data-theme='light']` blocks:
  - `--severity-critical`, `--severity-warning`, `--severity-advisory`, plus tinted surface variants `--severity-critical-surface`, `--severity-warning-surface`, `--severity-advisory-surface` (low-alpha backgrounds for chips/card accents).
  - These must be visually separable from `--status-2xx/3xx/4xx/5xx`. Do **not** reuse the exact status hex values; the advisory scale is guidance, not data. Choose a coherent advisory ramp (e.g. a desaturated red / amber / slate that reads as "advice" rather than "status") using the design skills. Keep `--accent` (#FF5C00) interaction-only.
- Add **warmer surface/elevation tokens**: `--surface-1`, `--surface-2`, `--surface-3` (progressively raised, slightly warm dark), and `--elevation-1`, `--elevation-2` (subtle shadows) for layered depth instead of flat 1px borders everywhere. Provide light-theme equivalents.
- Add a **motion scale**: `--motion-duration-fast`, `--motion-duration-base`, `--motion-duration-slow`, `--motion-ease` (a standard ease), and a `--motion-stagger` step for staggered list entrance. Add a global rule so these collapse to `0` under reduced motion:

```css
@media (prefers-reduced-motion: reduce) {
  :root {
    --motion-duration-fast: 0ms;
    --motion-duration-base: 0ms;
    --motion-duration-slow: 0ms;
    --motion-stagger: 0ms;
  }
}
```

**Design skills (REQUIRED):** use `design-taste-frontend`, `emil-design-eng`, and `anthropic-skills:frontend-design` to pick the exact advisory hues, warm surface values, elevation shadows, and motion timings. Acceptance: warmer, layered, more alive; advisory scale distinct from data colors; motion purposeful and fully collapsing under reduced motion; instrument DNA intact.

- [ ] **Step 1: Add the tokens** to `tokens.css` (dark + light) with the exact names above.

- [ ] **Step 2: Verify the dashboard still builds and existing snapshots' intent is preserved** — token additions alone should not change existing views' pixels materially; if they do (e.g. you re-theme surfaces used by Overview), that is expected and handled by the snapshot regeneration in Task 27.

Run: `pnpm --filter @apiscope/dashboard build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/src/styles/tokens.css
git commit -m "$(cat <<'EOF'
feat(dashboard): advisory severity, warm surface, and motion tokens

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 25: Mobile-first responsive shell + tables-to-cards

**Files:**
- Modify: `packages/dashboard/src/styles/base.css` (responsive rules)
- Modify: `packages/dashboard/src/App.tsx` (mobile nav structure — a bottom tab bar / drawer)
- Modify: `packages/dashboard/src/views/Routes.tsx` and `packages/dashboard/src/views/Inspector.tsx` (table→card affordances where structural markup is needed)

**Deterministic requirements / testable states:**
- At `<=640px`:
  - The layout is a single-column stream; `main` padding shrinks; content never causes horizontal page scroll (the `<body>`/`.layout` must not scroll horizontally — wide content scrolls inside its own container).
  - Navigation collapses. Implement a **bottom tab bar** (`data-testid="mobile-nav"`) containing the primary destinations (Insights, Routes, Inspector) with real touch targets (>=44px), and move the remaining expert views (Flamegraph, Dependencies, Load, Runs, Config, Overview) into a "More" menu/drawer (`data-testid="mobile-more"`). The desktop `.topbar nav` is hidden at `<=640px`; the bottom bar is hidden above it.
  - Expert **tables** (Routes, Inspector waterfall/rows) either become stacked label→value cards OR scroll inside an `overflow-x: auto` container (`data-testid="table-scroll"` wrapper on the Routes table is acceptable as the contained-scroll approach). They must never break the page layout. The Routes table is the canonical case: wrap it so it scrolls horizontally within its region on mobile, or restructure rows into cards via CSS at the breakpoint.
  - The live latency strip scales down gracefully (the `LatencyStrip` canvas already resizes; ensure its container is fluid).
- Fluid type/spacing: use the existing `--space-*`/`--text-*` scale; optionally introduce `clamp()`-based fluid sizes for headings in the hub.

**Design skills (REQUIRED):** use `design-taste-frontend` + `anthropic-skills:frontend-design` for the mobile nav pattern, the card transformation, touch targets, and fluid type. Acceptance: single-column at <=640px; nav collapses to a bottom bar/drawer; tables become stacked cards or contained-scroll and never break layout; real touch targets; hub is a clean card stream on phones.

- [ ] **Step 1: Write the failing responsive test** in `dashboard.spec.ts`:

```ts
test('mobile layout collapses nav and avoids horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/#/insights')
  await expect(page.getByTestId('mobile-nav')).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  expect(overflow).toBe(true)
})

test('routes table does not break the page layout on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/#/routes')
  const bodyOverflow = await page.evaluate(() => document.body.scrollWidth <= window.innerWidth + 1)
  expect(bodyOverflow).toBe(true)
})
```

Run: `pnpm --filter @apiscope/dashboard test -g "mobile"`
Expected: FAIL — `mobile-nav` absent / page overflows.

- [ ] **Step 2: Implement the responsive shell and table treatment** to satisfy the tests and the requirements, using the design skills for the visual pattern. Add the bottom tab bar + "More" drawer to `App.tsx` (rendered only at the mobile breakpoint via CSS visibility, or conditionally via a `matchMedia` hook — CSS visibility is simplest and SSR-free). Wrap the Routes table in a contained-scroll region (or card transform).

- [ ] **Step 3: Run the responsive tests**

Run: `pnpm --filter @apiscope/dashboard test -g "mobile"`
Expected: PASS. Also run the full suite to ensure desktop tests still pass: `pnpm --filter @apiscope/dashboard test`.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/styles/base.css packages/dashboard/src/App.tsx packages/dashboard/src/views/Routes.tsx packages/dashboard/src/views/Inspector.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): mobile-first responsive shell and table treatment

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 26: "More alive" motion + explanatory layer on existing views

**Files:**
- Modify: `packages/dashboard/src/views/Insights.tsx` (staggered entrance, count-up on verdict — purposeful motion)
- Modify: `packages/dashboard/src/styles/base.css` (transitions using the motion tokens)
- Modify: `packages/dashboard/src/views/Routes.tsx`, `packages/dashboard/src/views/Overview.tsx`, `packages/dashboard/src/views/Inspector.tsx` (light "what this means" interpretation on p50/p95/p99, error rate, payload size)

**Deterministic requirements / testable states:**
- **Purposeful motion (gated on `prefers-reduced-motion`):** findings stagger in on the hub; the health verdict number counts up; view transitions and the live strip animate smoothly. All must be no-ops under reduced motion (Task 24's media query zeros the durations; also ensure any JS-driven count-up checks `window.matchMedia('(prefers-reduced-motion: reduce)').matches` and renders the final value immediately when true).
- **Explanatory layer:** add a plain-language interpretation to key metrics on existing views. Contract: each annotated metric exposes an accessible explanation available without leaving the view — implement as an inline note or a hover/focus tooltip with `data-testid="metric-explainer"` present on at least the Routes p95 cell and the Overview error count. Example copy: for p95, "1 in 20 requests is slower than this"; for error rate, "share of requests that failed". These are interpretation, not tutorials — do not explain what a status code is.
- No structural change to the expert views beyond annotation + the responsive treatment from Task 25.

**Design skills (REQUIRED):** use `emil-design-eng` (motion reflects data, never decoration) for the stagger/count-up/transition timing, and `design-taste-frontend` for the explanatory-note styling. Acceptance: motion is purposeful and fully collapses under reduced motion; the explanatory notes translate numbers into consequence without clutter; expert views stay dense.

- [ ] **Step 1: Write the failing tests** in `dashboard.spec.ts`:

```ts
test('reduced motion renders the verdict value immediately and is stable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/#/insights')
  await expect(page.getByTestId('health-verdict')).toBeVisible()
})

test('routes view annotates p95 with a plain-language explainer', async ({ page }) => {
  await page.goto('/#/routes')
  await expect(page.getByTestId('metric-explainer').first()).toBeAttached()
})
```

Run: `pnpm --filter @apiscope/dashboard test -g "explainer"`
Expected: FAIL — `metric-explainer` absent.

- [ ] **Step 2: Implement the motion and the explanatory notes** to the contract, using the design skills. Ensure the JS count-up (if used) respects reduced motion.

- [ ] **Step 3: Run the tests**

Run: `pnpm --filter @apiscope/dashboard test -g "explainer|reduced motion"`
Expected: PASS. Then the full suite: `pnpm --filter @apiscope/dashboard test`.

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/views/Insights.tsx packages/dashboard/src/views/Routes.tsx packages/dashboard/src/views/Overview.tsx packages/dashboard/src/views/Inspector.tsx packages/dashboard/src/styles/base.css
git commit -m "$(cat <<'EOF'
feat(dashboard): purposeful motion and plain-language metric explainers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 27: Visual snapshots — insights hub at mobile + desktop, both themes; regenerate affected baselines

**Files:**
- Modify: `packages/dashboard/e2e/dashboard.spec.ts` (visual snapshot tests)
- Add: new baseline PNGs under `packages/dashboard/e2e/dashboard.spec.ts-snapshots/` (macOS `-darwin.png`, per D20)

**Deterministic requirements:**
- Add visual snapshot tests for the insights hub in both themes at desktop and mobile widths, mirroring the existing `overview visual snapshot dark and light` pattern (toggle theme via the existing `toggle theme` button; the seeded `serve.mjs` from Task 23 provides deterministic findings):

```ts
test('insights hub visual snapshot dark and light (desktop)', async ({ page }) => {
  await page.goto('/#/insights')
  await expect(page.getByTestId('health-verdict')).toBeVisible()
  await expect(page).toHaveScreenshot('insights-desktop-dark.png')
  await page.getByRole('button', { name: 'toggle theme' }).click()
  await expect(page).toHaveScreenshot('insights-desktop-light.png')
})

test('insights hub visual snapshot mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/#/insights')
  await expect(page.getByTestId('health-verdict')).toBeVisible()
  await expect(page).toHaveScreenshot('insights-mobile-dark.png')
})
```

- Because Task 24 (warmer surfaces) and Task 25/26 (responsive + motion) may shift pixels on the **existing** Overview baselines, regenerate all affected baselines.

- [ ] **Step 1: Add the snapshot tests** above to `dashboard.spec.ts`.

- [ ] **Step 2: Generate the new + affected baselines with the explicit `=all` mode (deviation D41)**

Run: `pnpm --filter @apiscope/dashboard exec playwright test --update-snapshots=all`
Expected: Playwright prints `... is re-generated, writing actual.` for the new `insights-*` PNGs and any changed `overview-*` PNGs.

- [ ] **Step 3: Confirm the baselines actually changed on disk (D41 verification)**

Run: `git status packages/dashboard/e2e/dashboard.spec.ts-snapshots/`
Expected: the new `insights-desktop-dark-darwin.png`, `insights-desktop-light-darwin.png`, `insights-mobile-dark-darwin.png` appear as untracked, and any re-themed `overview-*-darwin.png` show as modified. Do **not** trust a green "N passed" alone — confirm the byte changes here.

- [ ] **Step 4: Re-run the suite against the committed baselines**

Run: `pnpm --filter @apiscope/dashboard test`
Expected: clean pass against the regenerated baselines (self-consistent).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/e2e/dashboard.spec.ts "packages/dashboard/e2e/dashboard.spec.ts-snapshots"
git commit -m "$(cat <<'EOF'
test(dashboard): visual baselines for the insights hub, mobile and desktop

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 28: Final full-pipeline verification + README note

**Files:**
- Modify: `README.md` (add `@apiscope/advisor` to the package table; one line on the Insights hub)

- [ ] **Step 1: Add the package-table row and a short Insights line** to `README.md`, matching the existing table format (name, one-line description). No timings, no benchmarks.

- [ ] **Step 2: Full pipeline**

Run: `pnpm build && pnpm typecheck && APISCOPE_SKIP_CONTAINERS=true pnpm test`
Expected: every package green — `@apiscope/advisor` unit tests, the collector `insights-api` integration tests, the CLI config tests, and the dashboard Playwright suite (hub render/expand/copy/deep-link/dismiss, empty + insufficient states, responsive, reduced-motion, and the visual baselines).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: document the advisor package and insights hub

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review (run before handoff)

**1. Spec coverage** — every spec section maps to a task:
- Architecture / `@apiscope/advisor` pure functions, core-only dep → Tasks 1–16 (package), Global Constraints.
- Finding model (exact fields) → Task 1 (verbatim shape).
- Rule framework & noise control (`minimumSampleSize`, failure isolation, `{ findings, rulesRun, insufficientData }`) → Tasks 2, 5, 16.
- v1 catalog: uncompressed (6), missing-cache (7), oversized (8), slow-route (9), where-time-goes (10), unstable-latency (11), n+1 (12), sequential-outbound (13), slow-dependency (14), error-hotspot (15).
- Framework-aware fix system (per-framework templates, generic fallback, framework from handshake) → Task 4.
- Collector `GET /api/insights` + `advisor` config block + resilience/degradation → Tasks 17, 18.
- Insights hub (verdict hero, ranked collapsible cards, copy-fix, deep-link, grouping+dismissal, empty, insufficient) → Tasks 20–23.
- Explanatory layer on existing views → Task 26.
- Mobile-first responsive (single column, collapsing nav, tables→cards, latency strip) → Task 25.
- More alive (motion, warmth/elevation, craft, advisory severity scale) → Tasks 24, 26.
- Design tokens (extend not replace; advisory scale distinct from data; motion collapses under reduced motion) → Task 24.
- Error handling & resilience (best-effort, throwing rule skipped, `/api/insights` returns what succeeded, graceful whole-analysis failure, insufficient-data first-class, framework fallback) → Tasks 5, 16, 17.
- Testing (pure-function rule tests, fix templates per framework, `/api/insights` integration incl. rule-throws + insufficientData, dashboard Playwright incl. responsive/dual-theme/reduced-motion) → Tasks 6–16, 4, 17, 23, 25–27.
- Non-goals respected: no CPU-hotspot on-demand profile rule; no two UI modes; no new instrumentation; no CI/MCP wiring (the `Finding` shape leaves it open).

**2. Placeholder scan** — Phases 1–2 contain complete code (rules, types, fixes, endpoint, tests). Phases 3–4 intentionally specify contracts + tests + design-skill direction for the *visual* layer (per the task brief); every UI task still gives exact data shapes, prop contracts, testids, routing changes, and runnable Playwright tests. No "TBD"/"similar to Task N"/"add error handling" left.

**3. Type consistency** — `Finding` and its sub-shapes are identical in the advisor (Task 1) and the dashboard (Task 20). `AdvisorRouteStats` mirrors the collector's `RouteStats` field-for-field. Rule ids match across `DEFAULT_RULE_MINIMUM_SAMPLE_SIZE` (Task 2), the fix templates (Task 4), each rule file (Tasks 6–15), and the registry (Task 16). `resolveFix(ruleId, framework, params)` signature is used consistently. The dashboard testids referenced in components (Task 21) exactly match those asserted in the e2e (Task 23).

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-06-dashboard-advisor.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. **REQUIRED SUB-SKILL:** superpowers:subagent-driven-development.

**2. Inline Execution** — execute tasks in this session using superpowers:executing-plans, batch execution with checkpoints for review.

**Which approach?**
