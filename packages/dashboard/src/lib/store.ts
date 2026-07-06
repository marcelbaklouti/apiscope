import { create } from 'zustand'
import type { AppMetadata } from '@apiscope/core'
import type { Child, InsightsResponse, LoadProgress, RouteEntry, Span } from './types'

type InsightsGrouping = 'severity' | 'category' | 'route'

const spanLimit = 2000

interface DashboardState {
  spans: Span[]
  childSpansByParent: Record<string, Child[]>
  routes: RouteEntry[]
  apps: AppMetadata[]
  droppedTotal: number
  progressByRun: Record<string, { name: string; snapshot: LoadProgress; finished: boolean; ok: boolean | null }>
  insights: InsightsResponse | null
  insightsLoading: boolean
  insightsError: string | null
  insightsDismissed: string[]
  insightsGrouping: InsightsGrouping
  setInsights(response: InsightsResponse): void
  setInsightsLoading(loading: boolean): void
  setInsightsError(error: string | null): void
  dismissFinding(ruleId: string, routePattern: string | undefined): void
  restoreDismissed(): void
  setInsightsGrouping(grouping: InsightsGrouping): void
  addSpans(spans: Span[], childSpans: Child[], appName: string): void
  setRoutes(appName: string, routes: RouteEntry[]): void
  refreshRoutes(routes: RouteEntry[]): void
  appConnected(app: AppMetadata): void
  appDisconnected(appName: string): void
  addDropped(count: number): void
  loadProgress(runId: string, name: string, snapshot: LoadProgress): void
  loadFinished(runId: string, ok: boolean): void
  hydrate(spans: Span[], routes: RouteEntry[]): void
}

export const useDashboardStore = create<DashboardState>((set) => ({
  spans: [],
  childSpansByParent: {},
  routes: [],
  apps: [],
  droppedTotal: 0,
  progressByRun: {},
  insights: null,
  insightsLoading: false,
  insightsError: null,
  insightsDismissed: [],
  insightsGrouping: 'severity',
  setInsights: (response) => set({ insights: response, insightsError: null, insightsLoading: false }),
  setInsightsLoading: (loading) => set({ insightsLoading: loading }),
  setInsightsError: (error) => set({ insightsError: error, insightsLoading: false }),
  dismissFinding: (ruleId, routePattern) =>
    set((state) => {
      const key = `${ruleId}::${routePattern ?? ''}`
      return state.insightsDismissed.includes(key)
        ? state
        : { insightsDismissed: [...state.insightsDismissed, key] }
    }),
  restoreDismissed: () => set({ insightsDismissed: [] }),
  setInsightsGrouping: (grouping) => set({ insightsGrouping: grouping }),
  addSpans: (spans, childSpans, appName) =>
    set((state) => {
      void appName
      const childMap = { ...state.childSpansByParent }
      for (const child of childSpans) {
        childMap[child.parentSpanId] = [...(childMap[child.parentSpanId] ?? []), child]
      }
      return { spans: [...spans, ...state.spans].slice(0, spanLimit), childSpansByParent: childMap }
    }),
  setRoutes: (appName, routes) =>
    set((state) => {
      const previousByKey = new Map(
        state.routes
          .filter((route) => route.appName === appName)
          .map((route) => [`${route.method} ${route.pattern}`, route.nPlusOneRequests])
      )
      const merged = routes.map((route) => ({
        ...route,
        nPlusOneRequests: previousByKey.get(`${route.method} ${route.pattern}`) ?? route.nPlusOneRequests
      }))
      return { routes: [...state.routes.filter((route) => route.appName !== appName), ...merged] }
    }),
  refreshRoutes: (routes) => set({ routes }),
  appConnected: (app) =>
    set((state) => ({ apps: [...state.apps.filter((entry) => entry.name !== app.name), app] })),
  appDisconnected: (appName) => set((state) => ({ apps: state.apps.filter((entry) => entry.name !== appName) })),
  addDropped: (count) => set((state) => ({ droppedTotal: state.droppedTotal + count })),
  loadProgress: (runId, name, snapshot) =>
    set((state) => ({
      progressByRun: { ...state.progressByRun, [runId]: { name, snapshot, finished: false, ok: null } }
    })),
  loadFinished: (runId, ok) =>
    set((state) => {
      const existing = state.progressByRun[runId]
      if (existing === undefined) return state
      return { progressByRun: { ...state.progressByRun, [runId]: { ...existing, finished: true, ok } } }
    }),
  hydrate: (spans, routes) => set({ spans: spans.slice(0, spanLimit), routes })
}))
