import { describe, expect, it } from 'vitest'
import { SqliteSpanStore } from '../src/store'
import { runStoreConformance } from '../src/testing/store-conformance'

runStoreConformance(async () => new SqliteSpanStore(':memory:'), describe, it, expect as never)
