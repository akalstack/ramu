import { reducedMotion } from './panelMotion'
const EASING = 'cubic-bezier(0.2, 0, 0, 1)'
/** Beyond this height, animating height re-lays-out the whole section every frame and stutters. */
const CHEAP_HEIGHT = 320

/**
 * Opens or closes a section. Small sections slide (height + fade). Tall ones only fade and lift, which the compositor
 * handles without re-laying-out the content each frame, so they stay smooth however much is inside.
 * `done` runs once the animation has finished (or at once when motion is reduced).
 */
export function slide(el: HTMLElement, open: boolean, done?: () => void): void {
  el.getAnimations().forEach((animation) => animation.cancel())
  if (reducedMotion()) { done?.(); return }
  const height = open ? el.scrollHeight : el.offsetHeight
  const cheap = height <= CHEAP_HEIGHT
  const hidden = { opacity: 0, transform: 'translateY(-6px)' }, shown = { opacity: 1, transform: 'translateY(0)' }
  const frames = cheap
    ? open ? [{ height: '0px', ...hidden }, { height: `${height}px`, ...shown }] : [{ height: `${height}px`, ...shown }, { height: '0px', ...hidden }]
    : open ? [hidden, shown] : [shown, hidden]
  if (cheap) el.style.overflow = 'hidden'
  el.style.contain = 'layout style'
  const animation = el.animate(frames, { duration: cheap ? 160 : 140, easing: EASING })
  const finish = () => { el.style.overflow = ''; el.style.contain = ''; done?.() }
  animation.onfinish = finish
  animation.oncancel = () => { el.style.overflow = ''; el.style.contain = '' }
}
