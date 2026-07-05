# apiscope docker-compose self-host

One-command self-host: `docker compose up` starts the collector, ClickHouse, and Valkey together. The collector uses the ClickHouse store, the Valkey live transport, tail sampling, and a password-protected dashboard.

## Setup

1. Copy `.env.example` to `.env` and fill in real values:

   ```bash
   cp .env.example .env
   ```

2. Generate an argon2id password hash for the dashboard admin user (run from `packages/collector`, where `argon2` is installed):

   ```bash
   node -e "import('argon2').then(a=>a.hash(process.argv[1])).then(console.log)" 'your-password'
   ```

   docker compose's `.env` file parser treats `$` as variable-substitution syntax, so every literal `$` in the hash must be escaped as `$$` before it goes into `.env` — otherwise the hash is silently corrupted with no error at login time:

   ```bash
   node -e "import('argon2').then(a=>a.hash(process.argv[1])).then(h=>console.log(h.split('\$').join('\$\$')))" 'your-password'
   ```

   Paste the resulting `$$argon2id$$...` string into `APISCOPE_DASHBOARD_PASSWORD_HASH` in `.env`. Run `docker compose config` afterward and confirm the rendered `APISCOPE_DASHBOARD_PASSWORD_HASH` value matches the real hash (single `$`, not blanked-out segments) before starting the stack.

3. Generate the ClickHouse password and ingest token:

   ```bash
   openssl rand -hex 32
   ```

   Use one value for `CLICKHOUSE_PASSWORD`, another for `APISCOPE_INGEST_TOKEN_WEB`, and another for `APISCOPE_SESSION_SECRET`.

4. Start the stack:

   ```bash
   docker compose up
   ```

The collector listens on `4620`, backed by ClickHouse (`8123`, internal) and Valkey (`6379`, internal). ClickHouse data persists in the `clickhouse-data` named volume.

## Connecting an app

Point your apiscope adapter at the collector with the matching token:

```
ws://<host>:4620
```

with the `x-apiscope-app: web` header and the `APISCOPE_INGEST_TOKEN_WEB` bearer token, matching the `tokens` entry in `apiscope.config.ts`.

## Tearing down

```bash
docker compose down
```

Add `-v` to also remove the ClickHouse data volume.
