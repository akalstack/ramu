import * as chatPresentation from '../../../packages/shared/src/chat/presentation.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
// Exercise the native animation boundary without a simulator or animation timers.
function harness(reduced = false) {
  const slots = []
  let cursor = 0
  let effects = []
  const timings = []
  const completions = []
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [
        slots[index],
        (next) => {
          slots[index] = typeof next === 'function' ? next(slots[index]) : next
        },
      ]
    },
    useRef(initial) {
      const index = cursor++
      return (slots[index] ??= { current: initial })
    },
    useEffect(effect, deps) {
      const index = cursor++
      const previous = slots[index]
      if (!previous || deps.some((value, at) => !Object.is(value, previous.deps[at]))) {
        effects.push(() => {
          previous?.cleanup?.()
          slots[index] = { deps, cleanup: effect() }
        })
      }
    },
  }
  class Value {
    constructor(value) {
      this.value = value
    }
    setValue(value) {
      this.value = value
    }
    interpolate() {
      return this
    }
  }
  const animation = () => ({
    start: (callback) => {
      if (callback) completions.push(callback)
    },
    stop() {},
  })
  const native = {
    AccessibilityInfo: {
      isReduceMotionEnabled: () => Promise.resolve(reduced),
      addEventListener: () => ({ remove() {} }),
    },
    Animated: {
      Value,
      View: 'AnimatedView',
      timing(value, config) {
        timings.push({ value, ...config })
        return animation()
      },
      parallel: () => animation(),
    },
    Easing: { bezier: (...values) => values, out: (value) => value, quad: 'quad', cubic: 'cubic' },
    View: 'View',
  }
  // Collapse and the finish sweep run on the UI thread through Reanimated; record their timings like Animated's.
  const reanimated = {
    default: { View: 'ReanimatedView' },
    Easing: { linear: 'linear', out: (value) => value, cubic: 'cubic', bezier: (...values) => values },
    useSharedValue: (value) => react.useRef({ value }).current,
    makeMutable: (value) => ({ value }),
    useAnimatedStyle: (style) => style(),
    interpolate: (value) => value,
    Extrapolation: { CLAMP: 'clamp' },
    withTiming(toValue, config, callback) {
      timings.push({ toValue, ...config })
      if (callback) completions.push(() => callback(true))
      return toValue
    },
    withDelay: (_delay, value) => value,
    cancelAnimation() {},
  }
  const module = { exports: {} }
  const code = ts.transpileModule(readFileSync(new URL('../src/components/Motion.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(code, {
    exports: module.exports,
    Date,
    setTimeout: () => 0,
    clearTimeout() {},
    require: (id) =>
      id === '@ramu/shared/chat/presentation'
        ? chatPresentation
        : id === 'react'
          ? react
          : id === 'react-native'
            ? native
            : id === 'react-native-reanimated'
              ? reanimated
              : id === 'react-native-worklets'
                ? { scheduleOnRN: (run, ...args) => run(...args) }
                : id === 'react/jsx-runtime'
                  ? require(id)
                  : {},
  })
  return {
    ...module.exports,
    timings,
    finish() {
      for (const callback of completions.splice(0)) callback({ finished: true })
    },
    /** Starts the next render as a new instance, as a view the list mounts in place of another. */
    remount() {
      slots.length = 0
    },
    render(component, props) {
      cursor = 0
      effects = []
      const tree = component(props)
      for (const effect of effects) effect()
      return tree
    },
  }
}

test('a disclosure measures content, animates its height and retains closing content until completion', () => {
  const h = harness()
  assert.equal(h.render(h.Collapse, { open: false, children: 'Details' }), null)
  const open = h.render(h.Collapse, { open: true, children: 'Details' })
  open.props.children.props.onLayout({ nativeEvent: { layout: { height: 96 } } })
  h.render(h.Collapse, { open: true, children: 'Details' })
  assert.ok(h.timings.some((timing) => timing.toValue === 96 && timing.duration === 200))
  const closing = h.render(h.Collapse, { open: false, children: 'Details' })
  assert.equal(closing.props.pointerEvents, 'none')
  assert.equal(closing.props.accessibilityElementsHidden, true)
  assert.equal(closing.props.children.props.children, 'Details')
  h.finish()
  assert.equal(h.render(h.Collapse, { open: false, children: 'Details' }), null)
})

test('reduced motion reveals disclosures immediately instead of animating', async () => {
  const h = harness(true)
  h.render(h.Collapse, { open: true, children: 'Details' })
  await Promise.resolve()
  h.timings.length = 0
  const tree = h.render(h.Collapse, { open: true, children: 'Details' })
  tree.props.children.props.onLayout({ nativeEvent: { layout: { height: 48 } } })
  h.render(h.Collapse, { open: true, children: 'Details' })
  assert.ok(h.timings.length > 0)
  assert.ok(h.timings.every((timing) => timing.duration === 0))
})

test('streaming rerenders do not restart or cancel a new block’s arrival', () => {
  const h = harness()
  h.render(h.Arrive, { animate: true, children: 'First words' })
  assert.equal(h.timings.length, 1)
  h.render(h.Arrive, { animate: false, children: 'More words' })
  assert.equal(h.timings.length, 1)
})

test('recycled history blocks remain fully visible without replaying arrival motion', () => {
  const h = harness()
  const tree = h.render(h.Arrive, { animate: false, children: 'History' })
  assert.equal(tree.props.style.opacity, 1)
  assert.equal(h.timings.length, 0)
})

test('Starting, Working and tool status changes fade once each without replaying elapsed updates', () => {
  const h = harness()
  h.render(h.Arrive, { animate: true, identity: 'Starting…', children: 'Starting…' })
  assert.equal(h.timings.length, 1)
  assert.equal(h.timings[0].duration, chatPresentation.CHAT_MOTION.durationMs)
  h.render(h.Arrive, { animate: true, identity: 'Working', children: 'Working for 1s' })
  assert.equal(h.timings.length, 2)
  h.render(h.Arrive, { animate: true, identity: 'Working', children: 'Working for 2s' })
  assert.equal(h.timings.length, 2)
  h.render(h.Arrive, { animate: true, identity: 'Writing…', children: 'Writing…' })
  assert.equal(h.timings.length, 3)
})

test('existing tool rows reveal immediately but fade their changed state', () => {
  const h = harness()
  h.render(h.Arrive, { animate: false, identity: 'running', children: 'Reading' })
  assert.equal(h.timings.length, 0)
  h.render(h.Arrive, { animate: false, identity: 'completed', children: 'Read' })
  assert.equal(h.timings.length, 1)
})

test('reduced motion skips both status entrances and state changes', async () => {
  const h = harness(true)
  h.render(h.Arrive, { animate: false, identity: 'Starting…', children: 'Starting…' })
  await Promise.resolve()
  h.timings.length = 0
  const tree = h.render(h.Arrive, { animate: true, identity: 'Working', children: 'Working' })
  assert.equal(tree.props.style.opacity, 1)
  assert.equal(h.timings.length, 0)
})

test('the host’s copy of a sent message keeps the bubble’s height until its own text has measured as tall', () => {
  const h = harness()
  const sent = h.render(h.SentArrive, { identity: 'pending:1', start: true, children: 'Bubble' })
  sent.props.children.props.onLayout({ nativeEvent: { layout: { height: 64 } } })
  h.remount()
  let copy = h.render(h.SentArrive, { identity: 'pending:1', start: false, children: 'Copy' })
  assert.equal(copy.props.style[1]?.minHeight, 64)
  // Its text first measures a line short; the hold covers that frame.
  copy.props.children.props.onLayout({ nativeEvent: { layout: { height: 43 } } })
  copy = h.render(h.SentArrive, { identity: 'pending:1', start: false, children: 'Copy' })
  assert.equal(copy.props.style[1]?.minHeight, 64)
  copy.props.children.props.onLayout({ nativeEvent: { layout: { height: 64 } } })
  copy = h.render(h.SentArrive, { identity: 'pending:1', start: false, children: 'Copy' })
  assert.equal(copy.props.style[1], null)
  // A message that arrived from elsewhere has nothing to hold.
  h.remount()
  const other = h.render(h.SentArrive, { identity: 'pending:2', start: false, children: 'Other' })
  assert.equal(other.props.style[1], null)
})
