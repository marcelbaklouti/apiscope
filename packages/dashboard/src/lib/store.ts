import { create } from 'zustand'
import type { AppMetadata } from '@apiscope/core'
import type { Child, LoadProgress, RouteEntry, Span } from './types'

const spanLimit = 2000

interface DashboardState {
  spans: Span[]
  childSpansByParent: Record<string, Child[]>
  routes: RouteEntry[]
  apps: AppMetadata[]
  droppedTotal: number
  progressByRun: Record<string, { name: string; snapshot: LoadProgress; finished: boolean; ok: boolean | null }>
  addSpans(spans: Span[], childSpans: Child[], appName: string): void
  setRoutes(appName: string, routes: RouteEntry[]): void
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
    set((state) => ({
      routes: [...state.routes.filter((route) => route.appName !== appName), ...routes]
    })),
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
