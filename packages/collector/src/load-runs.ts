import { randomUUID } from 'node:crypto'
import { assertAllowedTarget, runLoadTest, type LoadAssertions, type LoadScenario } from '@apiscope/load'
import type { LiveTransport } from './live/live-transport'
import type { SpanStore } from './store-interface'

export interface LoadRunRequest {
  scenario: LoadScenario
  assertions?: LoadAssertions
}

export function startLoadRun(request: LoadRunRequest, store: SpanStore, hub: LiveTransport): { runId: string } {
  assertAllowedTarget(request.scenario.baseUrl, request.scenario.allowRemoteHosts)
  const runId = randomUUID()
  const startedAt = Date.now()
  void runLoadTest(request.scenario, {
    onProgress: (snapshot) =>
      hub.publish({ type: 'load-progress', runId, name: request.scenario.name, snapshot })
  })
    .then(async (result) => {
      await store.insertLoadRun({
        id: runId,
        name: request.scenario.name,
        startedAt,
        scenarioJson: JSON.stringify({ scenario: request.scenario, assertions: request.assertions ?? null }),
        resultJson: JSON.stringify(result)
      })
      hub.publish({ type: 'load-finished', runId, ok: !result.aborted })
    })
    .catch(() => {
      hub.publish({ type: 'load-finished', runId, ok: false })
    })
  return { runId }
}
