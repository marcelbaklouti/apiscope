import { useEffect, useState, type ReactNode } from 'react'
import { Link, useHashRoute } from './lib/router'
import { useLiveConnection } from './lib/live'
import { useDashboardStore } from './lib/store'
import { LatencyStrip } from './components/LatencyStrip'
import { CommandPalette } from './components/CommandPalette'
import { Insights } from './views/Insights'
import { Overview } from './views/Overview'
import { Routes } from './views/Routes'
import { Inspector } from './views/Inspector'
import { LoadView } from './views/LoadView'
import { Runs } from './views/Runs'
import { ConfigView } from './views/ConfigView'
import { Login } from './views/Login'
import { Flamegraph } from './views/Flamegraph'
import { Dependencies } from './views/Dependencies'

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

interface PrimaryDestination {
  to: string
  label: string
  view: string
  icon: ReactNode
}

const PRIMARY_DESTINATIONS: PrimaryDestination[] = [
  {
    to: '/insights',
    label: 'Insights',
    view: 'insights',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M10 2.5a5.5 5.5 0 0 0-3 10.11V15h6v-2.39A5.5 5.5 0 0 0 10 2.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M8 17.5h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    )
  },
  {
    to: '/routes',
    label: 'Routes',
    view: 'routes',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M4 5.5h12M4 10h12M4 14.5h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    )
  },
  {
    to: '/inspector',
    label: 'Inspector',
    view: 'inspector',
    icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="8.75" cy="8.75" r="4.75" stroke="currentColor" strokeWidth="1.4" />
        <path d="m12.5 12.5 3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    )
  }
]

const MORE_DESTINATIONS: Array<{ to: string; label: string; view: string }> = [
  { to: '/overview', label: 'Overview', view: 'overview' },
  { to: '/flamegraph', label: 'Flamegraph', view: 'flamegraph' },
  { to: '/dependencies', label: 'Dependencies', view: 'dependencies' },
  { to: '/load', label: 'Load', view: 'load' },
  { to: '/runs', label: 'Runs', view: 'runs' },
  { to: '/config', label: 'Config', view: 'config' }
]

function MobileNav({ view, onOpenMore }: { view: string; onOpenMore: () => void }) {
  const moreActive = MORE_DESTINATIONS.some((destination) => destination.view === view)
  return (
    <nav className="mobile-nav" data-testid="mobile-nav" aria-label="primary">
      {PRIMARY_DESTINATIONS.map((destination) => {
        const active = destination.view === view || (destination.view === 'insights' && view === '')
        return (
          <a key={destination.to} className="mobile-nav-item" href={`#${destination.to}`} data-active={active}>
            {destination.icon}
            <span>{destination.label}</span>
          </a>
        )
      })}
      <button type="button" className="mobile-nav-item" data-testid="mobile-more-toggle" data-active={moreActive} onClick={onOpenMore}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="4.5" cy="10" r="1.4" fill="currentColor" />
          <circle cx="10" cy="10" r="1.4" fill="currentColor" />
          <circle cx="15.5" cy="10" r="1.4" fill="currentColor" />
        </svg>
        <span>More</span>
      </button>
    </nav>
  )
}

function MoreDrawer({ view, onClose }: { view: string; onClose: () => void }) {
  return (
    <div className="mobile-more-scrim" role="dialog" aria-label="more views" onClick={onClose}>
      <div className="mobile-more" data-testid="mobile-more" onClick={(event) => event.stopPropagation()}>
        <div className="mobile-more-grip" aria-hidden="true" />
        {MORE_DESTINATIONS.map((destination) => (
          <a
            key={destination.to}
            className="mobile-more-link"
            href={`#${destination.to}`}
            data-active={destination.view === view}
            onClick={onClose}
          >
            {destination.label}
          </a>
        ))}
      </div>
    </div>
  )
}

function DashboardShell() {
  const { segments } = useHashRoute()
  const connected = useLiveConnection()
  const droppedTotal = useDashboardStore((state) => state.droppedTotal)
  const [theme, toggleTheme] = useTheme()
  const [moreOpen, setMoreOpen] = useState(false)
  const view = segments[0] ?? 'insights'
  const insightsActive = view === 'insights' || segments.length === 0
  useEffect(() => {
    setMoreOpen(false)
  }, [view])
  return (
    <div className="layout">
      <header className="topbar">
        <strong>apiscope</strong>
        <nav aria-label="views">
          <Link to="/insights" data-active={insightsActive}>
            Insights
          </Link>
          <Link to="/overview">Overview</Link>
          <Link to="/routes">Routes</Link>
          <Link to="/inspector">Inspector</Link>
          <Link to="/flamegraph">Flamegraph</Link>
          <Link to="/dependencies">Dependencies</Link>
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
      <main data-view={view}>
        {view === 'insights' && <Insights />}
        {view === 'overview' && <Overview />}
        {view === 'routes' && <Routes />}
        {view === 'inspector' && segments[1] === 'run' && <Inspector spanId={segments[3] ?? null} loadRunId={segments[2] ?? null} />}
        {view === 'inspector' && segments[1] !== 'run' && <Inspector spanId={segments[1] ?? null} />}
        {view === 'flamegraph' && <Flamegraph />}
        {view === 'dependencies' && <Dependencies />}
        {view === 'load' && <LoadView />}
        {view === 'runs' && <Runs runId={segments[1] ?? null} />}
        {view === 'config' && <ConfigView />}
      </main>
      <MobileNav view={view} onOpenMore={() => setMoreOpen(true)} />
      {moreOpen && <MoreDrawer view={view} onClose={() => setMoreOpen(false)} />}
      <CommandPalette />
    </div>
  )
}
