#!/usr/bin/env bash
set -euo pipefail
pnpm build
pnpm --filter @apiscope/dashboard build
pnpm --filter @apiscope/cli build:binary
ls -la packages/cli/binaries
