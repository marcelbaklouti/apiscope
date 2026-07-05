import { describe, expect, it } from 'vitest'
import { captureCpuProfile } from '../src/profiling/capture'
import { buildFlamegraph } from '../src/profiling/flamegraph'
import { cpuProfileToPprof } from '../src/profiling/pprof'

function busy(millis: number): void {
  const end = Date.now() + millis
  let value = 0
  while (Date.now() < end) value += Math.sqrt(value + 1)
  if (value === -1) throw new Error('unreachable')
}

describe('cpu profiling', () => {
  it('captures a profile and builds a flamegraph with positive value', async () => {
    const promise = captureCpuProfile(300)
    busy(250)
    const profile = await promise
    expect(profile.nodes.length).toBeGreaterThan(0)
    const flame = buildFlamegraph(profile)
    expect(flame.value).toBeGreaterThan(0)
    expect(flame.children.length).toBeGreaterThan(0)
  })

  it('encodes the profile to non-empty pprof bytes', async () => {
    const promise = captureCpuProfile(200)
    busy(150)
    const profile = await promise
    const bytes = cpuProfileToPprof(profile)
    expect(bytes.byteLength).toBeGreaterThan(0)
  })
})
