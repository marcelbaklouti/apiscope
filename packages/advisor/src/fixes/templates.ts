import type { FindingFix } from '../types'

export interface FixParams {
  routePattern?: string
  system?: string
  sourceFile?: string
}

type Template = (framework: string, params: FixParams) => FindingFix

function generic(explanation: string, docsUrl: string): Template {
  return (framework) => ({ framework, explanation, docsUrl })
}

const compressionDocs = 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Encoding'
const cacheDocs = 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control'

const uncompressed: Record<string, Template> = {
  express: (framework) => ({
    framework,
    explanation: 'Add the compression middleware before your routes so text responses are gzip-compressed.',
    codeSnippet: "import compression from 'compression'\n\napp.use(compression())",
    docsUrl: compressionDocs
  }),
  fastify: (framework) => ({
    framework,
    explanation: 'Register @fastify/compress so responses are compressed with gzip or brotli.',
    codeSnippet: "import compress from '@fastify/compress'\n\nawait app.register(compress)",
    docsUrl: compressionDocs
  }),
  hono: (framework) => ({
    framework,
    explanation: 'Add the edge-safe compress middleware from hono/compress at the top of your app.',
    codeSnippet: "import { compress } from 'hono/compress'\n\napp.use('*', compress())",
    docsUrl: compressionDocs
  }),
  next: (framework) => ({
    framework,
    explanation: 'Next compresses responses when compress is enabled in next.config.',
    codeSnippet: "// next.config.mjs\nexport default {\n  compress: true\n}",
    docsUrl: 'https://nextjs.org/docs/app/api-reference/config/next-config-js/compress'
  }),
  nestjs: (framework) => ({
    framework,
    explanation: 'Enable the compression middleware in main.ts before app.listen().',
    codeSnippet: "import compression from 'compression'\n\napp.use(compression())",
    docsUrl: compressionDocs
  })
}

function nextCacheTemplate(framework: string, params: FixParams): FindingFix {
  const isPages = (params.sourceFile ?? '').includes('pages/')
  if (isPages) {
    return {
      framework,
      explanation: 'Set Cache-Control on the response in your Pages API handler.',
      codeSnippet: "res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')",
      docsUrl: cacheDocs
    }
  }
  return {
    framework,
    explanation: 'Export a revalidate window from the App Router route to cache it.',
    codeSnippet: 'export const revalidate = 60',
    docsUrl: 'https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config#revalidate'
  }
}

const missingCache: Record<string, Template> = {
  express: (framework) => ({
    framework,
    explanation: 'Send Cache-Control (and let Express compute an ETag) for cacheable GET responses.',
    codeSnippet: "response.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')",
    docsUrl: cacheDocs
  }),
  fastify: (framework) => ({
    framework,
    explanation: 'Set Cache-Control on cacheable GET replies with reply.header.',
    codeSnippet: "reply.header('cache-control', 'public, max-age=60, stale-while-revalidate=300')",
    docsUrl: cacheDocs
  }),
  hono: (framework) => ({
    framework,
    explanation: 'Set Cache-Control on the context for cacheable GET responses.',
    codeSnippet: "c.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')",
    docsUrl: cacheDocs
  }),
  next: nextCacheTemplate,
  nestjs: (framework) => ({
    framework,
    explanation: 'Use @Header or the CacheInterceptor to set Cache-Control on cacheable GET handlers.',
    codeSnippet: "@Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')",
    docsUrl: cacheDocs
  })
}

function oversizedTemplate(framework: string, params: FixParams): FindingFix {
  const route = params.routePattern ?? 'this route'
  return {
    framework,
    explanation: `${route} returns a large JSON body on every request. Paginate the result, select only the fields the client needs, or cap the array length.`,
    docsUrl: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Range_requests'
  }
}

function nPlusOneTemplate(framework: string, params: FixParams): FindingFix {
  const route = params.routePattern ?? 'this route'
  return {
    framework,
    explanation: `${route} runs the same query once per row (an n+1 pattern). Fetch the related rows in one query with a join, an IN (...) batch, or your ORM's eager-load / include option instead of querying inside a loop.`,
    docsUrl: 'https://www.prisma.io/docs/orm/prisma-client/queries/relation-queries#nested-reads'
  }
}

function sequentialOutboundTemplate(framework: string, params: FixParams): FindingFix {
  const route = params.routePattern ?? 'this route'
  return {
    framework,
    explanation: `${route} awaits outbound calls one after another. Start the independent requests together and await them with Promise.all so they run in parallel.`,
    codeSnippet: 'const [a, b] = await Promise.all([fetchA(), fetchB()])',
    docsUrl: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all'
  }
}

function slowDependencyTemplate(framework: string, params: FixParams): FindingFix {
  const target = params.system ?? 'the dependency'
  const route = params.routePattern ?? 'this route'
  return {
    framework,
    explanation: `A single call to ${target} dominates ${route}'s time. Add an index for the query, cache the result, set a tighter timeout, or parallelize it with the rest of the request.`,
    docsUrl: 'https://use-the-index-luke.com/'
  }
}

const genericGuidance: Record<string, Template> = {
  'oversized-payload': oversizedTemplate,
  'n-plus-one': nPlusOneTemplate,
  'sequential-outbound': sequentialOutboundTemplate,
  'slow-dependency': slowDependencyTemplate,
  'slow-route': (framework, params) => ({
    framework,
    explanation: `${params.routePattern ?? 'This route'} is slower than the latency budget. Open "where the time goes" to see whether the time is in your code, the database, or an outbound call, then address the dominant slice.`,
    docsUrl: 'https://web.dev/articles/ttfb'
  }),
  'where-time-goes': (framework, params) => ({
    framework,
    explanation: `The chart above splits ${params.routePattern ?? 'this route'}'s p95 across your code, the database, and outbound calls. Focus on the largest slice.`,
    docsUrl: 'https://web.dev/articles/ttfb'
  }),
  'unstable-latency': (framework, params) => ({
    framework,
    explanation: `${params.routePattern ?? 'This route'} is usually fast but a minority of requests hit a cliff. Open the slow tail in the Inspector to find what those requests have in common (cold cache, a missing index, or a slow dependency).`,
    docsUrl: 'https://web.dev/articles/ttfb'
  }),
  'error-hotspot': (framework, params) => ({
    framework,
    explanation: `${params.routePattern ?? 'This route'} returns errors more often than expected. Open the failing spans to see the status codes and messages, then fix the most common cause.`,
    docsUrl: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Status'
  })
}

export const FIX_TEMPLATES: Record<string, Record<string, Template> | Template> = {
  'uncompressed-responses': uncompressed,
  'missing-cache-headers': missingCache,
  'oversized-payload': genericGuidance['oversized-payload'] as Template,
  'slow-route': genericGuidance['slow-route'] as Template,
  'where-time-goes': genericGuidance['where-time-goes'] as Template,
  'unstable-latency': genericGuidance['unstable-latency'] as Template,
  'n-plus-one': genericGuidance['n-plus-one'] as Template,
  'sequential-outbound': genericGuidance['sequential-outbound'] as Template,
  'slow-dependency': genericGuidance['slow-dependency'] as Template,
  'error-hotspot': genericGuidance['error-hotspot'] as Template
}

export const GENERIC_FALLBACK: Record<string, Template> = {
  'uncompressed-responses': generic(
    'Enable response compression (gzip or brotli) in your server or a reverse proxy so text responses download faster.',
    compressionDocs
  ),
  'missing-cache-headers': generic(
    'Send Cache-Control (and an ETag) on cacheable GET responses so clients and proxies can reuse them.',
    cacheDocs
  )
}
