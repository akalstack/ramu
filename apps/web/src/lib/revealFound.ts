import { reducedMotion } from '../workspace/panelMotion'

/** Lights `target` once with the shared found-flash, restarting it when the same element is found twice. */
function flash(target: HTMLElement) {
  target.classList.remove('found-flash')
  void target.offsetWidth
  target.classList.add('found-flash')
  target.addEventListener('animationend', () => target.classList.remove('found-flash'), { once: true })
}

/**
 * Brings something a person looked for into the middle of `scroller` and lights it: a setting from search, the message a
 * quote came from. The light starts once the scroll settles, so it is seen rather than spent while the page moves.
 */
export function revealFound(target: HTMLElement, scroller: HTMLElement | null = scrollParent(target)) {
  const box = target.getBoundingClientRect()
  const view = scroller?.getBoundingClientRect()
  const visible = !!view && box.top >= view.top + 24 && box.bottom <= view.bottom - 24
  if (visible || !scroller || reducedMotion()) {
    target.scrollIntoView({ block: 'center' })
    flash(target)
    return
  }
  target.scrollIntoView({ block: 'center', behavior: 'smooth' })
  let done = false
  const settle = () => {
    if (done) return
    done = true
    flash(target)
  }
  scroller.addEventListener('scrollend', settle, { once: true })
  // Browsers without scrollend, or a scroll too short to fire it.
  window.setTimeout(settle, 450)
}

/** The nearest ancestor that scrolls, for a target whose list does not name its scroller. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement)
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight)
      return parent
  return null
}
