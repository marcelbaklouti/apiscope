export const PROTOCOL_VERSION = 1
export const BODY_CAPTURE_LIMIT_BYTES = 65536
export const BATCH_FLUSH_INTERVAL_MS = 250
export const BATCH_FLUSH_THRESHOLD = 50
export const MAX_SPANS_PER_MESSAGE = 10000
export const MAX_ROUTES_PER_MESSAGE = 10000
export const DEFAULT_REDACTED_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'x-api-key'
] as const
