import { randomUUID } from 'node:crypto'
import { assertAllowedTarget, runLoadTest, type LoadAssertions, type LoadScenario } from '@apiscope/load'
import { LiveHub } from './live-hub'
import { SpanStore } from './store'

export interface LoadRunRequest {
  scenario: LoadScenario
  assertions?: LoadAssertions
}

export function startLoadRun(request: LoadRunRequest, store: SpanStore, hub: LiveHub): { runId: string } {
  assertAllowedTarget(request.scenario.baseUrl, request.scenario.allowRemoteHosts)
  const runId = randomUUID()
  const startedAt = Date.now()
  void runLoadTest(request.scenario, {
    onProgress: (snapshot) =>
      hub.publish({ type: 'load-progress', runId, name: request.scenario.name, snapshot })
  })
    .then((result) => {
      store.insertLoadRun({
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
