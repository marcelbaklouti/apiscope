# @apiscope/collector

## 0.1.1

### Patch Changes

- Ship the vendored OpenTelemetry `.proto` files with the collector. The `proto/` directory was missing from the published `files`, so the collector threw "unable to locate the vendored otlp proto directory" on load when installed from npm (breaking `npx apiscope`). Adding `proto` to `files` includes them in the published package.

## 0.1.0

### Minor Changes

- Initial public release. Dev-time API observability and load testing for JavaScript frameworks (Next.js, Express, Fastify, NestJS, Hono) with route introspection, a live latency waterfall, a coordinated-omission-safe load engine, and a CI mode with latency budgets — plus a self-hostable production backend (ClickHouse, auth, sampling, Valkey fan-out), OTLP interop, W3C trace-context propagation, database instrumentation with n+1 detection, CPU flamegraphs, an MCP server, and the Insights advisor that turns captured spans into plain-language, framework-aware recommendations.

### Patch Changes

- Updated dependencies
  - @apiscope/advisor@0.1.0
  - @apiscope/core@0.1.0
  - @apiscope/load@0.1.0
