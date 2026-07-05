import { existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  createCollector,
  createDashboardAuthenticator,
  createKeepAllSampler,
  createNoneIngestAuthenticator,
  createTailSampler,
  createTokenIngestAuthenticator,
  createValkeyLiveTransport,
  resolveStore,
  type DashboardAuthenticator,
  type LiveTransport,
  type Sampler,
  type SpanStore,
  type StorageConfig
} from '@apiscope/collector'
import { runCi } from './ci'
import { ConfigError, loadConfig, type ApiscopeConfig, type ProductionConfig } from './config'
import { resolveSecret } from './secrets'

export type CliInvocation =
  | { command: 'dev'; configPath: string | null }
  | { command: 'serve'; configPath: string | null }
  | { command: 'ci'; configPath: string | null; updateBaseline: boolean; jsonPath?: string; junitPath?: string }
  | { command: 'help' }

export function parseCliArgs(argv: string[]): CliInvocation {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: 'string' },
      'update-baseline': { type: 'boolean', default: false },
      json: { type: 'string' },
      junit: { type: 'string' },
      help: { type: 'boolean', default: false }
    }
  })
  if (values.help) return { command: 'help' }
  const command = positionals[0] ?? 'dev'
  const configPath = values.config ?? null
  if (command === 'dev') return { command: 'dev', configPath }
  if (command === 'serve') return { command: 'serve', configPath }
  if (command === 'ci') {
    return {
      command: 'ci',
      configPath,
      updateBaseline: values['update-baseline'] === true,
      ...(values.json === undefined ? {} : { jsonPath: values.json }),
      ...(values.junit === undefined ? {} : { junitPath: values.junit })
    }
  }
  return { command: 'help' }
}

const helpText = `apiscope

usage:
  apiscope [dev] [--config path]        start collector and dashboard
  apiscope serve [--config path]        start the production collector
  apiscope ci [--config path]           run scenarios, budgets and diffs
    --update-baseline                   write a new baseline instead of checking
    --json path                         write a json report
    --junit path                        write a junit xml report
  apiscope --help
`

async function resolveConfig(configPath: string | null, cwd: string): Promise<ApiscopeConfig> {
  const effectivePath = configPath ?? join(cwd, 'apiscope.config.ts')
  if (configPath === null && !existsSync(effectivePath)) return {}
  return loadConfig(effectivePath)
}

async function resolveStorage(storage: StorageConfig | undefined): Promise<SpanStore | undefined> {
  if (storage === undefined) return undefined
  if (storage.driver === 'sqlite') return resolveStore(storage)
  return resolveStore({
    driver: 'clickhouse',
    url: resolveSecret(storage.url),
    ...(storage.username === undefined ? {} : { username: resolveSecret(storage.username) }),
    ...(storage.password === undefined ? {} : { password: resolveSecret(storage.password) }),
    ...(storage.database === undefined ? {} : { database: storage.database }),
    ...(storage.retentionDays === undefined ? {} : { retentionDays: storage.retentionDays })
  })
}

async function resolveDashboardAuth(production: ProductionConfig | undefined): Promise<DashboardAuthenticator | undefined> {
  const dashboardAuth = production?.dashboardAuth
  if (dashboardAuth === undefined) return undefined
  if (dashboardAuth.mode === 'none') return createDashboardAuthenticator({ mode: 'none' })
  if (dashboardAuth.mode === 'proxy') return createDashboardAuthenticator(dashboardAuth)
  if (dashboardAuth.mode === 'password') {
    return createDashboardAuthenticator({
      mode: 'password',
      sessionSecret: resolveSecret(dashboardAuth.sessionSecret),
      users: dashboardAuth.users.map((user) => ({
        username: resolveSecret(user.username),
        passwordHash: resolveSecret(user.passwordHash),
        ...(user.displayName === undefined ? {} : { displayName: user.displayName })
      }))
    })
  }
  return createDashboardAuthenticator({
    mode: 'oidc',
    sessionSecret: resolveSecret(dashboardAuth.sessionSecret),
    issuer: dashboardAuth.issuer,
    clientId: dashboardAuth.clientId,
    clientSecret: resolveSecret(dashboardAuth.clientSecret),
    redirectUri: dashboardAuth.redirectUri
  })
}

async function resolveLiveTransport(production: ProductionConfig | undefined): Promise<LiveTransport | undefined> {
  const liveTransport = production?.liveTransport
  if (liveTransport === undefined || liveTransport.mode === 'memory') return undefined
  return createValkeyLiveTransport({
    url: resolveSecret(liveTransport.url),
    ...(liveTransport.channel === undefined ? {} : { channel: liveTransport.channel })
  })
}

function resolveSampler(production: ProductionConfig | undefined): Sampler | undefined {
  const sampling = production?.sampling
  if (sampling === undefined || sampling.mode === 'keep-all') return undefined
  return createTailSampler({
    baseProbability: sampling.baseProbability ?? 0,
    ...(sampling.outlierQuantile === undefined ? {} : { outlierQuantile: sampling.outlierQuantile })
  })
}

interface StartCollectorServerOptions {
  defaultHost: string
  announce: 'dev' | 'prod'
}

async function startCollectorServer(configPath: string | null, options: StartCollectorServerOptions): Promise<void> {
  const cwd = process.cwd()
  const config = await resolveConfig(configPath, cwd)
  const dbPath = config.collector?.dbPath ?? join(cwd, '.apiscope', 'apiscope.db')
  let dashboardDir: string | undefined
  try {
    const require = createRequire(import.meta.url)
    dashboardDir = join(dirname(require.resolve('@apiscope/dashboard/package.json')), 'dist')
  } catch {
    console.log('dashboard package not found; api only')
  }
  const storage = config.collector?.storage
  const store = await resolveStorage(storage)
  if (storage === undefined) mkdirSync(dirname(dbPath), { recursive: true })
  const production = config.production
  const ingestAuthConfig = production?.ingestAuth
  const ingestAuth =
    ingestAuthConfig === undefined || ingestAuthConfig.mode === 'none'
      ? createNoneIngestAuthenticator()
      : createTokenIngestAuthenticator(ingestAuthConfig.tokens.map((entry) => ({ appName: entry.appName, token: resolveSecret(entry.token) })))
  const dashboardAuth = await resolveDashboardAuth(production)
  const hub = await resolveLiveTransport(production)
  const sampler = resolveSampler(production) ?? createKeepAllSampler()
  const tlsConfig = production?.tls
  const tls =
    tlsConfig === undefined
      ? undefined
      : {
          key: resolveSecret(tlsConfig.key),
          cert: resolveSecret(tlsConfig.cert),
          ...(tlsConfig.ca === undefined ? {} : { ca: resolveSecret(tlsConfig.ca) }),
          ...(tlsConfig.requestCert === undefined ? {} : { requestCert: tlsConfig.requestCert })
        }
  const collector = createCollector({
    dbPath,
    host: config.collector?.host ?? options.defaultHost,
    port: config.collector?.port ?? 4620,
    ...(config.collector?.retentionRows === undefined ? {} : { retentionRows: config.collector.retentionRows }),
    ...(dashboardDir === undefined ? {} : { dashboardDir }),
    ...(store === undefined ? {} : { store }),
    ingestAuth,
    ...(dashboardAuth === undefined ? {} : { dashboardAuth }),
    ...(hub === undefined ? {} : { hub }),
    sampler,
    ...(tls === undefined ? {} : { tls }),
    ...(production?.allowInsecure === undefined ? {} : { allowInsecure: production.allowInsecure }),
    meta: config
  })
  const address = await collector.listen()
  if (collector.store.recoveredFromCorruption) {
    console.log('warning: previous database was corrupt and has been rotated away')
  }
  if (options.announce === 'dev') {
    console.log(`apiscope collector listening on ws://${address.host}:${address.port}`)
    console.log(`dashboard: http://${address.host}:${address.port}`)
  } else {
    console.log(`apiscope collector serving on ${address.host}:${address.port}`)
  }
  const stop = async () => {
    await collector.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void stop())
  process.on('SIGTERM', () => void stop())
}

async function runDev(configPath: string | null): Promise<void> {
  await startCollectorServer(configPath, { defaultHost: '127.0.0.1', announce: 'dev' })
}

async function runServe(configPath: string | null): Promise<void> {
  await startCollectorServer(configPath, { defaultHost: '0.0.0.0', announce: 'prod' })
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const invocation = parseCliArgs(argv)
  if (invocation.command === 'help') {
    console.log(helpText)
    return
  }
  try {
    if (invocation.command === 'dev') {
      await runDev(invocation.configPath)
      return
    }
    if (invocation.command === 'serve') {
      await runServe(invocation.configPath)
      return
    }
    const cwd = process.cwd()
    const config = await resolveConfig(invocation.configPath, cwd)
    const run = await runCi({
      config,
      cwd,
      updateBaseline: invocation.updateBaseline,
      ...(invocation.jsonPath === undefined ? {} : { jsonPath: invocation.jsonPath }),
      ...(invocation.junitPath === undefined ? {} : { junitPath: invocation.junitPath })
    })
    process.exitCode = run.exitCode
  } catch (error) {
    console.error(error instanceof ConfigError ? error.message : error)
    process.exitCode = 2
  }
}

const invokedDirectly = process.argv[1]?.endsWith('cli.js') === true || process.argv[1]?.endsWith('cli.cjs') === true
if (invokedDirectly) void main()
