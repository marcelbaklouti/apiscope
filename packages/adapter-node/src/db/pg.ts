import { emitDbSpanAsync, sqlOperationOf } from './emit'

interface PgQueryResult {
  rowCount?: number | null
}

interface PgClass {
  prototype: { query: (...args: unknown[]) => unknown }
}

interface PgModule {
  Client: PgClass
  Pool: PgClass
}

const marker = Symbol.for('apiscope.pg.instrumented')

function statementOf(first: unknown): string {
  if (typeof first === 'string') return first
  if (first !== null && typeof first === 'object' && 'text' in first) {
    return String((first as { text: unknown }).text)
  }
  return ''
}

export function instrumentPg(candidate: unknown): void {
  const pg = candidate as PgModule & { [marker]?: boolean }
  if (pg[marker] === true) return
  for (const holder of [pg.Client.prototype, pg.Pool.prototype]) {
    const original = holder.query
    holder.query = function query(this: unknown, ...args: unknown[]) {
      const statement = statementOf(args[0])
      if (statement === '' || typeof args[args.length - 1] === 'function') {
        return original.apply(this, args)
      }
      return emitDbSpanAsync({
        system: 'postgresql',
        statement,
        operation: sqlOperationOf(statement),
        target: null,
        run: () => original.apply(this, args) as Promise<PgQueryResult>,
        rowCountOf: (result) => result?.rowCount ?? null
      })
    }
  }
  pg[marker] = true
}
