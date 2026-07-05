import 'reflect-metadata'
import { Controller, Get, Post, Put } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { extractNestRoutes, joinRoutePaths } from '../src/registry'

@Controller('cats')
class CatsController {
  @Get()
  list() {
    return []
  }

  @Get(':id')
  find() {
    return {}
  }

  @Post('adopt/:id')
  adopt() {
    return {}
  }
}

@Controller()
class RootController {
  @Put('settings')
  update() {
    return {}
  }
}

describe('joinRoutePaths', () => {
  it('normalizes slashes', () => {
    expect(joinRoutePaths('cats', ':id')).toBe('/cats/:id')
    expect(joinRoutePaths('/', '/')).toBe('/')
    expect(joinRoutePaths(undefined, 'settings')).toBe('/settings')
    expect(joinRoutePaths('/api/', '/v1/')).toBe('/api/v1')
  })
})

describe('extractNestRoutes', () => {
  it('builds patterns from controller and handler metadata', () => {
    const routes = extractNestRoutes([
      { metatype: CatsController, instance: new CatsController() },
      { metatype: RootController, instance: new RootController() }
    ])
    expect(routes).toContainEqual({ method: 'GET', pattern: '/cats' })
    expect(routes).toContainEqual({ method: 'GET', pattern: '/cats/:id' })
    expect(routes).toContainEqual({ method: 'POST', pattern: '/cats/adopt/:id' })
    expect(routes).toContainEqual({ method: 'PUT', pattern: '/settings' })
    expect(routes).toHaveLength(4)
  })
})
