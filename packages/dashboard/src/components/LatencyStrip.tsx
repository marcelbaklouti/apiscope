import { useLayoutEffect, useRef, useState } from 'react'
import { useHashRoute } from '../lib/router'
import { useDashboardStore } from '../lib/store'
import type { Span } from '../lib/types'

const windowMs = 60000
const heightPx = 72
const maxDurationMs = 10000
const yScaleMax = 20000

function statusColor(statusCode: number): string {
  const styles = getComputedStyle(document.documentElement)
  if (statusCode >= 500 || statusCode === 0) return styles.getPropertyValue('--status-5xx')
  if (statusCode >= 400) return styles.getPropertyValue('--status-4xx')
  if (statusCode >= 300) return styles.getPropertyValue('--status-3xx')
  return styles.getPropertyValue('--status-2xx')
}

function durationToY(durationMs: number): number {
  const clamped = Math.min(Math.max(durationMs, 0.5), maxDurationMs)
  return heightPx - 6 - (Math.log10(clamped * 2) / Math.log10(yScaleMax)) * (heightPx - 12)
}

function positions(spans: Span[], width: number, now: number): Array<{ x: number; y: number; span: Span }> {
  const points: Array<{ x: number; y: number; span: Span }> = []
  for (const span of spans) {
    const age = now - span.timing.start
    if (age < 0 || age > windowMs) continue
    const x = width - (age / windowMs) * width
    points.push({ x, y: durationToY(span.timing.duration), span })
  }
  return points
}

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null
  const rank = Math.min(sorted.length - 1, Math.floor(q * sorted.length))
  return sorted[rank] ?? null
}

export function LatencyStrip({ theme }: { theme: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const spans = useDashboardStore((state) => state.spans)
  const { navigate } = useHashRoute()
  const [hover, setHover] = useState<{ x: number; y: number; span: Span } | null>(null)

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const ratio = window.devicePixelRatio || 1
    const width = canvas.clientWidth
    canvas.width = width * ratio
    canvas.height = heightPx * ratio
    const context = canvas.getContext('2d')
    if (context === null) return
    const styles = getComputedStyle(document.documentElement)
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, width, heightPx)

    const now = Date.now()
    const visible = spans.filter((span) => now - span.timing.start >= 0 && now - span.timing.start <= windowMs)
    const durations = visible.map((span) => span.timing.duration).sort((a, b) => a - b)
    const p50 = quantile(durations, 0.5)
    const p95 = quantile(durations, 0.95)

    context.strokeStyle = styles.getPropertyValue('--border-hairline')
    context.lineWidth = 1
    for (const value of [p50, p95]) {
      if (value === null) continue
      const y = Math.round(durationToY(value)) + 0.5
      context.beginPath()
      context.moveTo(0, y)
      context.lineTo(width, y)
      context.stroke()
    }

    for (const point of positions(spans, width, now)) {
      context.fillStyle = statusColor(point.span.statusCode)
      context.fillRect(point.x - 1.5, point.y - 1.5, 3, 3)
    }

    context.strokeStyle = styles.getPropertyValue('--border')
    context.strokeRect(0.5, 0.5, width - 1, heightPx - 1)

    context.strokeStyle = styles.getPropertyValue('--accent')
    context.globalAlpha = 0.6
    context.beginPath()
    context.moveTo(width - 3.5, 1)
    context.lineTo(width - 3.5, heightPx - 1)
    context.stroke()
    context.globalAlpha = 1
  }, [spans, hover, theme])

  const pointAt = (event: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number; span: Span } | null => {
    const canvas = canvasRef.current
    if (canvas === null) return null
    const bounds = canvas.getBoundingClientRect()
    const pointerX = event.clientX - bounds.left
    const pointerY = event.clientY - bounds.top
    let nearest: { distance: number; x: number; y: number; span: Span } | null = null
    for (const point of positions(spans, canvas.clientWidth, Date.now())) {
      const distance = Math.hypot(point.x - pointerX, point.y - pointerY)
      if (distance < 8 && (nearest === null || distance < nearest.distance)) {
        nearest = { distance, x: point.x, y: point.y, span: point.span }
      }
    }
    return nearest
  }

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const point = pointAt(event)
    if (point !== null) navigate(`/inspector/${point.span.id}`)
  }

  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    setHover(pointAt(event))
  }

  return (
    <div style={{ position: 'relative' }}>
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(null)}
        style={{ width: '100%', height: heightPx, display: 'block', cursor: 'crosshair' }}
        aria-label="live latency timeline, one point per request"
        data-testid="latency-strip"
      />
      {hover !== null && (
        <div
          data-testid="latency-strip-tooltip"
          className="mono"
          style={{
            position: 'absolute',
            left: Math.min(Math.max(hover.x + 8, 4), (canvasRef.current?.clientWidth ?? 0) - 132),
            top: Math.min(Math.max(hover.y - 10, 2), heightPx - 34),
            background: 'var(--bg-raised)',
            border: '1px solid var(--border)',
            borderRadius: 3,
            padding: '4px 6px',
            fontSize: 'var(--text-2xs)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.24)'
          }}
        >
          {hover.span.method} {hover.span.actualPath} · {hover.span.timing.duration.toFixed(1)}ms · {hover.span.statusCode}
        </div>
      )}
    </div>
  )
}
