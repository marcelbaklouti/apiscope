import 'reflect-metadata'
import { Controller, Get, Module, Param, Post } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { INestApplication } from '@nestjs/common'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCollector, type Collector } from '@apiscope/collector'
import { AdapterRuntime, CollectorTransport } from '@apiscope/adapter-node'
import { ApiscopeModule } from '../src/index'

@Controller('cats')
class CatsController {
  @Get('boom')
  boom() {
    throw new Error('meow overflow')
  }

  @Get(':id')
  find(@Param('id') id: string) {
    return { id }
  }

  @Post()
  create() {
    return { created: true }
  }
}

let collector: Collector
let app: INestApplication
let runtime: AdapterRuntime

afterEach(async () => {
  await app.close()
  await runtime.shutdown()
  await collector.close()
})

async function startStack() {
  collector = createCollector({ dbPath: ':memory:', port: 0 })
  const collectorAddress = await collector.listen()
  const transport = new CollectorTransport({
    collectorUrl: `ws://127.0.0.1:${collectorAddress.port}`,
    app: { name: 'nest-demo', framework: 'nestjs', runtime: 'node', pid: process.pid }
  })
  runtime = new AdapterRuntime({ appName: 'nest-demo', framework: 'nestjs', transport })

  @Module({
    imports: [ApiscopeModule.forRoot({ appName: 'nest-demo', runtime })],
    controllers: [CatsController]
  })
  class AppModule {}

  app = await NestFactory.create(AppModule, { logger: false })
  await app.listen(0)
  return app.getUrl()
}

describe('ApiscopeModule', () => {
  it('records spans with metadata route patterns end to end', async () => {
    const baseUrl = await startStack()
    const response = await fetch(`${baseUrl}/cats/42`)
    expect(response.status).toBe(200)
    await vi.waitFor(async () => expect(await collector.store.recentSpans(10)).toHaveLength(1), { timeout: 2000 })
    const span = (await collector.store.recentSpans(10))[0]!
    expect(span.routePattern).toBe('/cats/:id')
    expect(span.actualPath).toBe('/cats/42')
    expect(span.framework).toBe('nestjs')
    expect(span.statusCode).toBe(200)
    expect(span.timing.duration).toBeGreaterThan(0)
  })

  it('records error spans with message and status 500', async () => {
    const baseUrl = await startStack()
    const response = await fetch(`${baseUrl}/cats/boom`)
    expect(response.status).toBe(500)
    await vi.waitFor(
      async () => {
        const span = (await collector.store.recentSpans(10)).find((entry) => entry.statusCode === 500)
        expect(span?.error?.message).toBe('meow overflow')
        expect(span?.routePattern).toBe('/cats/boom')
      },
      { timeout: 2000 }
    )
  })

  it('pushes the registry on bootstrap', async () => {
    await startStack()
    await vi.waitFor(
      async () => {
        const routes = await collector.store.listRoutes()
        expect(routes).toContainEqual({ appName: 'nest-demo', method: 'GET', pattern: '/cats/:id' })
        expect(routes).toContainEqual({ appName: 'nest-demo', method: 'GET', pattern: '/cats/boom' })
        expect(routes).toContainEqual({ appName: 'nest-demo', method: 'POST', pattern: '/cats' })
      },
      { timeout: 2000 }
    )
  })
})
