import type { RequestSpan } from '@apiscope/core'

export interface Sampler {
  keep(span: RequestSpan): boolean
}

export function createKeepAllSampler(): Sampler {
  return { keep: () => true }
}

export interface TailSamplerOptions {
  baseProbability: number
  outlierQuantile?: number
  windowSize?: number
  random?: () => number
}

interface RouteWindow {
  durations: number[]
  cursor: number
  filled: boolean
}

function routeKey(span: RequestSpan): string {
  return `${span.method} ${span.routePattern ?? span.actualPath}`
}

function quantileOf(values: number[], quantile: number): number {
  if (values.length === 0) return Number.POSITIVE_INFINITY
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.min(sorted.length - 1, Math.floor(quantile * sorted.length))
  return sorted[rank]!
}

export function createTailSampler(options: TailSamplerOptions): Sampler {
  const outlierQuantile = options.outlierQuantile ?? 0.95
  const windowSize = options.windowSize ?? 500
  const random = options.random ?? Math.random
  const windows = new Map<string, RouteWindow>()

  const observe = (key: string, duration: number): void => {
    let window = windows.get(key)
    if (window === undefined) {
      window = { durations: new Array<number>(windowSize), cursor: 0, filled: false }
      windows.set(key, window)
    }
    window.durations[window.cursor] = duration
    window.cursor = (window.cursor + 1) % windowSize
    if (window.cursor === 0) window.filled = true
  }

  const currentSamples = (window: RouteWindow): number[] =>
    window.filled ? window.durations : window.durations.slice(0, window.cursor)

  return {
    keep(span) {
      const key = routeKey(span)
      const window = windows.get(key)
      const isError = span.statusCode >= 500 || span.error !== undefined
      let isOutlier = false
      if (!isError && window !== undefined) {
        const samples = currentSamples(window)
        if (samples.length >= 20) {
          isOutlier = span.timing.duration > quantileOf(samples, outlierQuantile)
        }
      }
      observe(key, span.timing.duration)
      if (isError || isOutlier) return true
      return random() < options.baseProbability
    }
  }
}
