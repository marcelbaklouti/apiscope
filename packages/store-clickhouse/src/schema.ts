export function schemaStatements(database: string, retentionDays: number): string[] {
  return [
    `CREATE DATABASE IF NOT EXISTS ${database}`,
    `CREATE TABLE IF NOT EXISTS ${database}.spans (
      id String,
      trace_id String,
      method String,
      route_pattern Nullable(String),
      actual_path String,
      status_code UInt16,
      start_time Float64,
      ttfb Nullable(Float64),
      duration Float64,
      framework String,
      runtime String,
      error_json Nullable(String),
      request_json Nullable(String),
      response_json Nullable(String),
      app_name String,
      inserted_at DateTime DEFAULT now()
    ) ENGINE = MergeTree
    PARTITION BY toDate(fromUnixTimestamp64Milli(toInt64(start_time)))
    ORDER BY (app_name, route_pattern, method, start_time, id)
    TTL toDate(fromUnixTimestamp64Milli(toInt64(start_time))) + INTERVAL ${retentionDays} DAY`,
    `CREATE TABLE IF NOT EXISTS ${database}.child_spans (
      id String,
      parent_span_id String,
      trace_id String,
      kind String,
      url String,
      method String,
      status_code Nullable(UInt16),
      start_time Float64,
      ttfb Nullable(Float64),
      duration Float64,
      error_json Nullable(String),
      inserted_at DateTime DEFAULT now()
    ) ENGINE = MergeTree
    PARTITION BY toDate(fromUnixTimestamp64Milli(toInt64(start_time)))
    ORDER BY (parent_span_id, start_time, id)
    TTL toDate(fromUnixTimestamp64Milli(toInt64(start_time))) + INTERVAL ${retentionDays} DAY`,
    `CREATE TABLE IF NOT EXISTS ${database}.routes (
      app_name String,
      method String,
      pattern String,
      source_file Nullable(String),
      updated_at DateTime DEFAULT now()
    ) ENGINE = ReplacingMergeTree(updated_at)
    ORDER BY (app_name, method, pattern)`,
    `CREATE TABLE IF NOT EXISTS ${database}.load_runs (
      id String,
      name String,
      started_at Int64,
      scenario_json String,
      result_json String
    ) ENGINE = MergeTree
    ORDER BY (started_at, id)`
  ]
}
