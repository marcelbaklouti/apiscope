import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { useDashboardStore } from '../lib/store'
import type { FlameNode, StoredProfile } from '../lib/types'

interface PositionedFrame {
  node: FlameNode
  depth: number
  start: number
  width: number
}

function layoutFrames(root: FlameNode): PositionedFrame[] {
  const frames: PositionedFrame[] = []
  const rootValue = Math.max(root.value, 1)
  function visit(node: FlameNode, depth: number, start: number): void {
    frames.push({ node, depth, start, width: node.value / rootValue })
    let childStart = start
    for (const child of node.children) {
      visit(child, depth + 1, childStart)
      childStart += child.value / rootValue
    }
  }
  visit(root, 0, 0)
  return frames
}

function findNodeAtPath(root: FlameNode, path: number[]): FlameNode {
  let current = root
  for (const index of path) {
    const next = current.children[index]
    if (next === undefined) return current
    current = next
  }
  return current
}

function pathToNode(root: FlameNode, target: FlameNode): number[] | null {
  if (root === target) return []
  for (let index = 0; index < root.children.length; index += 1) {
    const child = root.children[index]
    if (child === undefined) continue
    const found = pathToNode(child, target)
    if (found !== null) return [index, ...found]
  }
  return null
}

const FRAME_ROW_HEIGHT = 22

function FlameRow({
  frame,
  onZoom,
  onHover
}: {
  frame: PositionedFrame
  onZoom: () => void
  onHover: (frame: PositionedFrame | null) => void
}) {
  const widthPercent = Math.max(frame.width * 100, 0.05)
  return (
    <div
      data-testid="flamegraph-frame"
      role="button"
      tabIndex={0}
      onClick={onZoom}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onZoom()
      }}
      onMouseEnter={() => onHover(frame)}
      onMouseLeave={() => onHover(null)}
      style={{
        position: 'absolute',
        left: `${frame.start * 100}%`,
        width: `${widthPercent}%`,
        top: frame.depth * FRAME_ROW_HEIGHT,
        height: FRAME_ROW_HEIGHT - 1,
        background: frame.depth === 0 ? 'var(--text-dim)' : 'var(--bg-raised)',
        border: '1px solid var(--border)',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
        padding: '0 4px',
        fontSize: 'var(--text-2xs)',
        lineHeight: `${FRAME_ROW_HEIGHT - 3}px`,
        cursor: 'pointer',
        boxSizing: 'border-box'
      }}
    >
      {frame.node.name}
    </div>
  )
}

function FrameReadout({ frame, rootValue }: { frame: PositionedFrame; rootValue: number }) {
  const selfMicros = frame.node.value - frame.node.children.reduce((sum, child) => sum + child.value, 0)
  const totalPercent = (frame.node.value / Math.max(rootValue, 1)) * 100
  return (
    <div className="card" data-testid="flamegraph-readout" style={{ marginBottom: 8 }}>
      <p className="mono" style={{ margin: 0, fontWeight: 600 }}>
        {frame.node.name}
      </p>
      <p className="metric" style={{ margin: '4px 0 0' }}>
        {frame.node.file === '' ? 'native' : `${frame.node.file}:${frame.node.line}`}
      </p>
      <p className="metric" style={{ margin: '4px 0 0' }}>
        self {(selfMicros / 1000).toFixed(2)}ms · total {(frame.node.value / 1000).toFixed(2)}ms ({totalPercent.toFixed(1)}%)
      </p>
    </div>
  )
}

export function Flamegraph() {
  const apps = useDashboardStore((state) => state.apps)
  const [appName, setAppName] = useState('')
  const [durationMs, setDurationMs] = useState(500)
  const [profileId, setProfileId] = useState<string | null>(null)
  const [profile, setProfile] = useState<StoredProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [zoomPath, setZoomPath] = useState<number[]>([])
  const [hovered, setHovered] = useState<PositionedFrame | null>(null)

  useEffect(() => {
    if (appName === '' && apps.length > 0) setAppName(apps[0]?.name ?? '')
  }, [apps, appName])

  useEffect(() => {
    if (profileId === null) return
    let cancelled = false
    const poll = () => {
      void api
        .profileById(profileId)
        .then((result) => {
          if (cancelled) return
          setProfile(result)
          setCapturing(false)
        })
        .catch(() => {
          if (cancelled) return
          setTimeout(poll, 200)
        })
    }
    poll()
    return () => {
      cancelled = true
    }
  }, [profileId])

  const capture = async () => {
    setError(null)
    setProfile(null)
    setZoomPath([])
    setCapturing(true)
    try {
      const { profileId: newProfileId } = await api.startProfile(appName, durationMs)
      setProfileId(newProfileId)
    } catch (captureError) {
      setCapturing(false)
      setError(captureError instanceof Error ? captureError.message : String(captureError))
    }
  }

  const zoomedRoot = useMemo(() => {
    if (profile === null) return null
    return findNodeAtPath(profile.flamegraph, zoomPath)
  }, [profile, zoomPath])

  const frames = useMemo(() => (zoomedRoot === null ? [] : layoutFrames(zoomedRoot)), [zoomedRoot])
  const maxDepth = frames.reduce((max, frame) => Math.max(max, frame.depth), 0)

  const framePath = (frame: PositionedFrame): number[] => {
    if (zoomedRoot === null) return zoomPath
    const relative = pathToNode(zoomedRoot, frame.node)
    return relative === null ? zoomPath : [...zoomPath, ...relative]
  }

  return (
    <div>
      <section className="card" style={{ marginBottom: 12 }}>
        <h2>capture cpu profile</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label>
            app
            <select value={appName} onChange={(event) => setAppName(event.target.value)}>
              {apps.length === 0 && <option value="">no apps connected</option>}
              {apps.map((app) => (
                <option key={app.name} value={app.name}>
                  {app.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            duration ms
            <input
              type="number"
              min={100}
              max={5000}
              value={durationMs}
              onChange={(event) => setDurationMs(Number(event.target.value))}
            />
          </label>
          <button
            className="primary"
            onClick={() => void capture()}
            disabled={capturing || appName === ''}
            data-testid="capture-profile"
          >
            {capturing ? 'capturing…' : 'capture'}
          </button>
          {profile !== null && (
            <a href={api.profilePprofUrl(profile.id)} download data-testid="download-pprof">
              <button type="button">download pprof</button>
            </a>
          )}
        </div>
        {error !== null && (
          <div className="banner" data-kind="error" style={{ marginTop: 8 }}>
            {error}
          </div>
        )}
      </section>
      {profile === null ? (
        <div className="empty">
          {capturing ? 'capturing on-cpu samples from the running app' : 'capture a profile to see the flame tree'}
        </div>
      ) : (
        <section className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>{profile.appName}</h2>
            {zoomPath.length > 0 && (
              <button onClick={() => setZoomPath([])} data-testid="flamegraph-reset-zoom">
                reset zoom
              </button>
            )}
          </div>
          {hovered !== null && zoomedRoot !== null && <FrameReadout frame={hovered} rootValue={zoomedRoot.value} />}
          <div
            data-testid="flamegraph-tree"
            style={{ position: 'relative', height: (maxDepth + 1) * FRAME_ROW_HEIGHT, marginTop: 8 }}
          >
            {frames.map((frame, index) => (
              <FlameRow
                key={index}
                frame={frame}
                onHover={setHovered}
                onZoom={() => setZoomPath(framePath(frame))}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
