import { emitDbSpan, emitDbSpanAsync, sqlOperationOf } from './emit'

interface MysqlQueryResult {
  affectedRows?: number
}

type QueryMethod = (...args: unknown[]) => unknown

interface MysqlClass {
  prototype: { query: QueryMethod; execute: QueryMethod }
}

interface Mysql2Module {
  Connection: MysqlClass
  Pool: MysqlClass
}

interface Mysql2PromiseModule {
  Connection: MysqlClass
  PromisePool: MysqlClass
}

const callbackMarker = Symbol.for('apiscope.mysql2.instrumented')
const promiseMarker = Symbol.for('apiscope.mysql2-promise.instrumented')

function statementOf(first: unknown): string {
  if (typeof first === 'string') return first
  if (first !== null && typeof first === 'object' && 'sql' in first) {
    return String((first as { sql: unknown }).sql)
  }
  return ''
}

function wrapCallbackMethod(holder: { [key: string]: QueryMethod }, methodName: string): void {
  const original = holder[methodName]
  if (original === undefined) return
  holder[methodName] = function wrapped(this: unknown, ...args: unknown[]) {
    const statement = statementOf(args[0])
    const callbackIndex = args.findIndex((arg) => typeof arg === 'function')
    if (statement === '' || callbackIndex === -1) return original.apply(this, args)
    const callback = args[callbackIndex] as (...callbackArgs: unknown[]) => void
    return emitDbSpan({
      system: 'mysql',
      statement,
      operation: sqlOperationOf(statement),
      target: null,
      run: () => {
        let capturedResult: MysqlQueryResult | undefined
        const wrappedArgs = [...args]
        wrappedArgs[callbackIndex] = (...callbackArgs: unknown[]) => {
          capturedResult = callbackArgs[1] as MysqlQueryResult | undefined
          callback(...callbackArgs)
        }
        const command = original.apply(this, wrappedArgs)
        return { command, result: () => capturedResult }
      },
      rowCountOf: ({ result }) => result()?.affectedRows ?? null
    }).command
  }
}

function wrapPromiseMethod(holder: { [key: string]: QueryMethod }, methodName: string): void {
  const original = holder[methodName]
  if (original === undefined) return
  holder[methodName] = function wrapped(this: unknown, ...args: unknown[]) {
    const statement = statementOf(args[0])
    if (statement === '' || typeof args[args.length - 1] === 'function') return original.apply(this, args)
    return emitDbSpanAsync({
      system: 'mysql',
      statement,
      operation: sqlOperationOf(statement),
      target: null,
      run: () => original.apply(this, args) as Promise<[MysqlQueryResult | MysqlQueryResult[], unknown]>,
      rowCountOf: ([rows]) => (Array.isArray(rows) ? rows.length : (rows?.affectedRows ?? null))
    })
  }
}

export function instrumentMysql2(candidate: unknown): void {
  const mysql2 = candidate as Mysql2Module & { [callbackMarker]?: boolean }
  if (mysql2[callbackMarker] === true) return
  for (const holder of [mysql2.Connection.prototype, mysql2.Pool.prototype]) {
    wrapCallbackMethod(holder as unknown as { [key: string]: QueryMethod }, 'query')
    wrapCallbackMethod(holder as unknown as { [key: string]: QueryMethod }, 'execute')
  }
  mysql2[callbackMarker] = true
}

export function instrumentMysql2Promise(candidate: unknown): void {
  const mysql2Promise = candidate as Mysql2PromiseModule & { [promiseMarker]?: boolean }
  if (mysql2Promise[promiseMarker] === true) return
  for (const holder of [mysql2Promise.Connection.prototype, mysql2Promise.PromisePool.prototype]) {
    wrapPromiseMethod(holder as unknown as { [key: string]: QueryMethod }, 'query')
    wrapPromiseMethod(holder as unknown as { [key: string]: QueryMethod }, 'execute')
  }
  mysql2Promise[promiseMarker] = true
}
