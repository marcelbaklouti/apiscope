import type { LookupAddress } from 'node:dns'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn()
}))

const dns = await import('node:dns/promises')
const { assertAllowedTarget } = await import('../src/safety')
const lookupMock = vi.mocked(dns.lookup)

function resolveTo(addresses: LookupAddress[]): void {
  lookupMock.mockResolvedValue(addresses as never)
}

afterEach(() => {
  lookupMock.mockReset()
})

describe('assertAllowedTarget dns resolution', () => {
  it('allows an allowlisted host that resolves to a public address', async () => {
    resolveTo([{ address: '93.184.216.34', family: 4 }])
    await expect(assertAllowedTarget('https://staging.example.com', ['staging.example.com'])).resolves.toBeUndefined()
  })

  it('rejects an allowlisted host that resolves to link-local metadata', async () => {
    resolveTo([{ address: '169.254.169.254', family: 4 }])
    await expect(assertAllowedTarget('https://metadata.internal', ['metadata.internal'])).rejects.toThrow(/link-local/)
  })

  it('does not resolve loopback literals', async () => {
    await expect(assertAllowedTarget('http://127.0.0.1:3000')).resolves.toBeUndefined()
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('fails closed when resolution errors for a non-loopback host', async () => {
    lookupMock.mockRejectedValue(new Error('ENOTFOUND'))
    await expect(assertAllowedTarget('https://staging.example.com', ['staging.example.com'])).rejects.toThrow()
  })

  it('rejects an IPv4-mapped link-local address', async () => {
    resolveTo([{ address: '::ffff:169.254.169.254', family: 6 }])
    await expect(assertAllowedTarget('https://metadata.internal', ['metadata.internal'])).rejects.toThrow(/link-local/)
  })
})
