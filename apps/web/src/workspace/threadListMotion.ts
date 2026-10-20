import { reducedMotion } from './panelMotion'

const ROW = '[data-thread-motion-row]'
const DURATION = 180
let active: { users: number; release: () => void; timer?: ReturnType<typeof setTimeout> } | undefined

/** Observe only list changes during an action; requests and host refreshes never wait for animation. */
function watchLists() {
  let rows = new Map<HTMLElement, DOMRect>()
  let frame = 0
  const animations = new Map<HTMLElement, Animation>()
  const read = () =>
    new Map(
      [...document.querySelectorAll<HTMLElement>(ROW)]
        .map((row) => [row, row.getBoundingClientRect()] as const)
        .filter(([, rect]) => rect.width > 0 && rect.height > 0),
    )
  const easing = getComputedStyle(document.documentElement).getPropertyValue('--ease').trim() || 'ease-out'
  const options = { duration: DURATION, easing }
  const update = () => {
    frame = 0
    for (const animation of animations.values()) animation.cancel()
    animations.clear()
    const next = read()
    if (!reducedMotion() && !document.hidden) {
      for (const [row, before] of rows) {
        const after = next.get(row)
        if (after) {
          const x = before.left - after.left,
            y = before.top - after.top
          if (Math.abs(x) > 0.5 || Math.abs(y) > 0.5)
            animations.set(
              row,
              row.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: 'none' }], options),
            )
        } else if (!row.isConnected && before.bottom > 0 && before.top < innerHeight) {
          // A noninteractive snapshot can fade out even when React removed the last row or its whole group.
          const ghost = row.cloneNode(true) as HTMLElement
          ghost.removeAttribute('data-thread-motion-row')
          ghost.removeAttribute('id')
          for (const child of ghost.querySelectorAll('[id], [data-thread-motion-row]')) {
            child.removeAttribute('id')
            child.removeAttribute('data-thread-motion-row')
          }
          ghost.inert = true
          ghost.setAttribute('aria-hidden', 'true')
          Object.assign(ghost.style, {
            position: 'fixed',
            left: `${before.left}px`,
            top: `${before.top}px`,
            width: `${before.width}px`,
            height: `${before.height}px`,
            margin: '0',
            boxSizing: 'border-box',
            pointerEvents: 'none',
            zIndex: '100',
          })
          document.body.append(ghost)
          const remove = () => ghost.remove()
          ghost
            .animate([{ opacity: 1 }, { opacity: 0, transform: 'translateX(4px)' }], options)
            .finished.then(remove, remove)
        }
      }
      for (const [row] of next)
        if (!rows.has(row))
          animations.set(
            row,
            row.animate(
              [
                { opacity: 0, transform: 'translateY(4px)' },
                { opacity: 1, transform: 'none' },
              ],
              options,
            ),
          )
    }
    rows = next
  }
  rows = read()
  const observer = new MutationObserver((records) => {
    const relevant = records.some(
      (record) =>
        (record.target instanceof Element && record.target.closest(ROW)) ||
        [...record.addedNodes, ...record.removedNodes].some(
          (node) => node instanceof Element && (node.matches(ROW) || node.querySelector(ROW)),
        ),
    )
    if (relevant && !frame) frame = requestAnimationFrame(update)
  })
  observer.observe(document.body, { childList: true, subtree: true })
  // Scrolling and resizing are navigation, not a list action; refresh the baseline without moving rows.
  const reset = () => {
    if (!frame) rows = read()
  }
  document.addEventListener('scroll', reset, true)
  window.addEventListener('resize', reset)
  return () => {
    observer.disconnect()
    cancelAnimationFrame(frame)
    document.removeEventListener('scroll', reset, true)
    window.removeEventListener('resize', reset)
  }
}

export async function animateThreadListChange<T>(action: () => Promise<T>): Promise<T> {
  if (typeof document === 'undefined' || reducedMotion() || document.hidden) return action()
  active ??= { users: 0, release: watchLists() }
  const current = active
  clearTimeout(current.timer)
  current.users++
  try {
    return await action()
  } finally {
    if (--current.users === 0)
      current.timer = setTimeout(() => {
        current.release()
        if (active === current) active = undefined
      }, DURATION * 2)
  }
}
