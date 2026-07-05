import type { AdapterRuntime } from '../runtime'

let activeRuntime: AdapterRuntime | null = null

export function registerActiveRuntime(runtime: AdapterRuntime): void {
  activeRuntime = runtime
}

export function getActiveRuntime(): AdapterRuntime | null {
  return activeRuntime
}
