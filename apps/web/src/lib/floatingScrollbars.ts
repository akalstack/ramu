import { dragScroll, thumbGeometry, type ScrollAxis } from './scrollThumb'

type Axis = 'x' | 'y'
const AXES: readonly Axis[] = ['x', 'y']
/** Thickness of the strip a thumb sits in and the gap around it, as OverlayScrollArea draws its own. */
const BAR_PX = { x: 7, y: 9 }
const PAD_PX = 2
const LINGER_MS = 800
/** A scroll counts as the person's own when it follows their input inside the container this closely. */
const INPUT_WINDOW_MS = 1000
/** How often a resting pointer is hit-tested again, since content can change under it. */
const HOVER_RECHECK_MS = 200
/** Monaco and xterm draw their own scrollbars. */
const SELF_DRAWN = '.monaco-editor, .xterm'
const NO_BAR_CLASSES = ['no-scrollbar', 'scrollbar-none', '[scrollbar-width:none]']

interface Slot {
  thumb: HTMLDivElement
  hover: HTMLElement | null
  scrolled: HTMLElement | null
  scrolledUntil: number
  /** The container the thumb is placed on, with the ancestors that clip it. */
  shown: HTMLElement | null
  clippers: HTMLElement[]
  style: string
}

interface Drag {
  axis: Axis
  el: HTMLElement
  pointerId: number
  start: number
  current: number
  scroll: number
}

function optsOut(el: HTMLElement): boolean {
  return (
    el instanceof HTMLInputElement ||
    el.dataset.slot === 'scroll-area-viewport' ||
    NO_BAR_CLASSES.some((name) => el.classList.contains(name))
  )
}

function scrollable(el: HTMLElement, axis: Axis): boolean {
  const overflowing = axis === 'y' ? el.scrollHeight > el.clientHeight : el.scrollWidth > el.clientWidth
  if (!overflowing || optsOut(el)) return false
  const style = getComputedStyle(el)
  const overflow = axis === 'y' ? style.overflowY : style.overflowX
  return overflow === 'auto' || overflow === 'scroll'
}

function findScroller(start: Element, axis: Axis): HTMLElement | null {
  const widget = start.closest(SELF_DRAWN)
  for (let node = widget ? widget.parentElement : start; node && node !== document.body; node = node.parentElement)
    if (node instanceof HTMLElement && scrollable(node, axis)) return node
  return null
}

/** The ancestors whose overflow clips `el`: a positioned element is clipped only from its containing block up. */
function clippersOf(el: HTMLElement): HTMLElement[] {
  const clippers: HTMLElement[] = []
  let position = getComputedStyle(el).position
  for (let node = el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
    if (position === 'fixed') break
    const style = getComputedStyle(node)
    if (position === 'absolute' && style.position === 'static') continue
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') clippers.push(node)
    position = style.position
  }
  return clippers
}

function axisOf(el: HTMLElement, axis: Axis): ScrollAxis {
  const clientSize = axis === 'y' ? el.clientHeight : el.clientWidth
  return {
    scroll: Math.abs(axis === 'y' ? el.scrollTop : el.scrollLeft),
    scrollSize: axis === 'y' ? el.scrollHeight : el.scrollWidth,
    clientSize,
    trackSize: clientSize - PAD_PX * 2,
  }
}

/**
 * Draws the app's one scrollbar for every natively scrolling element: a thin thumb per axis that floats over the
 * container being scrolled or pointed at, taking no layout width. Native scrollbars are hidden in styles.css.
 */
export function installFloatingScrollbars(): void {
  // Outside <body>, so a modal dialog that marks the rest of the body inert leaves the thumbs usable.
  const layer = document.createElement('div')
  layer.className = 'floating-scrollbars'
  layer.setAttribute('aria-hidden', 'true')
  const slot = (axis: Axis): Slot => {
    const thumb = document.createElement('div')
    thumb.className = 'floating-scrollbar'
    thumb.dataset.axis = axis
    layer.append(thumb)
    return { thumb, hover: null, scrolled: null, scrolledUntil: 0, shown: null, clippers: [], style: '' }
  }
  const slots: Record<Axis, Slot> = { x: slot('x'), y: slot('y') }
  document.documentElement.append(layer)

  let frame = 0
  let drag: Drag | null = null
  let pointer: { x: number; y: number; target: EventTarget | null; moved: boolean } | null = null
  let hoverHit: Element | null = null
  let hoverCheckedAt = 0
  let lastInput: { at: number; target: EventTarget | null } | null = null
  const scrolledElements = new Set<HTMLElement>()

  const schedule = () => {
    frame ||= requestAnimationFrame(update)
  }

  /** The app scrolling on its own (a transcript following new output) must not flash a thumb. */
  const scrolledByPerson = (el: HTMLElement, now: number) =>
    drag?.el === el ||
    slots.x.hover === el ||
    slots.y.hover === el ||
    (lastInput !== null &&
      now - lastInput.at < INPUT_WINDOW_MS &&
      lastInput.target instanceof Node &&
      el.contains(lastInput.target))

  const resolveHover = (now: number) => {
    if (!pointer) {
      hoverHit = null
      for (const axis of AXES) slots[axis].hover = null
      return
    }
    const recheck = now - hoverCheckedAt >= HOVER_RECHECK_MS
    if (!pointer.moved && !recheck) return
    const hit = pointer.moved && !recheck ? pointer.target : document.elementFromPoint(pointer.x, pointer.y)
    pointer.moved = false
    if (recheck) hoverCheckedAt = now
    // Over a thumb the pointer still belongs to the container that thumb scrolls.
    if (hit instanceof Node && layer.contains(hit)) return
    const element = hit instanceof Element ? hit : null
    if (element === hoverHit && !recheck) return
    hoverHit = element
    for (const axis of AXES) slots[axis].hover = element ? findScroller(element, axis) : null
  }

  const place = (axis: Axis, el: HTMLElement): boolean => {
    const state = slots[axis]
    const vertical = axis === 'y'
    const thumb = el.isConnected ? thumbGeometry(axisOf(el, axis)) : null
    if (!thumb) return false
    if (state.shown !== el) {
      state.shown = el
      state.clippers = clippersOf(el)
    }
    const rect = el.getBoundingClientRect()
    const left = rect.left + el.clientLeft
    const top = rect.top + el.clientTop
    const box = vertical
      ? {
          left: left + el.clientWidth - BAR_PX.y,
          top: top + PAD_PX + thumb.offset,
          width: BAR_PX.y,
          height: thumb.size,
        }
      : {
          left: left + PAD_PX + thumb.offset,
          top: top + el.clientHeight - BAR_PX.x,
          width: thumb.size,
          height: BAR_PX.x,
        }
    const clip = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
    for (const clipper of state.clippers) {
      const outer = clipper.getBoundingClientRect()
      clip.left = Math.max(clip.left, outer.left + clipper.clientLeft)
      clip.top = Math.max(clip.top, outer.top + clipper.clientTop)
      clip.right = Math.min(clip.right, outer.left + clipper.clientLeft + clipper.clientWidth)
      clip.bottom = Math.min(clip.bottom, outer.top + clipper.clientTop + clipper.clientHeight)
    }
    const inset = [
      Math.max(0, clip.top - box.top),
      Math.max(0, box.left + box.width - clip.right),
      Math.max(0, box.top + box.height - clip.bottom),
      Math.max(0, clip.left - box.left),
    ].map(Math.ceil) as [number, number, number, number]
    if (inset[0] + inset[2] >= box.height || inset[1] + inset[3] >= box.width) return false
    const style =
      `transform:translate(${Math.round(box.left)}px,${Math.round(box.top)}px);` +
      `width:${Math.round(box.width)}px;height:${Math.round(box.height)}px;` +
      (inset.some(Boolean) ? `clip-path:inset(${inset.map((px) => `${px}px`).join(' ')})` : '')
    if (style !== state.style) {
      state.style = style
      state.thumb.style.cssText = style
    }
    return true
  }

  function update() {
    frame = 0
    const now = performance.now()
    if (drag) {
      const to = dragScroll({ ...axisOf(drag.el, drag.axis), scroll: drag.scroll }, drag.current - drag.start)
      drag.el.scrollTo({ [drag.axis === 'y' ? 'top' : 'left']: to, behavior: 'instant' })
    }
    for (const el of scrolledElements) {
      if (!scrolledByPerson(el, now)) continue
      for (const axis of AXES) {
        if (!scrollable(el, axis)) continue
        slots[axis].scrolled = el
        slots[axis].scrolledUntil = now + LINGER_MS
      }
    }
    scrolledElements.clear()
    resolveHover(now)
    let visible = false
    for (const axis of AXES) {
      const state = slots[axis]
      if (state.scrolled && now >= state.scrolledUntil) state.scrolled = null
      const candidates = [drag?.axis === axis ? drag.el : null, state.scrolled, state.hover]
      const shown = candidates.some((el) => el !== null && place(axis, el))
      // A hidden thumb keeps its place while it fades.
      state.thumb.toggleAttribute('data-visible', shown)
      if (!shown) state.shown = null
      visible ||= shown
    }
    // While a thumb shows, every frame follows the container: it can resize, move, grow or leave without an event.
    if (visible) schedule()
  }

  const thumbAxis = (target: EventTarget | null): Axis | null =>
    target === slots.x.thumb ? 'x' : target === slots.y.thumb ? 'y' : null

  // Dialogs and menus close on a press outside them, heard on the document; a press on a thumb stops at the window.
  const onThumbPress = (event: MouseEvent) => {
    const axis = thumbAxis(event.target)
    if (!axis) return
    event.stopPropagation()
    event.preventDefault()
    const el = slots[axis].shown
    if (!(event instanceof PointerEvent) || event.type !== 'pointerdown' || event.button !== 0 || !el) return
    const at = axis === 'y' ? event.clientY : event.clientX
    drag = { axis, el, pointerId: event.pointerId, start: at, current: at, scroll: axisOf(el, axis).scroll }
    slots[axis].thumb.setPointerCapture(event.pointerId)
    slots[axis].thumb.toggleAttribute('data-dragging', true)
    schedule()
  }
  for (const type of ['pointerdown', 'mousedown', 'click'] as const)
    window.addEventListener(type, onThumbPress, { capture: true })

  for (const axis of AXES) {
    const { thumb } = slots[axis]
    thumb.addEventListener('pointermove', (event) => {
      if (drag?.pointerId !== event.pointerId) return
      drag.current = axis === 'y' ? event.clientY : event.clientX
      schedule()
    })
    const release = (event: PointerEvent) => {
      if (drag?.pointerId !== event.pointerId) return
      slots[axis].scrolled = drag.el
      slots[axis].scrolledUntil = performance.now() + LINGER_MS
      drag = null
      thumb.removeAttribute('data-dragging')
      schedule()
    }
    thumb.addEventListener('pointerup', release)
    thumb.addEventListener('pointercancel', release)
    thumb.addEventListener('lostpointercapture', release)
    // The thumb is not inside its container, so a wheel turned over it would otherwise scroll nothing.
    thumb.addEventListener(
      'wheel',
      (event) => slots[axis].shown?.scrollBy({ left: event.deltaX, top: event.deltaY, behavior: 'instant' }),
      { passive: true },
    )
  }

  const listen = { capture: true, passive: true }
  document.addEventListener(
    'scroll',
    (event) => {
      if (event.target instanceof HTMLElement) scrolledElements.add(event.target)
      schedule()
    },
    listen,
  )
  document.addEventListener(
    'pointermove',
    (event) => {
      pointer = { x: event.clientX, y: event.clientY, target: event.target, moved: true }
      schedule()
    },
    listen,
  )
  document.documentElement.addEventListener('pointerleave', () => {
    pointer = null
    schedule()
  })
  const onInput = (event: Event) => {
    lastInput = { at: performance.now(), target: event.target }
  }
  for (const type of ['wheel', 'keydown', 'pointerdown', 'touchstart'] as const)
    document.addEventListener(type, onInput, listen)
}
