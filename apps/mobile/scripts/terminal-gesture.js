// Runs inside the bundled terminal surface; no host credentials or network calls.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- injected into the terminal bundle as source text by gen-terminal.mjs
function installTerminalGesture(term, post, TerminalGesture, arrowSequence) {
  const gesture = new TerminalGesture()
  const pointers = new Set()
  let enabled = true,
    pointer = null,
    frame = 0,
    reported = false,
    lastUi = 0,
    suppressClickUntil = 0
  const previousSelection = document.body.style.userSelect
  function cancel() {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    if (reported) {
      post({ kind: 'gesture', active: false })
      suppressClickUntil = performance.now() + 200
    }
    reported = false
    pointer = null
    gesture.cancel()
    document.body.style.userSelect = previousSelection
  }
  function tick(now) {
    if (!pointer) return
    const state = gesture.tick(now)
    if (state.active) {
      if (!reported) {
        document.body.style.userSelect = 'none'
        term.clearSelection()
        try {
          pointer.target.setPointerCapture(pointer.id)
        } catch {}
      }
      if (!reported || now - lastUi >= 32 || state.steps) {
        post({ kind: 'gesture', ...state })
        lastUi = now
      }
      reported = true
      if (state.steps && state.direction)
        post({ kind: 'input', data: arrowSequence(state.direction, term.modes.applicationCursorKeysMode) })
    }
    frame = requestAnimationFrame(tick)
  }
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!enabled) return
      if (event.pointerType === 'mouse' && event.button !== 0) return
      pointers.add(event.pointerId)
      if (pointers.size !== 1) {
        cancel()
        return
      }
      pointer = { id: event.pointerId, target: event.target }
      gesture.begin(event.clientX, event.clientY, performance.now())
      frame = requestAnimationFrame(tick)
    },
    true,
  )
  document.addEventListener(
    'pointermove',
    (event) => {
      if (!pointer || pointer.id !== event.pointerId) return
      gesture.move(event.clientX, event.clientY, performance.now())
      if (reported) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    },
    { capture: true, passive: false },
  )
  // WKWebView needs a non-passive touch listener to keep a held vertical drag
  // from becoming scroll/pointercancel; ordinary swipes remain untouched.
  document.addEventListener(
    'touchmove',
    (event) => {
      if (reported) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    },
    { capture: true, passive: false },
  )
  function end(event) {
    pointers.delete(event.pointerId)
    if (pointer && pointer.id === event.pointerId) {
      if (reported) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
      cancel()
    }
  }
  document.addEventListener('pointerup', end, { capture: true, passive: false })
  document.addEventListener('pointercancel', end, true)
  document.addEventListener('lostpointercapture', end, true)
  document.addEventListener(
    'contextmenu',
    (event) => {
      if (pointer || reported) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    },
    true,
  )
  document.addEventListener(
    'click',
    (event) => {
      if (performance.now() < suppressClickUntil) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    },
    true,
  )
  function control(event) {
    try {
      const value = JSON.parse(event.data)
      if (value.kind === 'gesture-control') {
        enabled = value.enabled === true
        if (term.options) term.options.disableStdin = !enabled
        if (!enabled) {
          term.blur?.()
          pointers.clear()
          cancel()
        }
      }
    } catch {}
  }
  window.addEventListener('message', control)
  document.addEventListener('message', control)
  window.addEventListener('blur', () => {
    pointers.clear()
    cancel()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pointers.clear()
      cancel()
    }
  })
}
