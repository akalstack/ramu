import { Button } from '@/components/ui/button'
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import icon from '../../../assets/icon.svg'
import wordmark from '../../../assets/wordmark.svg'
import startupLogo from '../../../assets/startup-logo.svg?raw'

// Shared across screen mounts, reset when the app's renderer starts again.
let markRevealed = false

/** The approved flat app icon, shared with the desktop and README assets. */
export function BrandMark({ size, className }: { size: number; className?: string }) {
  return <img className={className} src={icon} width={size} height={size} alt="" draggable={false} />
}

/** The same r + dot as the app icon, without its tile, for quiet empty states. */
export function AnimatedMark({ size, className = '' }: { size: number; className?: string }) {
  const [reveal, setReveal] = useState(false)
  const [tap, setTap] = useState(0)
  useLayoutEffect(() => {
    if (markRevealed) return
    markRevealed = true
    setReveal(true)
  }, [])

  return <Button className="animated-mark-button" type="button" aria-label="Animate Ramu logo" onClick={() => {
    setReveal(false)
    setTap((count) => count + 1)
  }}>
    <svg key={tap} className={`animated-mark ${tap ? 'animated-mark-tap' : reveal ? 'animated-mark-reveal' : ''} ${className}`} width={size} height={size} viewBox="240 240 540 540" fill="none" aria-hidden="true">
      <path className="animated-mark-stem" d="M356 694V518C356 402 434 334 548 334" pathLength="1" stroke="#dedee3" strokeWidth="120" strokeLinecap="round" />
      <circle className="animated-mark-dot" cx="664" cy="622" r="72" fill="#7d6cff" />
    </svg>
  </Button>
}

export function BootScreen() {
  return <div className="boot" role="status" aria-label="Starting Ramu"><BrandMark className="boot-mark" size={104} /></div>
}

/** Keep one animation mounted while the nested application providers load. */
export function StartupScreen({ ready, children }: { ready: boolean; children: ReactNode }) {
  const [motionDone, setMotionDone] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [closed, setClosed] = useState(false)
  const released = ready && motionDone
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const reduced = () => { if (media.matches) setMotionDone(true) }
    media.addEventListener('change', reduced)
    // Also release if animation events are suppressed by the renderer.
    const timer = window.setTimeout(() => setMotionDone(true), 1600)
    return () => { media.removeEventListener('change', reduced); window.clearTimeout(timer) }
  }, [])
  useEffect(() => {
    if (!released) return
    const timer = window.setTimeout(() => setClosed(true), 220)
    return () => window.clearTimeout(timer)
  }, [released])

  return <>
    <div className="startup-content" inert={!released} aria-hidden={!released} style={{ visibility: released ? 'visible' : 'hidden' }}>{children}</div>
    {!closed && <div className={`startup-overlay${released ? ' startup-released' : ''}`} role="status" aria-label="Starting Ramu" aria-hidden={released}>
      <div className="startup-logo" dangerouslySetInnerHTML={{ __html: startupLogo }} onAnimationEnd={(event) => {
        if (event.animationName === 'ramu-startup-dot') setMotionDone(true)
      }} />
    </div>}
  </>
}

/** The "ramu." wordmark, drawn for dark surfaces. */
export function Wordmark({ height, className }: { height: number; className?: string }) {
  return <img className={className} src={wordmark} height={height} alt="Ramu" draggable={false} />
}
