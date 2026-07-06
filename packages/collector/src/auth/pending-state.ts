export interface PendingStateStoreOptions {
  ttlMs: number
  maxEntries: number
}

export interface PendingStateStore<T> {
  set(key: string, value: T): void
  get(key: string): T | undefined
  delete(key: string): void
  size(): number
}

interface Entry<T> {
  value: T
  createdAt: number
}

export function createPendingStateStore<T>(options: PendingStateStoreOptions): PendingStateStore<T> {
  const entries = new Map<string, Entry<T>>()

  function evictExpired(): void {
    const now = Date.now()
    for (const [key, entry] of entries) {
      if (now - entry.createdAt > options.ttlMs) entries.delete(key)
    }
  }

  function evictOldestUntilWithinCapacity(): void {
    while (entries.size >= options.maxEntries) {
      const oldestKey = entries.keys().next().value
      if (oldestKey === undefined) return
      entries.delete(oldestKey)
    }
  }

  return {
    set(key, value) {
      evictExpired()
      evictOldestUntilWithinCapacity()
      entries.set(key, { value, createdAt: Date.now() })
    },
    get(key) {
      evictExpired()
      return entries.get(key)?.value
    },
    delete(key) {
      entries.delete(key)
    },
    size() {
      return entries.size
    }
  }
}
