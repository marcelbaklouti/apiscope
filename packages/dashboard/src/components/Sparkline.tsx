import { useEffect, useRef } from 'react'

export function Sparkline({ values }: { values: number[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const context = canvas.getContext('2d')
    if (context === null) return
    const width = canvas.width
    const height = canvas.height
    context.clearRect(0, 0, width, height)
    if (values.length < 2) return
    const max = Math.max(...values, 1)
    context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-dim')
    context.beginPath()
    values.forEach((value, index) => {
      const x = (index / (values.length - 1)) * (width - 2) + 1
      const y = height - 2 - (value / max) * (height - 4)
      if (index === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    })
    context.stroke()
  }, [values])
  return <canvas ref={canvasRef} width={90} height={20} aria-hidden="true" />
}
