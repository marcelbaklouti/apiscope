import { useEffect, useState } from 'react'
import { api } from '../lib/api'

export function ConfigView() {
  const [meta, setMeta] = useState<unknown>(null)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    void api
      .meta()
      .then((response) => setMeta(response.meta))
      .finally(() => setLoaded(true))
  }, [])
  if (!loaded) return <div className="empty">loading</div>
  if (meta === null) return <div className="empty">no apiscope.config.ts resolved by the cli</div>
  return (
    <section className="card">
      <h2>resolved configuration (read-only)</h2>
      <pre className="mono" data-testid="config-json">
        {JSON.stringify(meta, null, 2)}
      </pre>
    </section>
  )
}
