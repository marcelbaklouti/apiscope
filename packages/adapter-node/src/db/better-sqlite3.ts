import { emitDbSpan, sqlOperationOf } from './emit'

interface BetterSqlite3Statement {
  source: string
  run: (...args: unknown[]) => { changes: number; lastInsertRowid: number | bigint }
  get: (...args: unknown[]) => unknown
  all: (...args: unknown[]) => unknown[]
}

interface BetterSqlite3Database {
  prepare: (source: string, ...rest: unknown[]) => BetterSqlite3Statement
  exec: (source: string) => unknown
}

interface BetterSqlite3Class {
  prototype: BetterSqlite3Database
}

const databaseMarker = Symbol.for('apiscope.better-sqlite3.database.instrumented')
const statementMarker = Symbol.for('apiscope.better-sqlite3.statement.instrumented')

function instrumentStatementPrototype(prototype: BetterSqlite3Statement): void {
  const marked = prototype as BetterSqlite3Statement & { [statementMarker]?: boolean }
  if (marked[statementMarker] === true) return
  const originalRun = prototype.run
  prototype.run = function run(this: BetterSqlite3Statement, ...args: unknown[]) {
    return emitDbSpan({
      system: 'sqlite',
      statement: this.source,
      operation: sqlOperationOf(this.source),
      target: null,
      run: () => originalRun.apply(this, args),
      rowCountOf: (result) => result.changes
    })
  }
  const originalGet = prototype.get
  prototype.get = function get(this: BetterSqlite3Statement, ...args: unknown[]) {
    return emitDbSpan({
      system: 'sqlite',
      statement: this.source,
      operation: sqlOperationOf(this.source),
      target: null,
      run: () => originalGet.apply(this, args),
      rowCountOf: (result) => (result === undefined ? 0 : 1)
    })
  }
  const originalAll = prototype.all
  prototype.all = function all(this: BetterSqlite3Statement, ...args: unknown[]) {
    return emitDbSpan({
      system: 'sqlite',
      statement: this.source,
      operation: sqlOperationOf(this.source),
      target: null,
      run: () => originalAll.apply(this, args),
      rowCountOf: (result) => result.length
    })
  }
  marked[statementMarker] = true
}

export function instrumentBetterSqlite3(candidate: unknown): void {
  const Database = candidate as BetterSqlite3Class & { [databaseMarker]?: boolean }
  if (Database[databaseMarker] === true) return
  const originalPrepare = Database.prototype.prepare
  Database.prototype.prepare = function prepare(this: BetterSqlite3Database, source: string, ...rest: unknown[]) {
    const statement = originalPrepare.call(this, source, ...rest)
    instrumentStatementPrototype(Object.getPrototypeOf(statement) as BetterSqlite3Statement)
    return statement
  }
  const originalExec = Database.prototype.exec
  Database.prototype.exec = function exec(this: BetterSqlite3Database, source: string) {
    return emitDbSpan({
      system: 'sqlite',
      statement: source,
      operation: sqlOperationOf(source),
      target: null,
      run: () => originalExec.call(this, source),
      rowCountOf: () => null
    })
  }
  Database[databaseMarker] = true
}
