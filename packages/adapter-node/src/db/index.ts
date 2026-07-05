import { instrumentBetterSqlite3 } from './better-sqlite3'
import { instrumentMongodb } from './mongodb'
import { instrumentMysql2, instrumentMysql2Promise } from './mysql2'
import { instrumentPg } from './pg'
import { enablePrismaBridge } from './prisma'
import { registerActiveRuntime } from './registry'
import { requireOptional } from './require-optional'
import type { AdapterRuntime } from '../runtime'

function tryInstrument(moduleName: string, instrument: (candidate: unknown) => void): void {
  try {
    const candidate = requireOptional(moduleName)
    instrument(candidate)
  } catch {}
}

function tryEnablePrismaBridge(): void {
  try {
    requireOptional('@prisma/instrumentation')
    enablePrismaBridge()
  } catch {}
}

export function instrumentDatabases(runtime?: AdapterRuntime): void {
  if (runtime !== undefined) registerActiveRuntime(runtime)
  tryInstrument('pg', instrumentPg)
  tryInstrument('mysql2', instrumentMysql2)
  tryInstrument('mysql2/promise', instrumentMysql2Promise)
  tryInstrument('better-sqlite3', instrumentBetterSqlite3)
  tryInstrument('mongodb', instrumentMongodb)
  tryEnablePrismaBridge()
}
