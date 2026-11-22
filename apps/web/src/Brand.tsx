import { reducedMotion } from './workspace/panelMotion'
import { t, useLanguage } from './i18n'
import { Button } from '@/components/desktop-button'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import wordmark from '../../../assets/wordmark.svg'
import { MARK, MARK_VIEW_BOX, MARK_WAKE, STARTUP_FADE, STARTUP_MARK_SIZE } from '@ramu/shared/brandMark'

/** The same r + dot as the app icon, without its tile, for quiet empty states. */
export function AnimatedMark({ size, className = '' }: { size: number; className?: string }) {
  useLanguage()
  const stem = useRef<SVGPathElement>(null)
  const dot = useRef<SVGCircleElement>(null)

  return (
    <Button
      variant="secondary"
      className="bg-fill hover:bg-fill-hover animated-mark-button [&:is(button):hover:not(:disabled)]:bg-transparent [&:is(button):hover:not(:disabled)]:[border:0] [&:is(button):hover:not(:disabled)]:[box-shadow:none] [&:is(button):active]:bg-transparent [&:is(button):active]:[border:0] [&:is(button):active]:[box-shadow:none] [&:focus-visible]:[outline:2px_solid_var(--line-strong)] [&:focus-visible]:[outline-offset:6px] inline-flex self-center shrink-0 p-0 [border:0] rounded-(--radius-m) bg-transparent cursor-pointer leading-[0]"
      type="button"
      aria-label={t('Animate Ramu logo')}
      onClick={() => {
        wakeMark(stem.current, dot.current)
      }}
    >
      <svg
        className={`size-auto animated-mark [&.start-mark]:bg-transparent [&.start-mark]:[border-radius:0] [&.start-mark]:mb-3 overflow-visible shrink-0 ${className}`}
        width={size}
        height={size}
        viewBox="240 240 540 540"
        fill="none"
        aria-hidden="true"
      >
        <path
          ref={stem}
          className="animated-mark-stem"
          d={MARK.stem}
          pathLength="1"
          style={{ stroke: 'var(--brand-mark)' }}
          strokeWidth="120"
          strokeLinecap="round"
        />
        <circle ref={dot} className="animated-mark-dot" {...MARK.dot} fill={MARK.dotColor} />
      </svg>
    </Button>
  )
}

/** The r + dot in the current text color: Ramu's own tool calls in a chat, sized like any other tool icon. */
export function RamuGlyph({ size, className }: { size: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox={MARK_VIEW_BOX} fill="none" aria-hidden="true">
      <path d={MARK.stem} stroke="currentColor" strokeWidth="120" strokeLinecap="round" />
      <circle {...MARK.dot} fill="currentColor" />
    </svg>
  )
}

export function BootScreen() {
  useLanguage()
  return (
    // The startup screen's mark at its size and place, so a slow settings read looks like the same screen held.
    <div className="boot h-full grid place-items-center bg-canvas" role="status" aria-label={t('Starting Ramu')}>
      <svg width={STARTUP_MARK_SIZE} height={STARTUP_MARK_SIZE} viewBox={MARK_VIEW_BOX} fill="none" aria-hidden="true">
        <path d={MARK.stem} style={{ stroke: 'var(--brand-mark)' }} strokeWidth="120" strokeLinecap="round" />
        <circle {...MARK.dot} fill={MARK.dotColor} />
      </svg>
    </div>
  )
}

/**
 * The mark wakes: the stem rocks and the dot hops, from the shared keyframes the phone uses too. Returns when it settles,
 * at once with reduced motion.
 */
function wakeMark(stem: SVGElement | null, dot: SVGElement | null): Promise<void> {
  if (!stem || !dot || reducedMotion() || typeof stem.animate !== 'function') return Promise.resolve()
  const timing = { duration: MARK_WAKE.duration, easing: 'ease-in-out' }
  stem.style.transformOrigin = `${MARK.stemPivot[0]}px ${MARK.stemPivot[1]}px`
  dot.style.transformOrigin = `${MARK.dot.cx}px ${MARK.dot.cy}px`
  stem.animate(
    MARK_WAKE.stem.map((frame) => ({ offset: frame.at, transform: `rotate(${frame.rotate}deg)` })),
    timing,
  )
  const hop = dot.animate(
    MARK_WAKE.dot.map((frame) => ({
      offset: frame.at,
      transform: `translate(${frame.x}px, ${frame.y}px) scale(${frame.scaleX}, ${frame.scaleY})`,
    })),
    timing,
  )
  return hop.finished.then(
    () => undefined,
    () => undefined,
  )
}

/**
 * Keeps the mark on screen while the nested application providers load. It starts where the phone's launch image
 * leaves it, the same size in the middle, wakes once, and fades into the app when that is ready.
 */
export function StartupScreen({ ready, children }: { ready: boolean; children: ReactNode }) {
  useLanguage()
  const [motionDone, setMotionDone] = useState(false)
  const [closed, setClosed] = useState(false)
  const stem = useRef<SVGPathElement>(null)
  const dot = useRef<SVGCircleElement>(null)
  const released = ready && motionDone
  useEffect(() => {
    let alive = true
    void wakeMark(stem.current, dot.current).then(() => alive && setMotionDone(true))
    // Also release if the renderer suppresses animations.
    const timer = window.setTimeout(() => setMotionDone(true), MARK_WAKE.duration + 600)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [])
  useEffect(() => {
    if (!released) return
    const timer = window.setTimeout(() => setClosed(true), STARTUP_FADE + 20)
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
          className={`startup-overlay [&.startup-released]:opacity-0 [&.startup-released]:pointer-events-none fixed inset-0 z-1000 grid place-items-center bg-canvas opacity-100 ${released ? ' startup-released' : ''}`}
          style={{ transition: reducedMotion() ? 'none' : `opacity ${STARTUP_FADE}ms ease` }}
          role="status"
          aria-label={t('Starting Ramu')}
          aria-hidden={released}
        >
          <svg
            width={STARTUP_MARK_SIZE}
            height={STARTUP_MARK_SIZE}
            viewBox={MARK_VIEW_BOX}
            fill="none"
            className="overflow-visible"
            aria-hidden="true"
          >
            <path
              ref={stem}
              d={MARK.stem}
              style={{ stroke: 'var(--brand-mark)' }}
              strokeWidth="120"
              strokeLinecap="round"
            />
            <circle
              ref={dot}
              {...MARK.dot}
              fill={MARK.dotColor}
              // Once the mark has woken and the app is still loading, the dot breathes so a slow start reads as loading.
              className={motionDone && !ready ? 'startup-waiting' : undefined}
            />
          </svg>
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
