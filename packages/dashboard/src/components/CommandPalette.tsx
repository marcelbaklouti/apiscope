import { useEffect, useMemo, useState } from 'react'
import { useHashRoute } from '../lib/router'
import { useDashboardStore } from '../lib/store'

interface Command {
  label: string
  target: string
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const routes = useDashboardStore((state) => state.routes)
  const { navigate } = useHashRoute()

  const commands = useMemo((): Command[] => {
    const views: Command[] = [
      { label: 'go to overview', target: '/' },
      { label: 'go to routes', target: '/routes' },
      { label: 'go to inspector', target: '/inspector' },
      { label: 'go to load', target: '/load' },
      { label: 'go to runs', target: '/runs' },
      { label: 'go to config', target: '/config' }
    ]
    const routeCommands = routes.map((route) => ({
      label: `route ${route.method} ${route.pattern}`,
      target: '/routes'
    }))
    const lowered = query.toLowerCase()
    return [...views, ...routeCommands].filter((command) => command.label.toLowerCase().includes(lowered))
  }, [routes, query])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault()
        setOpen((current) => !current)
        setQuery('')
        setSelectedIndex(0)
      }
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  if (!open) return null

  const run = (command: Command | undefined) => {
    if (command === undefined) return
    navigate(command.target)
    setOpen(false)
  }

  return (
    <div className="palette" role="dialog" aria-label="command palette" onClick={() => setOpen(false)}>
      <div onClick={(event) => event.stopPropagation()}>
        <input
          autoFocus
          data-testid="palette-input"
          value={query}
          placeholder="type a command"
          onChange={(event) => {
            setQuery(event.target.value)
            setSelectedIndex(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') setSelectedIndex((index) => Math.min(index + 1, commands.length - 1))
            if (event.key === 'ArrowUp') setSelectedIndex((index) => Math.max(index - 1, 0))
            if (event.key === 'Enter') run(commands[selectedIndex])
          }}
        />
        <ul>
          {commands.slice(0, 12).map((command, index) => (
            <li
              key={command.label}
              data-selected={index === selectedIndex}
              onClick={() => run(command)}
              style={{ cursor: 'pointer' }}
            >
              {command.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
