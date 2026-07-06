import { readFileSync } from 'node:fs'

export function resolveSecret(ref: string): string {
  if (ref.startsWith('env:')) {
    const name = ref.slice(4)
    const value = process.env[name]
    if (value === undefined) throw new Error(`secret env var ${name} is not set`)
    return value
  }
  if (ref.startsWith('file:')) {
    return readFileSync(ref.slice(5), 'utf8').trim()
  }
  console.warn('apiscope: a secret is configured as a plaintext literal in apiscope.config.ts; prefer env: or file: references')
  return ref
}

export function resolveSecretList(refs: string[]): string[] {
  return refs.map((ref) => resolveSecret(ref))
}
