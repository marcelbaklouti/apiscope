import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

export interface FrameworkHint {
  name: string
  adapterPackage: string
  install: string
  snippet: string
}

interface PackageManifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const nextSnippet = `import { withApiscope } from '@apiscope/next'

const apiscope = withApiscope({ appName: 'web' })
export const register = apiscope.register
export const onRequestError = apiscope.onRequestError`

const nestjsSnippet = `import { ApiscopeModule } from '@apiscope/nestjs'

@Module({ imports: [ApiscopeModule.forRoot({ appName: 'api' })] })
export class AppModule {}`

const fastifySnippet = `import { apiscopeFastify } from '@apiscope/fastify'

await app.register(apiscopeFastify, { appName: 'api' })`

const expressSnippet = `import { apiscopeExpress } from '@apiscope/express'

app.use(apiscopeExpress({ appName: 'api' }))`

const honoSnippet = `import { apiscopeHono } from '@apiscope/hono'

apiscopeHono(app, { appName: 'edge-api' })`

const frameworkDetectors: Array<{ dependencyName: string; hint: FrameworkHint }> = [
  {
    dependencyName: 'next',
    hint: { name: 'Next.js', adapterPackage: '@apiscope/next', install: 'npm i -D @apiscope/next', snippet: nextSnippet }
  },
  {
    dependencyName: '@nestjs/core',
    hint: { name: 'NestJS', adapterPackage: '@apiscope/nestjs', install: 'npm i -D @apiscope/nestjs', snippet: nestjsSnippet }
  },
  {
    dependencyName: 'fastify',
    hint: { name: 'Fastify', adapterPackage: '@apiscope/fastify', install: 'npm i -D @apiscope/fastify', snippet: fastifySnippet }
  },
  {
    dependencyName: 'express',
    hint: { name: 'Express', adapterPackage: '@apiscope/express', install: 'npm i -D @apiscope/express', snippet: expressSnippet }
  },
  {
    dependencyName: 'hono',
    hint: { name: 'Hono', adapterPackage: '@apiscope/hono', install: 'npm i -D @apiscope/hono', snippet: honoSnippet }
  }
]

function readPackageManifest(cwd: string): PackageManifest | undefined {
  try {
    const raw = readFileSync(join(cwd, 'package.json'), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    return parsed as PackageManifest
  } catch {
    return undefined
  }
}

function mergedDependencyNames(manifest: PackageManifest): Set<string> {
  return new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})])
}

export function detectFramework(cwd: string): FrameworkHint | undefined {
  const manifest = readPackageManifest(cwd)
  if (manifest === undefined) return undefined
  const dependencyNames = mergedDependencyNames(manifest)
  for (const detector of frameworkDetectors) {
    if (dependencyNames.has(detector.dependencyName)) return detector.hint
  }
  return undefined
}

export function alreadyInstrumented(cwd: string, hint: FrameworkHint): boolean {
  const manifest = readPackageManifest(cwd)
  if (manifest === undefined) return false
  return mergedDependencyNames(manifest).has(hint.adapterPackage)
}

export function openBrowser(url: string): void {
  try {
    const platform = process.platform
    const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open'
    const args = platform === 'darwin' ? [url] : platform === 'win32' ? ['/c', 'start', '""', url] : [url]
    const child = spawn(command, args, { stdio: 'ignore', detached: true })
    child.unref()
  } catch {}
}

export function shouldOpenBrowser(open: boolean): boolean {
  if (!open) return false
  if (process.env.CI !== undefined) return false
  return process.stdout.isTTY === true
}
