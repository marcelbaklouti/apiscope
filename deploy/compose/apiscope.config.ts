import { defineConfig } from '@apiscope/cli'

export default defineConfig({
  collector: {
    host: '0.0.0.0',
    port: 4620,
    storage: {
      driver: 'clickhouse',
      url: 'env:APISCOPE_CLICKHOUSE_URL',
      username: 'env:APISCOPE_CLICKHOUSE_USER',
      password: 'env:APISCOPE_CLICKHOUSE_PASSWORD',
      retentionDays: 30
    }
  },
  production: {
    ingestAuth: { mode: 'token', tokens: [{ appName: 'web', token: 'env:APISCOPE_INGEST_TOKEN_WEB' }] },
    dashboardAuth: {
      mode: 'password',
      sessionSecret: 'env:APISCOPE_SESSION_SECRET',
      users: [{ username: 'env:APISCOPE_DASHBOARD_USER', passwordHash: 'env:APISCOPE_DASHBOARD_PASSWORD_HASH', displayName: 'admin' }]
    },
    liveTransport: { mode: 'valkey', url: 'env:APISCOPE_VALKEY_URL' },
    sampling: { mode: 'tail', baseProbability: 0.1 }
  }
})
