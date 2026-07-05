import { RequestMethod } from '@nestjs/common'
import type { RouteRegistryEntry } from '@apiscope/core'

const PATH_METADATA = 'path'
const METHOD_METADATA = 'method'

const methodNames: Partial<Record<RequestMethod, string>> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.OPTIONS]: 'OPTIONS',
  [RequestMethod.HEAD]: 'HEAD'
}

export function joinRoutePaths(...segments: Array<string | undefined>): string {
  const joined = segments
    .filter((segment): segment is string => segment !== undefined && segment !== '')
    .map((segment) => segment.replace(/^\/+|\/+$/g, ''))
    .filter((segment) => segment !== '')
    .join('/')
  return `/${joined}`.replace(/\/+$/, '') || '/'
}

interface ControllerRef {
  metatype: object
  instance: object
}

export function extractNestRoutes(controllers: ControllerRef[]): RouteRegistryEntry[] {
  const entries: RouteRegistryEntry[] = []
  for (const controller of controllers) {
    const controllerPath = Reflect.getMetadata(PATH_METADATA, controller.metatype) as string | undefined
    const prototype = Object.getPrototypeOf(controller.instance) as Record<string, unknown>
    for (const propertyName of Object.getOwnPropertyNames(prototype)) {
      if (propertyName === 'constructor') continue
      const handler = prototype[propertyName]
      if (typeof handler !== 'function') continue
      const handlerPath = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined
      const handlerMethod = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined
      if (handlerMethod === undefined) continue
      const methodName = methodNames[handlerMethod]
      if (methodName === undefined) continue
      entries.push({ method: methodName, pattern: joinRoutePaths(controllerPath, handlerPath) })
    }
  }
  return entries
}
