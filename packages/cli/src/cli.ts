import { existsSync, mkdirSync, realpathSync } from 'node:fs'
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
  type CollectorOptions,
  type DashboardAuthenticator,
  type LiveTransport,
  type Sampler,
  type SpanStore,
  type StorageConfig
} from '@apiscope/collector'
import { createCollectorClient, startHttpServer, startStdioServer } from '@apiscope/mcp'
import { runCi } from './ci'
import { ConfigError, loadConfig, type ApiscopeConfig, type OtlpConfig, type ProductionConfig } from './config'
import { generateScenarioCommand } from './generate-scenario'
import { resolveSecret } from './secrets'

export type CliInvocation =
  | { command: 'dev'; configPath: string | null }
  | { command: 'serve'; configPath: string | null }
  | { command: 'ci'; configPath: string | null; updateBaseline: boolean; jsonPath?: string; junitPath?: string }
  | { command: 'generate-scenario'; configPath: string | null; window: string; baseUrl: string; shape: 'steady' | 'ramp'; out: string }
  | { command: 'mcp'; http: boolean; port: number | null; collectorUrl: string | null }
  | { command: 'help' }

const defaultGenerateScenarioWindow = '5m'
const defaultGenerateScenarioOut = './apiscope.config.ts'

export function parseCliArgs(argv: string[]): CliInvocation {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: 'string' },
      'update-baseline': { type: 'boolean', default: false },
      json: { type: 'string' },
      junit: { type: 'string' },
      window: { type: 'string' },
      'base-url': { type: 'string' },
      shape: { type: 'string' },
      out: { type: 'string' },
      http: { type: 'boolean', default: false },
      port: { type: 'string' },
      collector: { type: 'string' },
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
  if (command === 'generate-scenario') {
    if (values['base-url'] === undefined) return { command: 'help' }
    return {
      command: 'generate-scenario',
      configPath,
      window: values.window ?? defaultGenerateScenarioWindow,
      baseUrl: values['base-url'],
      shape: values.shape === 'ramp' ? 'ramp' : 'steady',
      out: values.out ?? defaultGenerateScenarioOut
    }
  }
  if (command === 'mcp') {
    return {
      command: 'mcp',
      http: values.http === true,
      port: values.port === undefined ? null : Number(values.port),
      collectorUrl: values.collector ?? null
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
  apiscope generate-scenario --base-url <url>   turn observed traffic into a scenario
    --window duration                   how far back to look, e.g. 5m (default 5m)
    --shape steady|ramp                 load shape (default steady)
    --out path                          config file to write (default ./apiscope.config.ts)
  apiscope mcp [--http] [--port n] [--collector url]   run the mcp server for coding agents
    --http                               serve over streamable http instead of stdio
    --port n                             http port (default 0, an ephemeral port)
    --collector url                      collector base url (default from config or APISCOPE_COLLECTOR_URL)
  apiscope --help
`

export async function resolveConfig(configPath: string | null, cwd: string): Promise<ApiscopeConfig> {
  const effectivePath = configPath ?? join(cwd, 'apiscope.config.ts')
  if (configPath === null && !existsSync(effectivePath)) return {}
  return loadConfig(effectivePath)
}

export async function resolveStorage(storage: StorageConfig | undefined): Promise<SpanStore | undefined> {
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

function resolveOtlpOptions(otlp: OtlpConfig | undefined): Pick<CollectorOptions, 'otlpExport' | 'otlpIngest'> {
  const exportConfig = otlp?.export
  const ingestConfig = otlp?.ingest
  return {
    ...(exportConfig === undefined
      ? {}
      : {
          otlpExport: {
            endpoint: exportConfig.endpoint,
            protocol: exportConfig.protocol,
            serviceName: 'apiscope',
            ...(exportConfig.headers === undefined
              ? {}
              : {
                  headers: Object.fromEntries(
                    Object.entries(exportConfig.headers).map(([key, value]) => [key, resolveSecret(value)])
                  )
                })
          }
        }),
    ...(ingestConfig === undefined ? {} : { otlpIngest: ingestConfig })
  }
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
  const otlpOptions = resolveOtlpOptions(config.otlp)
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
    ...otlpOptions,
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

async function resolveCollectorUrl(collectorUrl: string | null, cwd: string): Promise<string> {
  if (collectorUrl !== null) return collectorUrl
  if (process.env.APISCOPE_COLLECTOR_URL !== undefined) return process.env.APISCOPE_COLLECTOR_URL
  const config = await resolveConfig(null, cwd)
  const host = config.collector?.host ?? '127.0.0.1'
  const port = config.collector?.port ?? 4620
  return `http://${host}:${port}`
}

async function runMcp(invocation: Extract<CliInvocation, { command: 'mcp' }>): Promise<void> {
  const collectorUrl = await resolveCollectorUrl(invocation.collectorUrl, process.cwd())
  const client = createCollectorClient(collectorUrl)
  if (invocation.http) {
    const handle = await startHttpServer(client, { port: invocation.port ?? 0 })
    console.log(`apiscope mcp server listening on http://127.0.0.1:${handle.port}`)
    const stop = async () => {
      await handle.close()
      process.exit(0)
    }
    process.on('SIGINT', () => void stop())
    process.on('SIGTERM', () => void stop())
    return
  }
  await startStdioServer(client)
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
    if (invocation.command === 'generate-scenario') {
      await generateScenarioCommand(invocation, process.cwd())
      return
    }
    if (invocation.command === 'mcp') {
      await runMcp(invocation)
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

function invokedAsEntry(): boolean {
  const entry = process.argv[1]
  if (entry === undefined) return false
  try {
    const resolved = realpathSync(entry)
    return resolved.endsWith('cli.js') || resolved.endsWith('cli.cjs')
  } catch {
    return entry.endsWith('cli.js') || entry.endsWith('cli.cjs')
  }
}
if (invokedAsEntry()) void main()
