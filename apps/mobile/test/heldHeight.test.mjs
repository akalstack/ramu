import * as heldHeight from '../../../packages/shared/src/chat/heldHeight.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

// Runs the hook with a minimal React: state and refs keep their slot across renders, effects run after each render.
function harness() {
  const slots = []
  let cursor = 0
  let effects = []
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial }
      const slot = slots[index]
      return [
        slot.value,
        (next) => {
          slot.value = typeof next === 'function' ? next(slot.value) : next
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
      if (!previous || deps.some((value, at) => !Object.is(value, previous.deps[at])))
        effects.push(() => (slots[index] = { deps, cleanup: effect() }))
    },
  }
  const module = { exports: {} }
  const code = ts.transpileModule(readFileSync(new URL('../src/components/heldHeight.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(code, {
    exports: module.exports,
    setTimeout,
    clearTimeout,
    Date,
    require: (id) => (id === 'react' ? react : id === '@ramu/shared/chat/heldHeight' ? heldHeight : {}),
  })
  return (live, identity = 'a') => {
    cursor = 0
    effects = []
    module.exports.useHeldHeight(live, identity)
    for (const effect of effects) effect()
    cursor = 0
    return module.exports.useHeldHeight(live, identity)
  }
}

const layout = (height) => ({ nativeEvent: { layout: { height } } })

test('a live folded group keeps its tallest height and lets go once it is no longer live', () => {
  const render = harness()
  let held = render(true)
  held.onLayout(layout(40))
  held.onLayout(layout(96))
  held = render(true)
  assert.equal(held.minHeight, 96)
  held.onLayout(layout(60))
  assert.equal(render(true).minHeight, 96)
  assert.equal(render(false).minHeight, undefined)
})

test('a fold by hand shows, and the hold picks up from where it settled', async () => {
  const render = harness()
  const held = render(true)
  held.onLayout(layout(200))
  held.release()
  held.onLayout(layout(120))
  assert.equal(render(true).minHeight, undefined)
  held.onLayout(layout(50))
  await new Promise((resolve) => setTimeout(resolve, heldHeight.HOLD_PAUSE_MS + 20))
  assert.equal(render(true).minHeight, 50)
})

test('group A settles once it is done, and group B starts its own hold from zero', () => {
  const render = harness()
  let held = render(true, 'a')
  held.onLayout(layout(120))
  assert.equal(render(true, 'a').minHeight, 120)
  // A is done (the agent replied after it): it settles while the turn still runs.
  assert.equal(render(false, 'a').minHeight, undefined)
  // B takes over the row: it holds only what it reaches itself.
  held = render(true, 'b')
  held.onLayout(layout(40))
  assert.equal(render(true, 'b').minHeight, 40)
})
