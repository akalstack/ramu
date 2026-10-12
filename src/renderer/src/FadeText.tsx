import { useLayoutEffect, useRef } from 'react'

const ROW = '.project-row, .task-row'

/**
 * One line of text that fades only at an edge that has more text beyond it, like every other scroll fade (`.fade-text` in styles.css).
 * While the row it sits in is hovered or focused, the text scrolls to reveal the rest, then back when the pointer leaves.
 */
export function FadeText({ text, className = '' }: { text: string; className?: string }) {
  const box = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const row = el.closest<HTMLElement>(ROW)
    let frame = 0, timer: number | undefined
    const fades = () => {
      el.toggleAttribute('data-fade-left', el.scrollLeft > 1)
      el.toggleAttribute('data-fade-right', el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
    }
    const stop = () => { cancelAnimationFrame(frame); window.clearTimeout(timer) }
    const slideTo = (target: number, delay: number) => {
      stop()
      timer = window.setTimeout(() => {
        const from = el.scrollLeft, start = performance.now(), duration = Math.min(4000, Math.max(300, Math.abs(target - from) * 20))
        const step = (now: number) => {
          const t = Math.min(1, (now - start) / duration)
          el.scrollLeft = from + (target - from) * t
          fades()
          if (t < 1) frame = requestAnimationFrame(step)
        }
        frame = requestAnimationFrame(step)
      }, delay)
    }
    const enter = () => { const overflow = el.scrollWidth - el.clientWidth; if (overflow > 1) slideTo(overflow, 350) }
    // Going back is immediate: only the slide forward is animated.
    const leave = () => { stop(); el.scrollLeft = 0; fades() }
    fades()
    const observer = new ResizeObserver(fades)
    observer.observe(el)
    row?.addEventListener('mouseenter', enter); row?.addEventListener('mouseleave', leave)
    row?.addEventListener('focusin', enter); row?.addEventListener('focusout', leave)
    return () => { stop(); observer.disconnect(); row?.removeEventListener('mouseenter', enter); row?.removeEventListener('mouseleave', leave); row?.removeEventListener('focusin', enter); row?.removeEventListener('focusout', leave) }
  }, [text])
  return <span ref={box} className={`fade-text block min-w-0 overflow-hidden whitespace-nowrap [text-overflow:clip] [--fade-l:0px] [--fade-r:0px] [mask-image:linear-gradient(to_right,_transparent_0,_#000_var(--fade-l),_#000_calc(100%_-_var(--fade-r)),_transparent_100%)] [transition:--fade-l_0.14s_ease-out,_--fade-r_0.14s_ease-out] ${className}`} title={text}>{text}</span>
}
