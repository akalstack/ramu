import { useEffect, useRef } from 'react'

/* Dot field behind the hero. Signals travel along rows and hand off to the next row, echoing provider fallback. */

const GAP = 26
const ACCENT = [183, 166, 243] as const
const PRIMARY = [118, 82, 212] as const

type Signal = { row: number; x: number; speed: number; color: readonly [number, number, number] }

export function Backdrop() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let width = 0
    let height = 0
    let cols = 0
    let rows = 0
    let frame = 0
    let visible = true
    const signals: Signal[] = []

    const spawn = (row?: number): Signal => ({
      row: row ?? Math.floor(Math.random() * rows),
      x: -GAP * 4,
      speed: 0.6 + Math.random() * 0.9,
      color: Math.random() < 0.5 ? ACCENT : PRIMARY,
    })

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = width * dpr
      canvas.height = height * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      cols = Math.ceil(width / GAP) + 1
      rows = Math.ceil(height / GAP) + 1
      signals.length = 0
      for (let i = 0; i < Math.max(4, Math.round(rows / 4)); i++) {
        const s = spawn()
        s.x = Math.random() * width
        signals.push(s)
      }
    }

    const draw = () => {
      ctx.clearRect(0, 0, width, height)
      for (let r = 0; r < rows; r++) {
        const y = r * GAP + GAP / 2
        const lit = signals.filter((s) => s.row === r)
        for (let c = 0; c < cols; c++) {
          const x = c * GAP + GAP / 2
          let glow = 0
          let color: readonly [number, number, number] = ACCENT
          for (const s of lit) {
            const d = s.x - x
            // Bright head, fading trail behind it.
            const g = d >= 0 ? Math.max(0, 1 - d / (GAP * 7)) : Math.max(0, 1 + d / (GAP * 0.8))
            if (g > glow) {
              glow = g
              color = s.color
            }
          }
          if (glow > 0.02) {
            ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${0.12 + glow * 0.75})`
            ctx.beginPath()
            ctx.arc(x, y, 1.1 + glow * 1.3, 0, Math.PI * 2)
            ctx.fill()
          } else {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.07)'
            ctx.fillRect(x - 0.75, y - 0.75, 1.5, 1.5)
          }
        }
      }
    }

    const tick = () => {
      for (let i = 0; i < signals.length; i++) {
        const s = signals[i]!
        s.x += s.speed
        // Past the edge: hand off to a neighbouring row.
        if (s.x > width + GAP * 8) {
          const next = Math.min(rows - 1, Math.max(0, s.row + (Math.random() < 0.5 ? 1 : 2)))
          signals[i] = spawn(next >= rows - 1 ? 0 : next)
        }
      }
      draw()
      if (visible) frame = requestAnimationFrame(tick)
    }

    resize()
    if (reduced) {
      draw()
    } else {
      frame = requestAnimationFrame(tick)
    }

    const observer = new IntersectionObserver(([entry]) => {
      const was = visible
      visible = !!entry?.isIntersecting
      if (visible && !was && !reduced) frame = requestAnimationFrame(tick)
      if (!visible) cancelAnimationFrame(frame)
    })
    observer.observe(canvas)
    const onResize = () => {
      resize()
      if (reduced) draw()
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return <canvas ref={ref} className="backdrop" aria-hidden="true" />
}
