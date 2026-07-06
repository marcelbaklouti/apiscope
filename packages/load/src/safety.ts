import { lookup } from 'node:dns/promises'

const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

function normalizeIpv4Mapped(address: string): string {
  const mappedPrefix = '::ffff:'
  return address.toLowerCase().startsWith(mappedPrefix) ? address.slice(mappedPrefix.length) : address
}

function isLinkLocalIpv4(address: string): boolean {
  return normalizeIpv4Mapped(address).startsWith('169.254.')
}

async function resolvedAddresses(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true })
  return records.map((record) => record.address)
}

export async function assertAllowedTarget(baseUrl: string, allowRemoteHosts: string[] = []): Promise<void> {
  const parsed = new URL(baseUrl)
  const hostname = parsed.hostname
  if (localHosts.has(hostname)) return
  const addresses = await resolvedAddresses(hostname)
  if (addresses.some(isLinkLocalIpv4)) {
    throw new Error(`load target host "${hostname}" resolves to a link-local address; refusing to target metadata endpoints`)
  }
  if (allowRemoteHosts.includes(hostname)) return
  throw new Error(`load target host "${hostname}" is not localhost; add it to allowRemoteHosts to target it explicitly`)
}
