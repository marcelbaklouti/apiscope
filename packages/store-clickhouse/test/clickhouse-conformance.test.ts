import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ClickHouseContainer, type StartedClickHouseContainer } from '@testcontainers/clickhouse'
import { runStoreConformance } from '@apiscope/collector/testing'
import { ClickHouseSpanStore } from '../src/store'

let container: StartedClickHouseContainer
let baseUrl = ''

beforeAll(async () => {
  container = await new ClickHouseContainer('clickhouse/clickhouse-server:24.8').start()
  baseUrl = container.getHttpUrl()
}, 120000)

afterAll(async () => {
  await container.stop()
})

runStoreConformance(
  async () =>
    new ClickHouseSpanStore({
      url: baseUrl,
      username: container.getUsername(),
      password: container.getPassword(),
      database: `apiscope_${Math.random().toString(36).slice(2)}`,
      syncInserts: true,
      retentionDays: null
    }),
  describe,
  it,
  expect as never
)
