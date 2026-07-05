const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

export function assertAllowedTarget(baseUrl: string, allowRemoteHosts: string[] = []): void {
  const parsed = new URL(baseUrl)
  const hostname = parsed.hostname
  if (localHosts.has(hostname)) return
  if (allowRemoteHosts.includes(hostname)) return
  throw new Error(
    `load target host "${hostname}" is not localhost; add it to allowRemoteHosts to target it explicitly`
  )
}
