# apiscope Dashboard Advisor & UI Redesign — Design Specification

Date: 2026-07-06
Status: Approved section-by-section in brainstorming; pending spec review.

## Overview

Today apiscope's dashboard is a passive instrument: it renders raw metrics (percentiles, status codes, waterfalls, flamegraphs) and assumes the viewer can interpret them. This redesign turns it into an **active advisor** for mid-level full-stack developers — it explains what the data means and recommends concrete, framework-aware fixes — while preserving the depth expert users rely on. It also modernizes the UI to be **mobile-first responsive** and **more visually alive** without sacrificing the credible instrument aesthetic.

The advisor is analysis over data apiscope **already captures** (response headers and bodies, full timing, DB and outbound child spans, status codes, the route registry, CPU flamegraphs). No new instrumentation is required.

## Goals

- Make the dashboard understandable and actionable for **mid-level full-stack devs** — people who ship APIs but are not performance/observability specialists.
- **Lead with findings and recommendations** ("what to do"), not raw data.
- Provide **framework-aware, paste-ready fixes** (Express, Fastify, Next.js, NestJS, Hono).
- Make the whole dashboard **mobile-first responsive**.
- Give it a **warmer, more alive feel with purposeful motion**, keeping the instrument DNA.
- Preserve **expert depth** (the existing eight views) as the evidence layer, lightly annotated with plain-language interpretation.

## Non-Goals (this iteration)

- CPU-hotspot findings that require an on-demand profile — fast-follow, opt-in ("run a profile to unlock").
- Two full UI modes (guided vs expert). We use one experience with progressive disclosure.
- New instrumentation — the advisor only analyzes already-captured data.
- Wiring findings into `apiscope ci` or the MCP server now. The `Finding` model is shaped to allow it later.

## Audience & Posture

Primary user: the **mid-level full-stack developer**. Assume HTTP and coding literacy; do not teach what a status code is. Do explain **interpretation and consequences** ("p95 574 ms means about 1 in 20 requests waits over half a second — users feel that") and always **lead with the fix**.

Posture: **augment, not replace**. A new **Insights hub** becomes the landing view and the home of findings. The existing views remain as expert depth and as deep-link evidence targets, lightly annotated with interpretation. This gives progressive disclosure by construction: scan the finding, expand the fix, drill into the raw evidence only if you want proof.

## Architecture

A new package **`@apiscope/advisor`** holds the intelligence as **pure functions**, depending only on `@apiscope/core` types (zero runtime dependencies otherwise). Public surface:

```
analyze(context: AdvisorContext): Finding[]
AdvisorContext = { spans, childSpans, routeStats, apps, config }
```

No I/O and no side effects, so every rule is trivially testable in isolation — the same discipline as `@apiscope/core`.

The **collector** wires the advisor to the `SpanStore` and serves **`GET /api/insights`**, recomputed over the recent window and gated by sample sizes. The **dashboard's new Insights view** consumes it over the existing live connection and re-renders as traffic accumulates.

Because a `Finding` is a pure data structure, the same source can later feed **`apiscope ci`** (fail a build on critical findings) and the **MCP server** (a coding agent reads the API's problems). Both are out of scope now and enabled by the shape.

Package layering: `core` ← `advisor` ← `collector` → `dashboard`. `advisor` imports only `core` types.

## The Finding Model

```
Finding {
  ruleId: string
  category: 'performance' | 'payload' | 'caching' | 'database' | 'dependencies' | 'reliability' | 'code'
  severity: 'critical' | 'warning' | 'advisory'
  title: string              // plain language: "3 routes send uncompressed responses"
  whatAndWhy: string         // 1-2 sentences: what it is + why it matters
  impact: {                  // quantified and humanized
    metric: string           // machine value, e.g. "p95=574ms", "avgBytes=143210"
    humanized: string        // "~140 KB → ~28 KB · affects 45% of your traffic"
  }
  scope: { level: 'global' | 'route' | 'app'; routePattern?: string; appName?: string }
  evidence: {
    spanIds: string[]
    deepLink: string         // hash route into the pre-filtered expert view
  }
  fix: {
    framework: string
    explanation: string
    codeSnippet?: string     // paste-ready; omitted when only guidance applies
    docsUrl?: string
  }
  sampleSize: number         // spans the finding is based on
}
```

Findings are ranked for display by `severity × traffic-share × fixability`.

## Rule Framework & Noise Control

Each rule declares: `id`, `category`, a `minimumSampleSize`, a threshold/confidence, and a `detect(context) => Finding[]`. The engine runs all registered rules, **isolates failures** (a throwing rule is skipped, never breaking the response), and returns `{ findings, rulesRun, insufficientData }`.

Noise control is built in: a rule never fires below its `minimumSampleSize`, so a route hit twice never produces advice. Thresholds (latency budgets, payload-size limits, error-rate cutoffs) have sensible defaults and are overridable in `apiscope.config.ts` under an `advisor` block, reusing the existing typed-config machinery.

## v1 Finding Catalog

**Response efficiency**
- **Uncompressed responses** ⭐ — a text-y response (`json`/`html`/`text`/`js`/`css`) over ~1.4 KB with no `content-encoding: gzip|br`. Fix: framework compression (`compression`, `@fastify/compress`, `compress()` for Hono, `next.config` / Nest middleware). Severity: warning.
- **Missing cache headers** — a repeated identical GET returning 200 with no `cache-control`/`etag`. Fix: framework caching/etag snippet. Severity: advisory.
- **Oversized payload** — a list route consistently returning large JSON (default > 100 KB or a large array). Fix: paginate / select fields / cap. Severity: warning.

**Latency, explained** ⭐
- **Slow route** — route p95 over budget (default 500 ms) with enough samples, expressed in human terms. Severity: warning, or critical above a higher bound.
- **Where the time goes** — for a slow route, attribute p95 across your code vs DB vs outbound from child spans ("90% is one DB query"). Severity derived. This is what turns a number into a decision.
- **Unstable latency** — p99/p50 above a ratio (default 5): "most are fast but some hit a cliff," points at the slow tail in Inspector. Severity: advisory/warning.

**Antipatterns** ⭐
- **N+1 queries** — surfaces Plan 17's detection as a first-class finding with an eager-load/join/batch fix.
- **Sequential outbound calls** — 2+ non-overlapping outbound fetches in one request that could run in parallel. Fix: a `Promise.all([...])` pattern. Severity: warning.
- **Slow dependency / slow query** — a single DB query or third-party call dominating a route's time. Fix: index / cache / timeout / parallelize. Severity: warning.

**Reliability**
- **Error hotspot** — a route with an elevated 5xx (or clustered 4xx) rate above threshold. Fix: deep-link to the failing spans. Severity scales with rate.

**Fast-follow (v1.1, not built now):** CPU hotspot (needs an on-demand profile), repeated-query dedupe beyond n+1, payload-schema drift.

## Framework-Aware Fix System

A fix resolver maps `(ruleId, framework) → { explanation, codeSnippet?, docsUrl? }`. Templates exist per supported framework for rules that have a concrete code fix; an unknown or unavailable framework falls back to generic guidance plus a docs link, **never a wrong snippet**. Snippets are minimal and paste-ready, and the framework is taken from the app handshake metadata already stored with the route registry.

## The Insights Hub (UI)

The new **landing view**:

- **Health verdict hero** — the at-a-glance answer, in words: "2 things worth fixing · affecting ~40% of traffic" or "Looking healthy." A single confident element (the antidote to "boring"), with humanized top stats beneath it (slowest route, error rate) framed as meaning, not raw counts.
- **Prioritized finding cards** — ranked, collapsed by default (scan titles). Expanding reveals the **paste-ready fix with a copy button** and a **"show me the evidence"** deep-link into the pre-filtered expert view. Each card shows a severity/category chip, plain title, one-line why, and quantified impact.
- **Grouping and dismissal** — group by category or route; dismiss a finding (session-scoped) to focus.
- **Empty state** — "No issues found — here's what we checked ✓", listing the rules that passed. Reassuring and educational, never blank.
- **Insufficient-data state** — "still gathering — drive some traffic," shown when overall sample size is too low.

## Explanatory Layer (existing views)

Add light "what this means" interpretation to key metrics on the existing views (p50/p95/p99, error rate, payload size) — a hover or inline note that translates the number into consequence. Findings deep-link into these views pre-filtered, so the expert view becomes the evidence behind a recommendation. No structural change to the expert views beyond annotation and responsive treatment.

## Design Language: Mobile-First & More Alive

UI work uses the **design-taste-frontend**, **frontend-design**, and **emil-design-eng** skills. The direction:

**Keep the instrument DNA** — dark base, IBM Plex Sans + Mono, tabular numerals, status colors for data. That is the credibility; it stays.

**Mobile-first responsive (whole dashboard):**
- The hub is a single-column card stream on phones — findings-as-cards is inherently mobile-friendly.
- Navigation collapses to a bottom tab bar / drawer on small screens; the expert views move to a secondary menu.
- Expert **tables** (Routes, Inspector) become stacked label→value cards on mobile, or scroll inside a contained region — they must never break the page layout.
- The live latency strip scales down gracefully. Real touch targets, fluid type and spacing.

**More alive, still credible:**
- **Purposeful motion** (Emil's rule — motion reflects data, never decoration): findings stagger in, numbers count up, the health verdict and live strip animate, smooth view transitions. All gated on `prefers-reduced-motion`.
- **Warmth and hierarchy** — a slightly warmer dark palette, subtle elevation/layering rather than flat 1 px everywhere, a stronger type scale and more breathing room so the eye lands on what matters (today everything competes equally).
- **Craft in the details** — copy-to-clipboard feedback, hover/press states, a satisfying expand and dismiss.
- **A distinct advisory color scale** for severities (critical/warning/advisory), separate from the 2xx–5xx data colors, so findings read as guidance rather than data.
- Expert views stay dense (experts want that); the hub is spacious and guided.

## Design Tokens & Conventions

Extends the existing token system rather than replacing it. Base `#0A0A0B`; accent international orange `#FF5C00` for interaction only, never data; status scale 2xx `#8BA88E` / 3xx `#7C8B9E` / 4xx `#D9A621` / 5xx `#D64545`; IBM Plex Sans + Mono with `font-variant-numeric: tabular-nums`. Adds: an advisory severity scale distinct from the data colors; warmer surface/elevation tokens; and a motion scale that fully collapses under `prefers-reduced-motion`. Node >= 24, TypeScript strict, ESM + dual output, no code comments, conventional commits, MIT.

## Error Handling & Resilience

The advisor is best-effort and must never degrade the dashboard. Rules run isolated; a throwing rule is skipped and logged. `/api/insights` returns whatever succeeded plus `rulesRun`; whole-analysis failure surfaces a graceful "couldn't analyze right now" state. Insufficient data is a first-class per-rule state (silent below the minimum sample size). Framework-fix resolution falls back to generic guidance on an unknown framework.

## Testing

- **Rules** — pure-function unit tests over fixture span sets: fires when it should, stays silent below threshold, correct impact value, and the correct fix per framework (Express/Fastify/Next/Nest/Hono). This is the bulk of the advisor's coverage and is cheap because rules are pure.
- **Fix templates** — a test per framework for each rule that emits a snippet.
- **`/api/insights`** — integration test over a seeded store, including the rule-throws degradation path and the `insufficientData` shape.
- **Dashboard** — Playwright for the hub (render, expand, copy, deep-link), the empty and insufficient-data states, responsive/visual snapshots at mobile and desktop widths in both themes, and `prefers-reduced-motion` respected. Extends Plan 9's Playwright setup and honors deviation D41 (`--update-snapshots=all` when regenerating baselines).
