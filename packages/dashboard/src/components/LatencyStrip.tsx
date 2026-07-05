import { useEffect, useRef } from 'react'
import { useHashRoute } from '../lib/router'
import { useDashboardStore } from '../lib/store'
import type { Span } from '../lib/types'

const windowMs = 60000
const heightPx = 72

function statusColor(statusCode: number): string {
  const styles = getComputedStyle(document.documentElement)
  if (statusCode >= 500 || statusCode === 0) return styles.getPropertyValue('--status-5xx')
  if (statusCode >= 400) return styles.getPropertyValue('--status-4xx')
  if (statusCode >= 300) return styles.getPropertyValue('--status-3xx')
  return styles.getPropertyValue('--status-2xx')
}

function positions(spans: Span[], width: number, now: number): Array<{ x: number; y: number; span: Span }> {
  const points: Array<{ x: number; y: number; span: Span }> = []
  for (const span of spans) {
    const age = now - span.timing.start
    if (age < 0 || age > windowMs) continue
    const x = width - (age / windowMs) * width
    const clamped = Math.min(Math.max(span.timing.duration, 0.5), 10000)
    const y = heightPx - 6 - (Math.log10(clamped * 2) / Math.log10(20000)) * (heightPx - 12)
    points.push({ x, y, span })
  }
  return points
}

export function LatencyStrip() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const spans = useDashboardStore((state) => state.spans)
  const { navigate } = useHashRoute()

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const ratio = window.devicePixelRatio || 1
    const width = canvas.clientWidth
    canvas.width = width * ratio
    canvas.height = heightPx * ratio
    const context = canvas.getContext('2d')
    if (context === null) return
    context.scale(ratio, ratio)
    context.clearRect(0, 0, width, heightPx)
    context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border')
    context.strokeRect(0.5, 0.5, width - 1, heightPx - 1)
    for (const point of positions(spans, width, Date.now())) {
      context.fillStyle = statusColor(point.span.statusCode)
      context.fillRect(point.x - 1.5, point.y - 1.5, 3, 3)
    }
  }, [spans])

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const bounds = canvas.getBoundingClientRect()
    const clickX = event.clientX - bounds.left
    const clickY = event.clientY - bounds.top
    let nearest: { distance: number; id: string } | null = null
    for (const point of positions(spans, canvas.clientWidth, Date.now())) {
      const distance = Math.hypot(point.x - clickX, point.y - clickY)
      if (distance < 8 && (nearest === null || distance < nearest.distance)) {
        nearest = { distance, id: point.span.id }
      }
    }
    if (nearest !== null) navigate(`/inspector/${nearest.id}`)
  }

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      style={{ width: '100%', height: heightPx, display: 'block', cursor: 'crosshair' }}
      aria-label="live latency timeline, one point per request"
      data-testid="latency-strip"
    />
  )
}
