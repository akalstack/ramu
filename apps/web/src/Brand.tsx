import { reducedMotion } from './workspace/panelMotion'
import { t, useLanguage } from './i18n'
import { Button } from '@/components/desktop-button'
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import icon from '../../../assets/icon.svg'
import wordmark from '../../../assets/wordmark.svg'
import startupLogo from '../../../assets/startup-logo.svg?raw'

// Shared across screen mounts, reset when the app's renderer starts again.
let markRevealed = false

/** The approved flat app icon, shared with the desktop and README assets. */
export function BrandMark({ size, className }: { size: number; className?: string }) {
  useLanguage()
  return <img className={className} src={icon} width={size} height={size} alt="" draggable={false} />
}

/** The same r + dot as the app icon, without its tile, for quiet empty states. */
export function AnimatedMark({ size, className = '' }: { size: number; className?: string }) {
  useLanguage()
  const [reveal, setReveal] = useState(false)
  const [tap, setTap] = useState(0)
  useLayoutEffect(() => {
    if (markRevealed) return
    markRevealed = true
    setReveal(true)
  }, [])

  return (
    <Button
      variant="secondary"
      className="bg-fill hover:bg-fill-hover animated-mark-button [&:is(button):hover:not(:disabled)]:bg-transparent [&:is(button):hover:not(:disabled)]:[border:0] [&:is(button):hover:not(:disabled)]:[box-shadow:none] [&:is(button):active]:bg-transparent [&:is(button):active]:[border:0] [&:is(button):active]:[box-shadow:none] [&:focus-visible]:[outline:2px_solid_var(--line-strong)] [&:focus-visible]:[outline-offset:6px] inline-flex self-center shrink-0 p-0 [border:0] rounded-(--radius-m) bg-transparent cursor-pointer leading-[0]"
      type="button"
      aria-label={t('Animate Ramu logo')}
      onClick={() => {
        setReveal(false)
        setTap((count) => count + 1)
      }}
    >
      <svg
        key={tap}
        className={`size-auto animated-mark [&.start-mark]:bg-transparent [&.start-mark]:[border-radius:0] [&.start-mark]:mb-3 overflow-visible shrink-0 ${tap ? 'animated-mark-tap' : reveal ? 'animated-mark-reveal' : ''} ${className}`}
        width={size}
        height={size}
        viewBox="240 240 540 540"
        fill="none"
        aria-hidden="true"
      >
        <path
          className="animated-mark-stem"
          d="M356 694V518C356 402 434 334 548 334"
          pathLength="1"
          style={{ stroke: 'var(--brand-mark)' }}
          strokeWidth="120"
          strokeLinecap="round"
        />
        <circle className="animated-mark-dot" cx="664" cy="622" r="72" fill="#7d6cff" />
      </svg>
    </Button>
  )
}

const MARK_STEM = 'M356 694V518C356 402 434 334 548 334'

/** The r + dot in the current text color: Ramu's own tool calls in a chat, sized like any other tool icon. */
export function RamuGlyph({ size, className }: { size: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="240 240 540 540" fill="none" aria-hidden="true">
      <path d={MARK_STEM} stroke="currentColor" strokeWidth="120" strokeLinecap="round" />
      <circle cx="664" cy="622" r="72" fill="currentColor" />
    </svg>
  )
}

export function BootScreen() {
  useLanguage()
  return (
    <div className="boot h-full grid place-items-center bg-canvas" role="status" aria-label={t('Starting Ramu')}>
      <BrandMark className="boot-mark [animation:ramu-boot_700ms_cubic-bezier(.22,_1,_.36,_1)_both]" size={104} />
    </div>
  )
}

/** Keep one animation mounted while the nested application providers load. */
export function StartupScreen({ ready, children }: { ready: boolean; children: ReactNode }) {
  useLanguage()
  const [motionDone, setMotionDone] = useState(() => reducedMotion())
  const [closed, setClosed] = useState(false)
  const released = ready && motionDone
  useEffect(() => {
    if (reducedMotion()) setMotionDone(true)
  }, [ready])
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const reduced = () => {
      if (media.matches) setMotionDone(true)
    }
    media.addEventListener('change', reduced)
    // Also release if animation events are suppressed by the renderer.
    const timer = window.setTimeout(() => setMotionDone(true), 1600)
    return () => {
      media.removeEventListener('change', reduced)
      window.clearTimeout(timer)
    }
  }, [])
  useEffect(() => {
    if (!released) return
    const timer = window.setTimeout(() => setClosed(true), 220)
    return () => window.clearTimeout(timer)
  }, [released])

  return (
    <>
      <div
        className="startup-content h-full"
        inert={!released}
        aria-hidden={!released}
        style={{ visibility: released ? 'visible' : 'hidden' }}
      >
        {children}
      </div>
      {!closed && (
        <div
          className={`startup-overlay [&.startup-released]:opacity-0 [&.startup-released]:pointer-events-none fixed inset-0 z-1000 grid place-items-center bg-canvas opacity-100 [transition:opacity_200ms_ease] ${released ? ' startup-released' : ''}`}
          role="status"
          aria-label={t('Starting Ramu')}
          aria-hidden={released}
        >
          <div
            className="startup-logo [&_>_svg]:block [&_>_svg]:w-full [&_>_svg]:h-auto [&_>_svg]:overflow-visible w-[min(280px,_calc(100vw_-_48px))] [color:var(--text)]"
            dangerouslySetInnerHTML={{ __html: startupLogo }}
            onAnimationEnd={(event) => {
              if (event.animationName === 'ramu-startup-dot') setMotionDone(true)
            }}
          />
        </div>
      )}
    </>
  )
}

/** The "ramu." wordmark, drawn for dark surfaces. */
export function Wordmark({ height, className }: { height: number; className?: string }) {
  useLanguage()
  return (
    <img
      className={`${className ?? ''} [:root[data-appearance='light']_&]:[filter:invert(1)_hue-rotate(180deg)]`}
      src={wordmark}
      height={height}
      alt="Ramu"
      draggable={false}
    />
  )
}
