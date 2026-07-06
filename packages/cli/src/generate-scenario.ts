import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { RequestSpan } from '@apiscope/core'
import { generateScenario, type GeneratedScenario } from '@apiscope/load'
import { resolveConfig, resolveStorage } from './cli'

const localCollectorScenarioUrl = 'http://127.0.0.1:4620/api/scenario'
const durationUnitMs: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000 }

export function parseDurationMs(value: string): number {
  const match = value.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/)
  if (match === null) throw new Error(`invalid duration: ${value}`)
  const amount = Number(match[1])
  const unit = match[2] ?? 'ms'
  return amount * (durationUnitMs[unit] ?? 1)
}

async function fetchFromRunningCollector(windowMs: number, baseUrl: string, shape: 'steady' | 'ramp'): Promise<GeneratedScenario | null> {
  const query = new URLSearchParams({ windowMs: String(windowMs), baseUrl, shape })
  try {
    const response = await fetch(`${localCollectorScenarioUrl}?${query.toString()}`)
    if (!response.ok) return null
    return (await response.json()) as GeneratedScenario
  } catch {
    return null
  }
}

async function generateFromConfiguredStore(
  configPath: string | null,
  cwd: string,
  windowMs: number,
  baseUrl: string,
  shape: 'steady' | 'ramp'
): Promise<GeneratedScenario> {
  const config = await resolveConfig(configPath, cwd)
  const store = await resolveStorage(config.collector?.storage)
  if (store === undefined) throw new Error('no collector is running and no collector.storage is configured')
  await store.init()
  try {
    const recentSpans: RequestSpan[] = await store.recentSpans(1000)
    const cutoff = Date.now() - windowMs
    const spansInWindow = recentSpans.filter((span) => span.timing.start >= cutoff)
    return generateScenario({ spans: spansInWindow, baseUrl, shape })
  } finally {
    await store.close()
  }
}

export function scenarioConfigModule(generated: GeneratedScenario): string {
  const scenarioJson = JSON.stringify(generated.scenario, null, 2)
  const assertionsJson = JSON.stringify(
    { p95MaxMs: generated.assertions.p95MaxMs, errorRateMax: generated.assertions.errorRateMax },
    null,
    2
  )
  return `import { defineConfig } from 'apiscope'

export default defineConfig({
  ci: {
    readiness: { url: '${generated.scenario.baseUrl}/health' },
    scenarios: [
      {
        scenario: ${scenarioJson},
        assertions: ${assertionsJson}
      }
    ]
  }
})
`
}

export interface GenerateScenarioCommandInput {
  configPath: string | null
  window: string
  baseUrl: string
  shape: 'steady' | 'ramp'
  out: string
}

export async function generateScenarioCommand(input: GenerateScenarioCommandInput, cwd: string): Promise<void> {
  const windowMs = parseDurationMs(input.window)
  const fromCollector = await fetchFromRunningCollector(windowMs, input.baseUrl, input.shape)
  const generated = fromCollector ?? (await generateFromConfiguredStore(input.configPath, cwd, windowMs, input.baseUrl, input.shape))
  const outPath = resolve(cwd, input.out)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, scenarioConfigModule(generated))
  console.log(`wrote ${outPath} (${generated.observed.totalRequests} requests observed, ${generated.scenario.targets.length} targets)`)
}
