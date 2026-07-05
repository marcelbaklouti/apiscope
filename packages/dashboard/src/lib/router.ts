import { useSyncExternalStore, type AnchorHTMLAttributes, type ReactNode, createElement } from 'react'

function currentPath(): string {
  const hash = window.location.hash
  return hash.startsWith('#/') ? hash.slice(1) : '/'
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

export function useHashRoute(): { path: string; segments: string[]; navigate(path: string): void } {
  const path = useSyncExternalStore(subscribe, currentPath)
  return {
    path,
    segments: path.split('/').filter((segment) => segment !== ''),
    navigate(target: string) {
      window.location.hash = `#${target}`
    }
  }
}

export function Link(
  props: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; children: ReactNode }
): ReactNode {
  const { to, children, ...rest } = props
  const { segments } = useHashRoute()
  const firstSegment = `/${segments[0] ?? ''}`
  const active = to === '/' ? segments.length === 0 : firstSegment === to || to.startsWith(`${firstSegment}/`)
  return createElement('a', { href: `#${to}`, 'data-active': active, ...rest }, children)
}
