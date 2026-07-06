import { Worker } from 'node:worker_threads'
import { newTraceId } from '@apiscope/core'
import { RunAggregator } from './aggregator'
import { assertAllowedTarget } from './safety'
import { runWorkerLoop } from './worker-loop'
import type { LoadRunResult, LoadScenario, WorkerMessage } from './types'

export interface RunCallbacks {
  onProgress?(snapshot: { totalRequests: number; errorCount: number; latencyP95: number }): void
}

function handleMessage(
  message: WorkerMessage,
  aggregator: RunAggregator,
  callbacks: RunCallbacks,
  state: { fatal: string | null; lastWindowAllErrors: boolean }
): void {
  if (message.type === 'samples') {
    aggregator.addSamples(message.entries)
    state.lastWindowAllErrors =
      message.entries.length > 0 && message.entries.every((entry) => entry.statusCode === 0)
    callbacks.onProgress?.(aggregator.snapshot())
    return
  }
  if (message.type === 'done') {
    aggregator.addWorkerHealth(message)
    return
  }
  state.fatal = message.message
}

export async function runLoadTestInProcess(
  scenario: LoadScenario,
  callbacks: RunCallbacks = {}
): Promise<LoadRunResult> {
  await assertAllowedTarget(scenario.baseUrl, scenario.allowRemoteHosts)
  const runId = newTraceId().slice(0, 16)
  const aggregator = new RunAggregator(scenario, runId)
  const state = { fatal: null as string | null, lastWindowAllErrors: false }
  const startedAt = performance.now()
  await runWorkerLoop({ scenario, workerIndex: 0, workerCount: 1, runId }, (message) =>
    handleMessage(message, aggregator, callbacks, state)
  )
  return aggregator.finish({
    aborted: state.fatal !== null || state.lastWindowAllErrors,
    degraded: false,
    durationMs: performance.now() - startedAt
  })
}

export async function runLoadTest(scenario: LoadScenario, callbacks: RunCallbacks = {}): Promise<LoadRunResult> {
  await assertAllowedTarget(scenario.baseUrl, scenario.allowRemoteHosts)
  const workerCount = Math.max(1, scenario.workers ?? 1)
  const runId = newTraceId().slice(0, 16)
  const aggregator = new RunAggregator(scenario, runId)
  const state = { fatal: null as string | null, lastWindowAllErrors: false }
  const startedAt = performance.now()
  let degraded = false

  const spawnWorker = (workerIndex: number, allowRestart: boolean): Promise<void> =>
    new Promise((resolve) => {
      const worker = new Worker(new URL('./worker.js', import.meta.url), {
        workerData: { scenario, workerIndex, workerCount, runId }
      })
      worker.on('message', (message: WorkerMessage) => handleMessage(message, aggregator, callbacks, state))
      worker.on('error', () => {
        degraded = true
        if (allowRestart) void spawnWorker(workerIndex, false).then(resolve)
        else resolve()
      })
      worker.on('exit', () => resolve())
    })

  await Promise.all(Array.from({ length: workerCount }, (unused, index) => spawnWorker(index, true)))
  return aggregator.finish({
    aborted: state.fatal !== null || state.lastWindowAllErrors,
    degraded,
    durationMs: performance.now() - startedAt
  })
}
