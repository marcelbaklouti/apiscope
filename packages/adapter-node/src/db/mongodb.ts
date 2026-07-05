import { newSpanId, type DbChildSpan } from '@apiscope/core'
import { getActiveRuntime } from './registry'
import type { AdapterRuntime, SpanContext } from '../runtime'

interface MongoCommandStartedEvent {
  requestId: number
  databaseName: string
  commandName: string
  command: Record<string, unknown>
}

interface MongoCommandSucceededEvent {
  requestId: number
  commandName: string
  duration: number
  reply: unknown
}

interface MongoCommandFailedEvent {
  requestId: number
  commandName: string
  duration: number
  failure: Error
}

interface MongoClientLike {
  on(event: 'commandStarted', listener: (event: MongoCommandStartedEvent) => void): unknown
  on(event: 'commandSucceeded', listener: (event: MongoCommandSucceededEvent) => void): unknown
  on(event: 'commandFailed', listener: (event: MongoCommandFailedEvent) => void): unknown
}

interface MongoModule {
  MongoClient: new (url: string, options?: Record<string, unknown>) => MongoClientLike
}

const marker = Symbol.for('apiscope.mongodb.instrumented')

function commandStatement(command: Record<string, unknown>, commandName: string): string {
  const collection = command[commandName]
  return typeof collection === 'string' ? `${commandName} ${collection}` : commandName
}

function rowCountFromReply(reply: unknown): number | null {
  if (reply === null || typeof reply !== 'object') return null
  const record = reply as Record<string, unknown>
  if (typeof record['n'] === 'number') return record['n']
  const cursor = record['cursor']
  if (cursor !== null && typeof cursor === 'object') {
    const firstBatch = (cursor as Record<string, unknown>)['firstBatch']
    if (Array.isArray(firstBatch)) return firstBatch.length
  }
  return null
}

export function instrumentMongodb(candidate: unknown): void {
  const mongodb = candidate as MongoModule
  const original = mongodb.MongoClient as unknown as (new (url: string, options?: Record<string, unknown>) => MongoClientLike) & {
    [marker]?: boolean
  }
  if (original[marker] === true) return

  const wrapped = function MongoClient(this: unknown, url: string, options: Record<string, unknown> = {}) {
    const client = new original(url, { ...options, monitorCommands: true }) as MongoClientLike
    const pending = new Map<
      number,
      { runtime: AdapterRuntime; context: SpanContext; statement: string; commandName: string; databaseName: string; start: number; startHighRes: number }
    >()

    client.on('commandStarted', (event) => {
      const runtime = getActiveRuntime()
      const context = runtime?.currentSpan() ?? null
      if (runtime === null || context === null) return
      pending.set(event.requestId, {
        runtime,
        context,
        statement: commandStatement(event.command, event.commandName),
        commandName: event.commandName,
        databaseName: event.databaseName,
        start: Date.now(),
        startHighRes: performance.now()
      })
    })

    client.on('commandSucceeded', (event) => {
      const entry = pending.get(event.requestId)
      if (entry === undefined) return
      pending.delete(event.requestId)
      const childSpan: DbChildSpan = {
        id: newSpanId(),
        parentSpanId: entry.context.spanId,
        traceId: entry.context.traceId,
        kind: 'db',
        system: 'mongodb',
        statement: entry.statement,
        operation: entry.commandName,
        target: entry.databaseName,
        rowCount: rowCountFromReply(event.reply),
        timing: { start: entry.start, ttfb: null, duration: performance.now() - entry.startHighRes }
      }
      entry.runtime.recordChildSpan(childSpan)
    })

    client.on('commandFailed', (event) => {
      const entry = pending.get(event.requestId)
      if (entry === undefined) return
      pending.delete(event.requestId)
      const childSpan: DbChildSpan = {
        id: newSpanId(),
        parentSpanId: entry.context.spanId,
        traceId: entry.context.traceId,
        kind: 'db',
        system: 'mongodb',
        statement: entry.statement,
        operation: entry.commandName,
        target: entry.databaseName,
        rowCount: null,
        error: { message: event.failure.message, ...(event.failure.stack === undefined ? {} : { stack: event.failure.stack }) },
        timing: { start: entry.start, ttfb: null, duration: performance.now() - entry.startHighRes }
      }
      entry.runtime.recordChildSpan(childSpan)
    })

    return client
  } as unknown as new (url: string, options?: Record<string, unknown>) => MongoClientLike

  wrapped.prototype = original.prototype
  Object.setPrototypeOf(wrapped, original)
  ;(wrapped as unknown as { [marker]?: boolean })[marker] = true
  Object.defineProperty(mongodb, 'MongoClient', {
    value: wrapped,
    writable: true,
    enumerable: true,
    configurable: true
  })
}
