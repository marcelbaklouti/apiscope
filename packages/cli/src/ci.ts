import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createCollector } from '@apiscope/collector'
import { evaluateAssertions, runLoadTest, type LoadRunResult } from '@apiscope/load'
import {
  baselineFromResults,
  detectRouteDrift,
  diffAgainstBaseline,
  readBaseline,
  writeBaseline,
  type BaselineFile
} from './baseline'
import type { ApiscopeConfig } from './config'
import {
  renderGithubAnnotations,
  renderJUnitReport,
  renderJsonReport,
  renderTerminalReport,
  reportHasFailures,
  type CiReportInput,
  type CiScenarioOutcome
} from './report'

export interface CiOptions {
  config: ApiscopeConfig
  cwd: string
  updateBaseline?: boolean
  jsonPath?: string
  junitPath?: string
  emitGithubAnnotations?: boolean
  log?: (line: string) => void
}

export interface CiRun {
  exitCode: 0 | 1 | 2
  reportText: string
}

export async function waitForReadiness(url: string, timeoutMs: number, intervalMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.status < 500) return true
    } catch {}
    await new Promise((resolveSleep) => setTimeout(resolveSleep, intervalMs))
  }
  return false
}

function writeFileEnsured(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

export async function runCi(options: CiOptions): Promise<CiRun> {
  const log = options.log ?? ((line: string) => console.log(line))
  const ci = options.config.ci
  if (ci === undefined) {
    const message = 'no ci section in apiscope config'
    log(message)
    return { exitCode: 2, reportText: message }
  }
  const ready = await waitForReadiness(ci.readiness.url, ci.readiness.timeoutMs ?? 60000, ci.readiness.intervalMs ?? 500)
  if (!ready) {
    const message = `target not ready: ${ci.readiness.url}`
    log(message)
    return { exitCode: 2, reportText: message }
  }
  const dbPath = join(options.cwd, '.apiscope', `ci-${process.pid}-${randomUUID()}.db`)
  mkdirSync(dirname(dbPath), { recursive: true })
  const collector = createCollector({ dbPath, port: 0 })
  const address = await collector.listen()
  log(`APISCOPE_COLLECTOR_URL=ws://${address.host}:${address.port}`)
  try {
    const scenarios: CiScenarioOutcome[] = []
    const results: Array<{ name: string; result: LoadRunResult }> = []
    for (const entry of ci.scenarios) {
      log(`running scenario ${entry.scenario.name}`)
      const result = await runLoadTest(entry.scenario)
      await collector.store.insertLoadRun({
        id: randomUUID(),
        name: entry.scenario.name,
        startedAt: Date.now(),
        scenarioJson: JSON.stringify(entry.scenario),
        resultJson: JSON.stringify(result)
      })
      results.push({ name: entry.scenario.name, result })
      scenarios.push({ name: entry.scenario.name, result, assertionOutcomes: [], diffOutcomes: [] })
    }
    const currentRoutes = (await collector.store.listRoutes()).map((route) => ({
      appName: route.appName,
      method: route.method,
      pattern: route.pattern
    }))
    const baselinePath = ci.baselinePath === undefined ? null : resolve(options.cwd, ci.baselinePath)

    if (options.updateBaseline === true) {
      if (baselinePath === null) {
        const message = 'updateBaseline requires ci.baselinePath'
        log(message)
        return { exitCode: 2, reportText: message }
      }
      writeBaseline(baselinePath, baselineFromResults(results, currentRoutes))
      const message = `baseline written to ${baselinePath}`
      log(message)
      return { exitCode: 0, reportText: message }
    }

    const baseline: BaselineFile | null = baselinePath === null ? null : readBaseline(baselinePath)
    for (const scenario of scenarios) {
      const entry = ci.scenarios.find((candidate) => candidate.scenario.name === scenario.name)
      scenario.assertionOutcomes = evaluateAssertions(scenario.result, entry?.assertions ?? {})
      scenario.diffOutcomes =
        baseline === null ? [] : diffAgainstBaseline(scenario.name, scenario.result, baseline, ci.tolerances ?? {})
    }
    const reportInput: CiReportInput = {
      scenarios,
      routeDrift: baseline === null ? null : detectRouteDrift(baseline, currentRoutes),
      failOnRouteDrift: ci.failOnRouteDrift ?? false
    }
    const reportText = renderTerminalReport(reportInput)
    log(reportText)
    if (options.jsonPath !== undefined) writeFileEnsured(resolve(options.cwd, options.jsonPath), renderJsonReport(reportInput))
    if (options.junitPath !== undefined) writeFileEnsured(resolve(options.cwd, options.junitPath), renderJUnitReport(reportInput))
    if (options.emitGithubAnnotations === true || process.env.GITHUB_ACTIONS === 'true') {
      for (const annotation of renderGithubAnnotations(reportInput)) log(annotation)
    }
    return { exitCode: reportHasFailures(reportInput) ? 1 : 0, reportText }
  } catch (error) {
    const message = `ci run failed: ${error instanceof Error ? error.message : String(error)}`
    log(message)
    return { exitCode: 2, reportText: message }
  } finally {
    await collector.close()
  }
}
