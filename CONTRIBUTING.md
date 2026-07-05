# Contributing

## Setup

pnpm 10 and Node 20+ are required. Bun is optional (Hono smoke test).

    pnpm install
    pnpm build
    pnpm test

## Workflow

Work happens in feature branches against `main`. Every change that affects a published package needs a changeset:

    pnpm changeset

Conventional commits are required. CI must be green (build, typecheck, tests on Node 24 and 26, Bun smoke) before merge.

## Testing

Every package uses Vitest. Adapter packages contain end-to-end tests against a real collector; run a single package with:

    pnpm --filter @apiscope/<name> test

## Releases

Merging the Changesets version PR publishes to npm automatically.
