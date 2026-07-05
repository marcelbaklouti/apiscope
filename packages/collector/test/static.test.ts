import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createCollector, type Collector } from '../src/index'

let collector: Collector

afterEach(async () => {
  await collector.close()
})

describe('static serving', () => {
  it('serves files, falls back to index.html and blocks traversal', async () => {
    const dashboardDir = mkdtempSync(join(tmpdir(), 'apiscope-dashboard-'))
    writeFileSync(join(dashboardDir, 'index.html'), '<html><body>apiscope</body></html>')
    mkdirSync(join(dashboardDir, 'assets'))
    writeFileSync(join(dashboardDir, 'assets', 'app.js'), 'console.log(1)')
    collector = createCollector({ dbPath: ':memory:', port: 0, dashboardDir })
    const { port } = await collector.listen()
    const index = await fetch(`http://127.0.0.1:${port}/`)
    expect(index.headers.get('content-type')).toContain('text/html')
    expect(await index.text()).toContain('apiscope')
    const asset = await fetch(`http://127.0.0.1:${port}/assets/app.js`)
    expect(asset.headers.get('content-type')).toContain('javascript')
    const spa = await fetch(`http://127.0.0.1:${port}/inspector/abc`)
    expect(await spa.text()).toContain('apiscope')
    const traversal = await fetch(`http://127.0.0.1:${port}/..%2F..%2Fetc%2Fpasswd`)
    expect(await traversal.text()).toContain('apiscope')
    const health = await fetch(`http://127.0.0.1:${port}/health`)
    expect((await health.json()) as object).toEqual({ status: 'ok' })
  })
})
