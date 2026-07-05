import type { FlameNode } from '@apiscope/core'
import type { CpuProfile, CpuProfileNode } from './capture'

function deriveSamplingIntervalMicros(profile: CpuProfile): number {
  if (profile.samples.length === 0) return 0
  return (profile.endTime - profile.startTime) / profile.samples.length
}

function frameName(node: CpuProfileNode): string {
  return node.callFrame.functionName === '' ? '(anonymous)' : node.callFrame.functionName
}

function findRootNode(profile: CpuProfile): CpuProfileNode | undefined {
  const childIds = new Set<number>()
  for (const node of profile.nodes) {
    for (const childId of node.children ?? []) childIds.add(childId)
  }
  return profile.nodes.find((node) => !childIds.has(node.id)) ?? profile.nodes[0]
}

export function buildFlamegraph(profile: CpuProfile): FlameNode {
  const nodesById = new Map(profile.nodes.map((node) => [node.id, node]))
  const samplingIntervalMicros = deriveSamplingIntervalMicros(profile)

  function buildNode(node: CpuProfileNode): FlameNode {
    const selfMicros = (node.hitCount ?? 0) * samplingIntervalMicros
    const children = (node.children ?? [])
      .map((childId) => nodesById.get(childId))
      .filter((child): child is CpuProfileNode => child !== undefined)
      .map(buildNode)
    const value = selfMicros + children.reduce((sum, child) => sum + child.value, 0)
    return {
      name: frameName(node),
      file: node.callFrame.url,
      line: node.callFrame.lineNumber,
      value,
      children
    }
  }

  const rootNode = findRootNode(profile)
  if (rootNode === undefined) {
    return { name: '(program)', file: '', line: 0, value: 0, children: [] }
  }
  const built = buildNode(rootNode)
  return { ...built, name: '(program)' }
}
