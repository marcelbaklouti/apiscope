import { parentPort, workerData } from 'node:worker_threads'
import { runWorkerLoop } from './worker-loop'
import type { WorkerInput, WorkerMessage } from './types'

const port = parentPort
if (port === null) throw new Error('worker started without parent port')

const emit = (message: WorkerMessage): void => port.postMessage(message)

runWorkerLoop(workerData as WorkerInput, emit).catch((error: unknown) => {
  emit({ type: 'fatal', message: error instanceof Error ? error.message : String(error) })
})
