#!/usr/bin/env bash
set -euo pipefail
set -m

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

pack_dir="$(mktemp -d "${TMPDIR:-/tmp}/apiscope-smoke-pack.XXXXXX")"
project_dir="$(mktemp -d "${TMPDIR:-/tmp}/apiscope-smoke-project.XXXXXX")"
server_log="$(mktemp "${TMPDIR:-/tmp}/apiscope-smoke-server.XXXXXX.log")"
server_pid=""

kill_server_group() {
  if [ -n "$server_pid" ] && kill -0 "$server_pid" 2>/dev/null; then
    kill -TERM -- "-$server_pid" 2>/dev/null || kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
}

cleanup() {
  kill_server_group
  rm -rf "$pack_dir" "$project_dir" "$server_log"
}
trap cleanup EXIT

fail() {
  echo "FAILED: $1"
  if [ -f "$server_log" ]; then
    echo "--- server log ---"
    cat "$server_log"
  fi
  exit 1
}

echo "==> building workspace"
pnpm -r build

echo "==> packing every publishable package"
pnpm -r pack --pack-destination "$pack_dir" --json >"$pack_dir/manifest.json" 2>/dev/null

package_count="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).length)" "$pack_dir/manifest.json")"
if [ "$package_count" -lt 1 ]; then
  fail "pnpm -r pack produced no tarballs"
fi
echo "packed $package_count packages"

echo "==> writing consumer project"
node -e "
const fs = require('fs')
const path = require('path')
const manifest = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'))
const dependencies = {}
for (const entry of manifest) {
  dependencies[entry.name] = 'file:' + entry.filename
}
const packageJson = {
  name: 'apiscope-smoke-install-consumer',
  version: '0.0.0',
  private: true,
  dependencies
}
fs.writeFileSync(path.join(process.argv[2], 'package.json'), JSON.stringify(packageJson, null, 2))
" "$pack_dir/manifest.json" "$project_dir"

echo "==> npm install (builds better-sqlite3)"
(cd "$project_dir" && npm install --no-audit --no-fund) || fail "npm install failed"

bin_path="$project_dir/node_modules/.bin/apiscope"
if [ ! -e "$bin_path" ]; then
  fail "expected bin symlink not found at $bin_path"
fi

echo "==> starting apiscope dev via the installed bin symlink"
(cd "$project_dir" && CI=true "$bin_path" dev --no-open >"$server_log" 2>&1) &
server_pid=$!

if ! kill -0 "$server_pid" 2>/dev/null; then
  fail "apiscope dev process exited immediately after starting"
fi

health_url="http://127.0.0.1:4620/health"
curl --silent --fail --max-time 2 \
  --retry 60 --retry-delay 1 --retry-all-errors --retry-connrefused \
  "$health_url" >/dev/null || fail "apiscope dev did not become healthy within ~60s (GET /health never returned 200)"

check_status() {
  local path="$1"
  local url="http://127.0.0.1:4620${path}"
  local status
  status="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 5 "$url")"
  if [ "$status" != "200" ]; then
    fail "GET $path returned $status, expected 200"
  fi
  echo "OK GET $path -> 200"
}

check_status "/health"
check_status "/"
check_status "/api/insights"

kill_server_group
server_pid=""

echo "PASSED: clean install + bin symlink + dev server smoke test"
