import { Session } from 'node:inspector'

export interface CpuProfileNode {
  id: number
  callFrame: { functionName: string; url: string; lineNumber: number }
  hitCount?: number
  children?: number[]
}

export interface CpuProfile {
  nodes: CpuProfileNode[]
  startTime: number
  endTime: number
  samples: number[]
  timeDeltas: number[]
}

export function captureCpuProfile(durationMs: number, samplingIntervalMicros = 100): Promise<CpuProfile> {
  return new Promise((resolve, reject) => {
    const session = new Session()
    session.connect()
    const post = (method: string, params?: Record<string, unknown>): Promise<unknown> =>
      new Promise((res, rej) => session.post(method, params ?? {}, (error, result) => (error ? rej(error) : res(result))))
    void (async () => {
      try {
        await post('Profiler.enable')
        await post('Profiler.setSamplingInterval', { interval: samplingIntervalMicros })
        await post('Profiler.start')
        await new Promise((done) => setTimeout(done, durationMs))
        const stopped = (await post('Profiler.stop')) as { profile: CpuProfile }
        session.disconnect()
        resolve(stopped.profile)
      } catch (error) {
        session.disconnect()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })()
  })
}
