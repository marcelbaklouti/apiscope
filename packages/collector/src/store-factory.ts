import type { SpanStore } from './store-interface'
import { SqliteSpanStore } from './store'

export type StorageConfig =
  | { driver: 'sqlite'; dbPath: string; retentionRows?: number }
  | { driver: 'clickhouse'; url: string; username?: string; password?: string; database?: string; retentionDays?: number }

interface ClickHouseStoreModule {
  ClickHouseSpanStore: new (options: {
    url: string
    username?: string
    password?: string
    database?: string
    retentionDays?: number | null
  }) => SpanStore
}

export async function resolveStore(config: StorageConfig): Promise<SpanStore> {
  if (config.driver === 'sqlite') {
    const store = new SqliteSpanStore(config.dbPath, config.retentionRows === undefined ? {} : { retentionRows: config.retentionRows })
    await store.init()
    return store
  }
  const clickhouseModuleName = '@apiscope/store-clickhouse'
  const { ClickHouseSpanStore } = (await import(clickhouseModuleName)) as ClickHouseStoreModule
  const store = new ClickHouseSpanStore({
    url: config.url,
    ...(config.username === undefined ? {} : { username: config.username }),
    ...(config.password === undefined ? {} : { password: config.password }),
    ...(config.database === undefined ? {} : { database: config.database }),
    ...(config.retentionDays === undefined ? {} : { retentionDays: config.retentionDays })
  })
  await store.init()
  return store
}
