# @apiscope/cli

## 0.1.3

### Patch Changes

- `apiscope dev` now welcomes you: it detects the framework in your current directory (Next.js, NestJS, Fastify, Express, or Hono), prints the exact adapter install command and usage snippet if you haven't instrumented your app yet (or a short confirmation if you already have), and opens the dashboard in your browser. Pass `--no-open` to skip the browser launch; it never opens automatically in CI or when output isn't a TTY.

## 0.1.2

### Patch Changes

- Fix `npx apiscope` and globally-installed `apiscope` doing nothing. The CLI's entry-point guard only ran `main()` when the process was invoked as `cli.js`, but npx and global installs invoke it through a `.bin/apiscope` symlink, so `process.argv[1]` was `apiscope`, the guard was false, and the command exited silently. Resolve the symlink with `realpathSync` before checking, so the CLI runs however it is invoked.

## 0.1.1

### Patch Changes

- Updated dependencies
  - @apiscope/collector@0.1.1
  - @apiscope/dashboard@0.1.0
  - @apiscope/mcp@0.1.0

## 0.1.0

### Minor Changes

- Initial public release. Dev-time API observability and load testing for JavaScript frameworks (Next.js, Express, Fastify, NestJS, Hono) with route introspection, a live latency waterfall, a coordinated-omission-safe load engine, and a CI mode with latency budgets — plus a self-hostable production backend (ClickHouse, auth, sampling, Valkey fan-out), OTLP interop, W3C trace-context propagation, database instrumentation with n+1 detection, CPU flamegraphs, an MCP server, and the Insights advisor that turns captured spans into plain-language, framework-aware recommendations.

### Patch Changes

- Updated dependencies
  - @apiscope/collector@0.1.0
  - @apiscope/core@0.1.0
  - @apiscope/dashboard@0.1.0
  - @apiscope/load@0.1.0
  - @apiscope/mcp@0.1.0
