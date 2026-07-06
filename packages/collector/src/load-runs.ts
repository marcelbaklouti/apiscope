import { randomUUID } from 'node:crypto'
import { assertAllowedTarget, runLoadTest, type LoadAssertions, type LoadScenario } from '@apiscope/load'
import type { LiveTransport } from './live/live-transport'
import type { SpanStore } from './store-interface'

export interface LoadRunRequest {
  scenario: LoadScenario
  assertions?: LoadAssertions
}

export async function startLoadRun(
  request: LoadRunRequest,
  store: SpanStore,
  hub: LiveTransport,
  operatorAllowRemoteHosts: string[] = []
): Promise<{ runId: string }> {
  const scenario: LoadScenario = { ...request.scenario, allowRemoteHosts: operatorAllowRemoteHosts }
  await assertAllowedTarget(scenario.baseUrl, operatorAllowRemoteHosts)
  const runId = randomUUID()
  const startedAt = Date.now()
  void runLoadTest(scenario, {
    onProgress: (snapshot) =>
      hub.publish({ type: 'load-progress', runId, name: scenario.name, snapshot })
  })
    .then(async (result) => {
      await store.insertLoadRun({
        id: runId,
        name: scenario.name,
        startedAt,
        scenarioJson: JSON.stringify({ scenario, assertions: request.assertions ?? null }),
        resultJson: JSON.stringify(result)
      })
      hub.publish({ type: 'load-finished', runId, ok: !result.aborted })
    })
    .catch(() => {
      hub.publish({ type: 'load-finished', runId, ok: false })
    })
  return { runId }
}
