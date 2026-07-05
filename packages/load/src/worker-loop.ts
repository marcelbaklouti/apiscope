import { monitorEventLoopDelay } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import { Pool } from 'undici'
import type { Dispatcher } from 'undici'
import type { LoadTarget, SampleEntry, WorkerInput, WorkerMessage } from './types'

interface PreparedRequest {
  method: string
  path: string
  headers?: Record<string, string>
  body?: string
}

interface Hooks {
  setup?(): Promise<void> | void
  beforeRequest?(
    request: PreparedRequest,
    context: { targetIndex: number; iteration: number; workerIndex: number }
  ): PreparedRequest | void | Promise<PreparedRequest | void>
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}

function buildTargetPicker(targets: LoadTarget[]): () => number {
  const cumulative: number[] = []
  let total = 0
  for (const target of targets) {
    total += target.weight ?? 1
    cumulative.push(total)
  }
  return () => {
    const roll = Math.random() * total
    for (let index = 0; index < cumulative.length; index += 1) {
      if (roll < cumulative[index]!) return index
    }
    return cumulative.length - 1
  }
}

async function loadHooks(hooksModule: string | undefined): Promise<Hooks> {
  if (hooksModule === undefined) return {}
  const imported = (await import(pathToFileURL(hooksModule).href)) as Hooks
  if (imported.setup !== undefined) await imported.setup()
  return imported
}

export async function runWorkerLoop(input: WorkerInput, emit: (message: WorkerMessage) => void): Promise<void> {
  const { scenario, workerIndex, workerCount } = input
  const hooks = await loadHooks(scenario.hooksModule)
  const pool = new Pool(scenario.baseUrl, { connections: 128 })
  const lagMonitor = monitorEventLoopDelay({ resolution: 10 })
  lagMonitor.enable()
  const pickTarget = buildTargetPicker(scenario.targets)
  const warmupMs = scenario.warmupMs ?? 0
  const startedAt = performance.now()
  const warmupEndsAt = startedAt + warmupMs

  let pendingSamples: SampleEntry[] = []
  let attempted = 0
  let maxScheduleDeviationMs = 0
  let iteration = 0
  const inFlight = new Set<Promise<void>>()

  const flush = () => {
    if (pendingSamples.length === 0) return
    emit({ type: 'samples', entries: pendingSamples })
    pendingSamples = []
  }
  const flushTimer = setInterval(flush, 250)
  flushTimer.unref?.()

  const record = (sample: SampleEntry, completedAt: number) => {
    if (completedAt < warmupEndsAt) return
    pendingSamples.push(sample)
    if (pendingSamples.length >= 500) flush()
  }

  const fire = async (targetIndex: number, intendedAt: number): Promise<void> => {
    attempted += 1
    const currentIteration = iteration
    iteration += 1
    const target = scenario.targets[targetIndex]!
    let prepared: PreparedRequest = {
      method: target.method,
      path: target.path,
      ...(target.headers === undefined ? {} : { headers: target.headers }),
      ...(target.body === undefined ? {} : { body: target.body })
    }
    try {
      if (hooks.beforeRequest !== undefined) {
        const replaced = await hooks.beforeRequest(prepared, {
          targetIndex,
          iteration: currentIteration,
          workerIndex
        })
        if (replaced !== undefined) prepared = replaced
      }
      const response = await pool.request({
        method: prepared.method as Dispatcher.HttpMethod,
        path: prepared.path,
        ...(prepared.headers === undefined ? {} : { headers: prepared.headers }),
        ...(prepared.body === undefined ? {} : { body: prepared.body })
      })
      await response.body.dump()
      const completedAt = performance.now()
      record({ latencyMs: completedAt - intendedAt, statusCode: response.statusCode, targetIndex }, completedAt)
    } catch (error) {
      const completedAt = performance.now()
      record(
        {
          latencyMs: completedAt - intendedAt,
          statusCode: 0,
          targetIndex,
          errorMessage: error instanceof Error ? error.message : String(error)
        },
        completedAt
      )
    }
  }

  const launch = (targetIndex: number, intendedAt: number): void => {
    const work = fire(targetIndex, intendedAt).finally(() => inFlight.delete(work))
    inFlight.add(work)
  }

  if (scenario.model.kind === 'open') {
    let nextIntendedAt = startedAt
    for (const phase of scenario.model.phases) {
      const phaseRps = phase.rps / workerCount
      const intervalMs = phaseRps <= 0 ? phase.durationMs : 1000 / phaseRps
      const phaseEndsAt = nextIntendedAt + phase.durationMs
      while (nextIntendedAt < phaseEndsAt) {
        const now = performance.now()
        if (now < nextIntendedAt) await sleep(nextIntendedAt - now)
        const sendTime = performance.now()
        maxScheduleDeviationMs = Math.max(maxScheduleDeviationMs, sendTime - nextIntendedAt)
        launch(pickTarget(), nextIntendedAt)
        nextIntendedAt += intervalMs
      }
    }
    await Promise.allSettled([...inFlight])
  } else {
    const loops = Math.max(1, Math.ceil(scenario.model.concurrency / workerCount))
    const deadline = startedAt + scenario.model.durationMs
    const loop = async (): Promise<void> => {
      while (performance.now() < deadline) {
        const intendedAt = performance.now()
        await fire(pickTarget(), intendedAt)
      }
    }
    await Promise.allSettled(Array.from({ length: loops }, () => loop()))
  }

  clearInterval(flushTimer)
  flush()
  lagMonitor.disable()
  await pool.close()
  emit({
    type: 'done',
    eventLoopLagP99Ms: lagMonitor.percentile(99) / 1_000_000,
    maxScheduleDeviationMs,
    attempted
  })
}
