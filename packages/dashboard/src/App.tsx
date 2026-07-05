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

function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState(() => localStorage.getItem('apiscope-theme') ?? 'dark')
  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
    localStorage.setItem('apiscope-theme', theme)
  }, [theme])
  return [theme, () => setTheme(theme === 'dark' ? 'light' : 'dark')]
}

export function App() {
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
      <LatencyStrip />
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
