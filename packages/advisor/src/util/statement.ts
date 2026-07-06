import type { CapturedPayload } from '@apiscope/core'

export function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const target = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return headers[key]
  }
  return undefined
}

export function normalizeStatement(statement: string): string {
  return statement
    .replace(/'[^']*'/g, '?')
    .replace(/"[^"]*"/g, '?')
    .replace(/\$\d+/g, '?')
    .replace(/\b\d+\b/g, '?')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function responseBytes(response: CapturedPayload | undefined): number | null {
  if (response === undefined) return null
  const declared = headerValue(response.headers, 'content-length')
  if (declared !== undefined) {
    const parsed = Number(declared)
    if (Number.isInteger(parsed) && parsed >= 0) return parsed
  }
  if (response.body !== undefined) return Buffer.byteLength(response.body)
  return null
}

export function isTextyContentType(contentType: string | undefined): boolean {
  if (contentType === undefined) return false
  const lower = contentType.toLowerCase()
  return ['json', 'html', 'text', 'javascript', 'css', 'xml'].some((token) => lower.includes(token))
}

export function humanizeBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kilobytes = bytes / 1024
  if (kilobytes < 1024) return `${Math.round(kilobytes)} KB`
  return `${(kilobytes / 1024).toFixed(1)} MB`
}

export function humanizeMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}
