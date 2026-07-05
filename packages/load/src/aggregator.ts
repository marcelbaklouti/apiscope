import { build, type Histogram } from 'hdr-histogram-js'
import type { LoadRunResult, LoadScenario, SampleEntry, WorkerDoneMessage } from './types'

function createHistogram(): Histogram {
  return build({
    lowestDiscernibleValue: 1,
    highestTrackableValue: 3_600_000_000,
    numberOfSignificantValueDigits: 3
  })
}

function toMicroseconds(latencyMs: number): number {
  return Math.max(1, Math.round(latencyMs * 1000))
}

function toMilliseconds(microseconds: number): number {
  return microseconds / 1000
}

export class RunAggregator {
  private readonly histogram = createHistogram()
  private readonly targetHistograms: Histogram[]
  private readonly targetCounts: number[]
  private readonly statusDistribution: Record<string, number> = {}
  private totalRequests = 0
  private errorCount = 0
  private eventLoopLagP99Ms = 0
  private maxScheduleDeviationMs = 0

  constructor(private readonly scenario: LoadScenario) {
    this.targetHistograms = scenario.targets.map(() => createHistogram())
    this.targetCounts = scenario.targets.map(() => 0)
  }

  addSamples(entries: SampleEntry[]): void {
    for (const entry of entries) {
      this.totalRequests += 1
      const microseconds = toMicroseconds(entry.latencyMs)
      this.histogram.recordValue(microseconds)
      this.targetHistograms[entry.targetIndex]?.recordValue(microseconds)
      const currentCount = this.targetCounts[entry.targetIndex]
      if (currentCount !== undefined) this.targetCounts[entry.targetIndex] = currentCount + 1
      const statusKey = String(entry.statusCode)
      this.statusDistribution[statusKey] = (this.statusDistribution[statusKey] ?? 0) + 1
      if (entry.errorMessage !== undefined || entry.statusCode >= 500 || entry.statusCode === 0) this.errorCount += 1
    }
  }

  addWorkerHealth(message: WorkerDoneMessage): void {
    this.eventLoopLagP99Ms = Math.max(this.eventLoopLagP99Ms, message.eventLoopLagP99Ms)
    this.maxScheduleDeviationMs = Math.max(this.maxScheduleDeviationMs, message.maxScheduleDeviationMs)
  }

  snapshot(): { totalRequests: number; errorCount: number; latencyP95: number } {
    return {
      totalRequests: this.totalRequests,
      errorCount: this.errorCount,
      latencyP95: this.totalRequests === 0 ? 0 : toMilliseconds(this.histogram.getValueAtPercentile(95))
    }
  }

  finish(input: { aborted: boolean; degraded: boolean; durationMs: number }): LoadRunResult {
    const percentile = (value: number): number =>
      this.totalRequests === 0 ? 0 : toMilliseconds(this.histogram.getValueAtPercentile(value))
    const targetRps =
      this.scenario.model.kind === 'open'
        ? this.scenario.model.phases.reduce((sum, phase) => sum + phase.rps * phase.durationMs, 0) /
          this.scenario.model.phases.reduce((sum, phase) => sum + phase.durationMs, 0)
        : null
    return {
      name: this.scenario.name,
      aborted: input.aborted,
      degraded: input.degraded,
      totalRequests: this.totalRequests,
      errorCount: this.errorCount,
      errorRate: this.totalRequests === 0 ? 0 : this.errorCount / this.totalRequests,
      latency: {
        p50: percentile(50),
        p90: percentile(90),
        p95: percentile(95),
        p99: percentile(99),
        p999: percentile(99.9),
        mean: this.totalRequests === 0 ? 0 : toMilliseconds(this.histogram.mean),
        min: this.totalRequests === 0 ? 0 : toMilliseconds(this.histogram.minNonZeroValue),
        max: this.totalRequests === 0 ? 0 : toMilliseconds(this.histogram.maxValue)
      },
      statusDistribution: this.statusDistribution,
      perTarget: this.scenario.targets.map((target, index) => ({
        label: target.label ?? `${target.method} ${target.path}`,
        count: this.targetCounts[index] ?? 0,
        p95:
          (this.targetCounts[index] ?? 0) === 0
            ? 0
            : toMilliseconds(this.targetHistograms[index]!.getValueAtPercentile(95))
      })),
      targetRps,
      achievedRps: input.durationMs === 0 ? 0 : this.totalRequests / (input.durationMs / 1000),
      durationMs: input.durationMs,
      workerHealth: {
        eventLoopLagP99Ms: this.eventLoopLagP99Ms,
        maxScheduleDeviationMs: this.maxScheduleDeviationMs
      }
    }
  }
}
