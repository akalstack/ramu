import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const fill = (text, values) => text.replace(/\{(\w+)\}/g, (_, key) => String(values?.[key]))
function load({ online = true, setState = () => {}, native = {} } = {}) {
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
        if (id === 'react') return { useState: () => [false, setState], useEffect() {} }
        if (id === 'react-native' && Object.keys(native).length) return native
        if (id === '../runtime/store') return { useStore: () => ({ language: 'en', isOnline: () => online }) }
        if (id === '../theme') return { useTheme: () => ({ c: {} }), radius: {}, space: {}, font: {} }
        if (id === '../i18n') return { useT: () => ({}), useSay: () => fill }
        return new Proxy({}, { get: (_, key) => key })
      },
    },
  )
  return module.exports
}
function bubble(online, state = 'sending', setState) {
  return load({ online, setState }).PendingBubble({
    item: { id: 'a', text: 'Hello', state },
    computer: 'Mac',
    onEdit() {},
  }).props.children[0]
}

test('delivery shows the complete submitted text immediately without offering an ineffective cancel', () => {
  const tree = bubble(true)
  assert.equal(tree.props.disabled, true)
  assert.equal(tree.props.accessibilityLabel, 'Sending: Hello')
  // Drawn as the sent message will be, so the swap does not move the transcript.
  assert.equal(tree.props.children[0].props.children.props.text, 'Hello')
  // On its way it reads as the sent message: no status words under the bubble.
  assert.equal(tree.props.children[1], null)
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
  assert.equal(tree.props.children[0].props.children.props.text, 'Hello')
  assert.equal(tree.props.children[1], null)
})

test('a long message still on its way opens and closes with Show more', () => {
  const updates = []
  const tree = bubble(true, 'sending', (update) => updates.push(update))
  const message = tree.props.children[0].props.children.props
  assert.equal(message.expanded, false)
  assert.equal(message.label, 'Show more')
  message.onToggle()
  assert.equal(updates.length, 1)
  assert.equal(updates[0](false), true)
})

for (const os of ['ios', 'android']) {
  test(`${os}: cancelling a queued message offers edit, delete and keep in the phone's language`, () => {
    const shown = []
    const ran = []
    const native = {
      Platform: { OS: os },
      ActionSheetIOS: { showActionSheetWithOptions: (options, pick) => shown.push({ options, pick }) },
      Alert: { alert: (title, message, buttons) => shown.push({ title, buttons }) },
      Pressable: 'Pressable',
      View: 'View',
    }
    const say = (text) => `id:${text}`
    load({ native }).confirmCancel(
      { id: 'm1', kind: 'message', state: 'waiting' },
      (text) => ran.push(`edit:${text}`),
      (id) => (ran.push(`cancel:${id}`), 'draft'),
      say,
    )
    if (os === 'ios') {
      const [{ options, pick }] = shown
      assert.deepEqual(Array.from(options.options), ['id:Edit message', 'id:Delete', 'id:Keep'])
      assert.equal(options.title, 'id:Cancel this message?')
      assert.equal(options.destructiveButtonIndex, 1)
      assert.equal(options.cancelButtonIndex, 2)
      pick(0)
      pick(2)
    } else {
      const [{ title, buttons }] = shown
      assert.equal(title, 'id:Cancel this message?')
      assert.deepEqual(
        Array.from(buttons, (button) => button.text),
        ['id:Keep', 'id:Edit message', 'id:Delete'],
      )
      assert.equal(buttons[2].style, 'destructive')
      buttons[1].onPress()
    }
    assert.deepEqual(ran, ['cancel:m1', 'edit:draft'])
  })
}
