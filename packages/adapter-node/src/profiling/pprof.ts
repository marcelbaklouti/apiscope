import { Function as PprofFunction, Location, Profile, Sample, StringTable, ValueType } from 'pprof-format'
import type { CpuProfile, CpuProfileNode } from './capture'

function frameName(node: CpuProfileNode): string {
  return node.callFrame.functionName === '' ? '(anonymous)' : node.callFrame.functionName
}

function buildParentById(profile: CpuProfile): Map<number, number> {
  const parentById = new Map<number, number>()
  for (const node of profile.nodes) {
    for (const childId of node.children ?? []) parentById.set(childId, node.id)
  }
  return parentById
}

function stackForNodeId(nodeId: number, nodesById: Map<number, CpuProfileNode>, parentById: Map<number, number>): number[] {
  const stack: number[] = []
  let currentId: number | undefined = nodeId
  while (currentId !== undefined && nodesById.has(currentId)) {
    stack.push(currentId)
    currentId = parentById.get(currentId)
  }
  return stack
}

export function cpuProfileToPprof(profile: CpuProfile): Uint8Array {
  const stringTable = new StringTable()
  const nodesById = new Map(profile.nodes.map((node) => [node.id, node]))
  const parentById = buildParentById(profile)

  const functions: PprofFunction[] = []
  const locations: Location[] = []
  for (const node of profile.nodes) {
    const functionId = node.id
    functions.push(
      PprofFunction.create({
        id: functionId,
        name: stringTable.dedup(frameName(node)),
        systemName: stringTable.dedup(frameName(node)),
        filename: stringTable.dedup(node.callFrame.url),
        startLine: Math.max(node.callFrame.lineNumber, 0)
      })
    )
    locations.push(
      Location.create({
        id: node.id,
        line: [{ functionId, line: Math.max(node.callFrame.lineNumber, 0) }]
      })
    )
  }

  const samples: Sample[] = profile.samples.map((nodeId, index) => {
    const stack = stackForNodeId(nodeId, nodesById, parentById)
    const durationNanos = (profile.timeDeltas[index] ?? 0) * 1000
    return Sample.create({ locationId: stack, value: [durationNanos] })
  })

  const cpuValueType = ValueType.create({ type: stringTable.dedup('cpu'), unit: stringTable.dedup('nanoseconds') })
  const profileMessage = new Profile({
    sampleType: [cpuValueType],
    sample: samples,
    location: locations,
    function: functions,
    stringTable,
    periodType: cpuValueType,
    period: 1,
    timeNanos: profile.startTime * 1000,
    durationNanos: (profile.endTime - profile.startTime) * 1000
  })

  return profileMessage.encode()
}
