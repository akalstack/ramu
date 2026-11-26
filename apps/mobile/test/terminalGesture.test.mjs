import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import {
  TerminalGesture,
  HOLD_MS,
  arrowSequence,
  gestureOverlayPosition,
  pinchFontSize,
  terminalFontSize,
} from '../src/runtime/terminalGesture.ts'

test('short taps and ordinary swipes never activate cursor control', () => {
  const gesture = new TerminalGesture()
  gesture.begin(100, 100, 0)
  assert.equal(gesture.tick(HOLD_MS - 1).active, false)
  gesture.cancel()
  assert.equal(gesture.tick(2000).active, false)
  gesture.begin(100, 100, 0)
  gesture.move(120, 100, 20)
  assert.equal(gesture.tick(2000).active, false)
})
test('hold shows a neutral control; a direction sends its first key at once, then repeats on a full gauge', () => {
  const gesture = new TerminalGesture()
  gesture.begin(100, 100, 0)
  assert.equal(gesture.tick(HOLD_MS).active, true)
  for (let t = HOLD_MS; t < 2000; t += 16) assert.equal(gesture.tick(t).steps, 0)
  gesture.move(113, 100, 2000)
  assert.equal(gesture.tick(2016).steps, 1)
  let steps = 0,
    partial = false
  for (let t = 2032; t <= 2480; t += 16) {
    const state = gesture.tick(t)
    steps += state.steps
    partial ||= state.progress > 0 && state.progress < 1
    if (state.steps) assert.equal(state.progress, 1)
  }
  assert.ok(partial)
  assert.equal(steps, 1)
})
test('farther dragging repeats faster, diagonal drift is stable, returning to center stops', () => {
  function rate(distance) {
    const gesture = new TerminalGesture()
    gesture.begin(100, 100, 0)
    gesture.tick(HOLD_MS)
    gesture.move(100 + distance, 100, HOLD_MS)
    let total = 0
    for (let t = HOLD_MS + 16; t <= HOLD_MS + 1000; t += 16) total += gesture.tick(t).steps
    return total
  }
  assert.ok(rate(112) > rate(25) * 3)
  const gesture = new TerminalGesture()
  gesture.begin(100, 100, 0)
  gesture.tick(HOLD_MS)
  gesture.move(160, 100, 700)
  assert.equal(gesture.tick(720).direction, 'right')
  gesture.move(160, 165, 730)
  assert.equal(gesture.tick(750).direction, 'right')
  gesture.move(160, 180, 760)
  assert.equal(gesture.tick(780).direction, 'down')
  gesture.move(101, 100, 800)
  assert.equal(gesture.tick(10000).steps, 0)
  gesture.cancel()
  assert.equal(gesture.tick(11000).active, false)
})
test('arrows honor application cursor mode used by terminal TUIs', () => {
  assert.equal(arrowSequence('left'), '\x1b[D')
  assert.equal(arrowSequence('right', true), '\x1bOC')
  assert.equal(arrowSequence('up', true), '\x1bOA')
  assert.equal(arrowSequence('down'), '\x1b[B')
})

function surface() {
  let now = 0,
    frame = null
  const events = new Map(),
    windowEvents = new Map(),
    messages = [],
    selected = []
  const document = {
    body: { style: { userSelect: 'text' } },
    hidden: false,
    addEventListener: (name, callback) => events.set(name, callback),
  }
  const window = { addEventListener: (name, callback) => windowEvents.set(name, callback) }
  const context = {
    document,
    window,
    performance: { now: () => now },
    requestAnimationFrame: (callback) => {
      frame = callback
      return 1
    },
    cancelAnimationFrame: () => {
      frame = null
    },
    Set,
  }
  vm.runInNewContext(readFileSync(new URL('../scripts/terminal-gesture.js', import.meta.url), 'utf8'), context)
  const terminal = {
    clearSelection() {},
    modes: { applicationCursorKeysMode: true },
    options: {},
    blurred: 0,
    blur() {
      this.blurred++
    },
  }
  context.installTerminalGesture(
    terminal,
    (value) => messages.push(value),
    TerminalGesture,
    arrowSequence,
    undefined,
    undefined,
    (x, y) => selected.push([x, y]),
  )
  return {
    terminal,
    messages,
    selected,
    event(name, x = 100, id = 1) {
      let prevented = false
      events.get(name)?.({
        type: name,
        pointerId: id,
        pointerType: 'touch',
        button: 0,
        clientX: x,
        clientY: 100,
        target: { setPointerCapture() {} },
        preventDefault() {
          prevented = true
        },
        stopImmediatePropagation() {},
      })
      return prevented
    },
    advance(time) {
      now = time
      const callback = frame
      frame = null
      callback?.(time)
    },
    control(enabled) {
      windowEvents.get('message')({ data: JSON.stringify({ kind: 'gesture-control', enabled }) })
    },
    blur() {
      windowEvents.get('blur')()
    },
    hide() {
      document.hidden = true
      events.get('visibilitychange')()
    },
  }
}
test('actual surface driver sends TUI arrow bytes and stops on release, second touch and background', () => {
  for (const stop of ['release', 'multi', 'background', 'blur']) {
    const view = surface()
    view.event('pointerdown')
    view.advance(HOLD_MS)
    view.event('pointermove', 212)
    for (let t = HOLD_MS + 16; t < 1000; t += 16) view.advance(t)
    const sent = () => view.messages.filter((message) => message.kind === 'input')
    assert.ok(sent().length > 0)
    assert.ok(sent().every((message) => message.data === '\x1bOC'))
    if (stop === 'release') view.event('pointerup', 212)
    if (stop === 'multi') view.event('pointerdown', 212, 2)
    if (stop === 'background') view.hide()
    if (stop === 'blur') view.blur()
    const before = sent().length
    for (let t = 1000; t < 4000; t += 16) view.advance(t)
    assert.equal(sent().length, before)
    assert.equal(view.messages.at(-1).active, false)
  }
})

test('disconnect and native background control cancel; re-enabling requires a new hold', () => {
  const view = surface()
  view.event('pointerdown')
  view.advance(HOLD_MS)
  view.event('pointermove', 212)
  view.control(false)
  const count = view.messages.filter((message) => message.kind === 'input').length
  view.advance(10000)
  view.event('pointerdown')
  view.advance(11000)
  assert.equal(view.messages.filter((message) => message.kind === 'input').length, count)
  view.control(true)
  view.event('pointermove', 212)
  view.advance(12000)
  assert.equal(view.messages.filter((message) => message.kind === 'input').length, count)
  view.event('pointerdown')
  view.advance(12000 + HOLD_MS)
  assert.equal(view.messages.at(-1).active, true)
})

test('touch scrolling is prevented only after the hold has activated', () => {
  const view = surface()
  view.event('pointerdown')
  assert.equal(view.event('touchmove'), false)
  view.advance(HOLD_MS)
  assert.equal(view.event('touchmove'), true)
  view.event('pointerup')
  assert.equal(view.event('touchmove'), false)
})

test('a hold lifted without dragging selects where it was, as a long press in chat does', () => {
  const view = surface()
  view.event('pointerdown', 140)
  view.advance(HOLD_MS)
  view.event('pointerup', 140)
  assert.deepEqual(view.selected, [[140, 100]])
  // A tap is too short, and a hold that moved the cursor already did what it was for.
  view.event('pointerdown', 140)
  view.advance(HOLD_MS + 50)
  view.event('pointerup', 140)
  view.event('pointerdown', 140)
  view.advance(HOLD_MS * 2 + 100)
  view.event('pointermove', 212)
  view.advance(HOLD_MS * 2 + 200)
  view.event('pointerup', 212)
  assert.equal(view.selected.length, 1)
  assert.equal(view.messages.filter((message) => message.kind === 'input').length > 0, true)
})

test('a hold cancelled by the system selects nothing', () => {
  const view = surface()
  view.event('pointerdown', 140)
  view.advance(HOLD_MS)
  view.event('pointercancel', 140)
  assert.deepEqual(view.selected, [])
})

test('cursor pad sits fixed on the right edge, moving off the finger only when it holds over the pad', () => {
  // Wherever the hold starts away from it, the pad is in the same place: right edge, centred.
  assert.deepEqual(gestureOverlayPosition(100, 300, 390, 600), { left: 266, top: 244 })
  assert.deepEqual(gestureOverlayPosition(10, 20, 390, 600), { left: 266, top: 244 })
  // A finger on the pad pushes it above the finger, or below when there is no room above.
  assert.deepEqual(gestureOverlayPosition(330, 300, 390, 600), { left: 266, top: 164 })
  assert.deepEqual(gestureOverlayPosition(330, 130, 390, 260), { left: 266, top: 136 })
  for (const [width, height] of [
    [390, 600],
    [180, 160],
    [80, 80],
  ]) {
    for (const [x, y] of [
      [0, 0],
      [width, height],
      [-100, -100],
      [9999, 9999],
    ]) {
      const position = gestureOverlayPosition(x, y, width, height)
      assert.ok(position.left >= 0 && position.top >= 0)
      assert.ok(position.left <= Math.max(0, width - 112))
      assert.ok(position.top <= Math.max(0, height - 112))
    }
  }
})

test('read-only control disables the terminal input and releases focus without blocking ordinary scrolling', () => {
  const view = surface()
  view.control(false)
  assert.equal(view.terminal.options.disableStdin, true)
  assert.equal(view.terminal.blurred, 1)
  view.event('pointerdown')
  assert.equal(view.event('touchmove'), false)
  view.control(true)
  assert.equal(view.terminal.options.disableStdin, false)
})

test('pinching scales the terminal text within its bounds, and a stored size outside them falls back', () => {
  assert.equal(pinchFontSize(13, 100, 150), 20)
  assert.equal(pinchFontSize(13, 100, 50), 9)
  assert.equal(pinchFontSize(13, 100, 400), 22)
  assert.equal(pinchFontSize(13, 0, 120), 13)
  assert.equal(terminalFontSize('16'), 16)
  assert.equal(terminalFontSize(undefined), 13)
  assert.equal(terminalFontSize('40'), 13)
  assert.equal(terminalFontSize('12.5'), 13)
})
