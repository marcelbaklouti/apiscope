import { Inject, Injectable, Module, Optional, type DynamicModule, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common'
import { APP_INTERCEPTOR, ModulesContainer } from '@nestjs/core'
import { AdapterRuntime, subscribeUndici } from '@apiscope/adapter-node'
import { extractNestRoutes } from './registry'
import { ApiscopeInterceptor, APISCOPE_RUNTIME } from './interceptor'

export const APISCOPE_OPTIONS = Symbol('APISCOPE_OPTIONS')

export interface NestAdapterOptions {
  appName: string
  collectorUrl?: string
  capture?: 'none' | 'headers' | 'full'
  additionalRedactedHeaders?: string[]
  runtime?: AdapterRuntime
}

@Injectable()
export class ApiscopeRegistryService implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(
    @Inject(APISCOPE_OPTIONS) private readonly options: NestAdapterOptions,
    @Inject(APISCOPE_RUNTIME) private readonly runtime: AdapterRuntime,
    @Optional() private readonly modulesContainer?: ModulesContainer
  ) {}

  onApplicationBootstrap(): void {
    try {
      this.runtime.start()
      subscribeUndici(this.runtime)
      const controllers: Array<{ metatype: object; instance: object }> = []
      for (const moduleRef of this.modulesContainer?.values() ?? []) {
        for (const wrapper of moduleRef.controllers.values()) {
          if (wrapper.metatype !== null && wrapper.instance !== null && wrapper.instance !== undefined) {
            controllers.push({ metatype: wrapper.metatype as object, instance: wrapper.instance as object })
          }
        }
      }
      this.runtime.setRoutes(extractNestRoutes(controllers))
    } catch {}
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.options.runtime === undefined) await this.runtime.shutdown()
  }
}

@Module({})
export class ApiscopeModule {
  static forRoot(options: NestAdapterOptions): DynamicModule {
    return {
      module: ApiscopeModule,
      providers: [
        { provide: APISCOPE_OPTIONS, useValue: options },
        {
          provide: APISCOPE_RUNTIME,
          useFactory: () =>
            options.runtime ??
            new AdapterRuntime({
              appName: options.appName,
              framework: 'nestjs',
              ...(options.collectorUrl === undefined ? {} : { collectorUrl: options.collectorUrl }),
              ...(options.capture === undefined ? {} : { capture: options.capture }),
              ...(options.additionalRedactedHeaders === undefined
                ? {}
                : { additionalRedactedHeaders: options.additionalRedactedHeaders })
            })
        },
        ApiscopeRegistryService,
        { provide: APP_INTERCEPTOR, useClass: ApiscopeInterceptor }
      ],
      exports: [APISCOPE_RUNTIME]
    }
  }
}
