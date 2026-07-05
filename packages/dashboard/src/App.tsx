import { useEffect, useState } from 'react'
import { Link, useHashRoute } from './lib/router'
import { useLiveConnection } from './lib/live'
import { useDashboardStore } from './lib/store'
import { LatencyStrip } from './components/LatencyStrip'
import { CommandPalette } from './components/CommandPalette'
import { Overview } from './views/Overview'
import { Routes } from './views/Routes'
import { Inspector } from './views/Inspector'
import { LoadView } from './views/LoadView'
import { Runs } from './views/Runs'
import { ConfigView } from './views/ConfigView'
import { Login } from './views/Login'

function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState(() => localStorage.getItem('apiscope-theme') ?? 'dark')
  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
    localStorage.setItem('apiscope-theme', theme)
  }, [theme])
  return [theme, () => setTheme(theme === 'dark' ? 'light' : 'dark')]
}

interface SessionState {
  loading: boolean
  authenticated: boolean
  requiresLoginRedirect: boolean
}

function useSession(): [SessionState, () => void] {
  const [state, setState] = useState<SessionState>({ loading: true, authenticated: false, requiresLoginRedirect: false })
  const [refetchToken, setRefetchToken] = useState(0)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch('/api/session')
        const body = (await response.json()) as { authenticated: boolean; requiresLoginRedirect?: boolean }
        if (!cancelled) {
          setState({ loading: false, authenticated: body.authenticated, requiresLoginRedirect: body.requiresLoginRedirect ?? true })
        }
      } catch {
        if (!cancelled) setState({ loading: false, authenticated: true, requiresLoginRedirect: false })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refetchToken])
  return [state, () => setRefetchToken((token) => token + 1)]
}

export function App() {
  const [session, refetchSession] = useSession()
  if (session.loading) return null
  if (!session.authenticated && session.requiresLoginRedirect) return <Login onAuthenticated={refetchSession} />
  return <DashboardShell />
}

function DashboardShell() {
  const { segments } = useHashRoute()
  const connected = useLiveConnection()
  const droppedTotal = useDashboardStore((state) => state.droppedTotal)
  const [theme, toggleTheme] = useTheme()
  const view = segments[0] ?? 'overview'
  return (
    <div className="layout">
      <header className="topbar">
        <strong>apiscope</strong>
        <nav aria-label="views">
          <Link to="/">Overview</Link>
          <Link to="/routes">Routes</Link>
          <Link to="/inspector">Inspector</Link>
          <Link to="/load">Load</Link>
          <Link to="/runs">Runs</Link>
          <Link to="/config">Config</Link>
        </nav>
        <span style={{ marginLeft: 'auto' }} className="metric" data-testid="connection">
          {connected ? 'live' : 'disconnected'}
        </span>
        <button onClick={toggleTheme} aria-label="toggle theme">
          {theme === 'dark' ? 'light' : 'dark'}
        </button>
      </header>
      {!connected && (
        <div className="banner" data-kind="error" role="status">
          collector connection lost, reconnecting
        </div>
      )}
      {connected && droppedTotal > 0 && (
        <div className="banner" data-kind="warn" role="status">
          {droppedTotal} events dropped by adapters, numbers may be incomplete
        </div>
      )}
      <LatencyStrip theme={theme} />
      <main>
        {view === 'overview' && <Overview />}
        {view === 'routes' && <Routes />}
        {view === 'inspector' && <Inspector spanId={segments[1] ?? null} />}
        {view === 'load' && <LoadView />}
        {view === 'runs' && <Runs runId={segments[1] ?? null} />}
        {view === 'config' && <ConfigView />}
      </main>
      <CommandPalette />
    </div>
  )
}
