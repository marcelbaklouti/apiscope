import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPendingStateStore } from '../src/auth/pending-state'

afterEach(() => {
  vi.useRealTimers()
})

describe('pending state store', () => {
  it('evicts entries older than the ttl', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const store = createPendingStateStore<{ verifier: string }>({ ttlMs: 1000, maxEntries: 100 })
    store.set('state-a', { verifier: 'a' })
    vi.setSystemTime(1500)
    expect(store.get('state-a')).toBeUndefined()
  })

  it('keeps entries within the ttl', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const store = createPendingStateStore<{ verifier: string }>({ ttlMs: 1000, maxEntries: 100 })
    store.set('state-a', { verifier: 'a' })
    vi.setSystemTime(500)
    expect(store.get('state-a')).toEqual({ verifier: 'a' })
  })

  it('deletes an entry once consumed', () => {
    const store = createPendingStateStore<{ verifier: string }>({ ttlMs: 60_000, maxEntries: 100 })
    store.set('state-a', { verifier: 'a' })
    store.delete('state-a')
    expect(store.get('state-a')).toBeUndefined()
  })

  it('never grows past maxEntries even under a sustained burst of new state values', () => {
    const store = createPendingStateStore<{ verifier: string }>({ ttlMs: 60_000, maxEntries: 5 })
    for (let index = 0; index < 1000; index += 1) {
      store.set(`state-${index}`, { verifier: `v${index}` })
    }
    expect(store.size()).toBeLessThanOrEqual(5)
  })

  it('evicts the oldest entry first once at capacity', () => {
    const store = createPendingStateStore<{ verifier: string }>({ ttlMs: 60_000, maxEntries: 2 })
    store.set('first', { verifier: '1' })
    store.set('second', { verifier: '2' })
    store.set('third', { verifier: '3' })
    expect(store.get('first')).toBeUndefined()
    expect(store.get('second')).toEqual({ verifier: '2' })
    expect(store.get('third')).toEqual({ verifier: '3' })
  })
})
