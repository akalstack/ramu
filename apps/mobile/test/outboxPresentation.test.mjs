import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function bubble(online, state = 'sending') {
  const module = { exports: {} }
  const source = readFileSync(new URL('../src/components/Outbox.tsx', import.meta.url), 'utf8')
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText,
    {
      exports: module.exports,
      require: (id) => {
        if (id === 'react/jsx-runtime') return require(id)
        if (id === 'react') return { useState: () => [false, () => {}], useEffect() {} }
        if (id === '../runtime/store') return { useStore: () => ({ language: 'en', isOnline: () => online }) }
        if (id === '../theme') return { useTheme: () => ({ c: {} }), radius: {}, space: {}, font: {} }
        if (id === '../i18n') return { useT: () => ({}), useSay: () => (text) => text }
        return new Proxy({}, { get: (_, key) => key })
      },
    },
  )
  return module.exports.PendingBubble({ item: { id: 'a', text: 'Hello', state }, computer: 'Mac', onEdit() {} }).props
    .children[0]
}

test('delivery shows the complete submitted text immediately without offering an ineffective cancel', () => {
  const tree = bubble(true)
  assert.equal(tree.props.disabled, true)
  assert.equal(tree.props.accessibilityLabel, 'Sending: Hello')
  assert.equal(tree.props.children[0].props.children.props.children, 'Hello')
  // On its way it reads as the sent message: no status words under the bubble.
  assert.equal(tree.props.children[1], null)
  assert.equal(tree.props.children[2], null)
})

test('offline and uncertain messages remain available to review or cancel', () => {
  for (const tree of [bubble(false, 'waiting'), bubble(true, 'uncertain')]) {
    assert.equal(tree.props.disabled, false)
    assert.equal(tree.props.accessibilityRole, 'button')
  }
})

test('acknowledged delivery stays visible as sent while the phone reconnects', () => {
  const tree = bubble(false, 'accepted')
  assert.equal(tree.props.disabled, true)
  assert.equal(tree.props.children[0].props.children.props.children, 'Hello')
  assert.equal(tree.props.children[1], null)
  assert.equal(tree.props.children[2], null)
})
