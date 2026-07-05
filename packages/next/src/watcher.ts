import { existsSync, watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'

export function watchRoutes(projectDir: string, onChange: () => void): () => void {
  const watchers: FSWatcher[] = []
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  const notify = () => {
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(onChange, 300)
  }
  for (const directory of ['app', join('src', 'app'), 'pages', join('src', 'pages')]) {
    const fullPath = join(projectDir, directory)
    if (!existsSync(fullPath)) continue
    try {
      watchers.push(watch(fullPath, { recursive: true }, notify))
    } catch {}
  }
  return () => {
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    for (const watcher of watchers) watcher.close()
  }
}
