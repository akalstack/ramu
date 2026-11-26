import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { learnedRoutes } from '@ramu/shared/hostProof'
import { hostOfUrl, networkName, routeEncrypted, routeSpeed } from '@ramu/shared/networkLabel'
const require = createRequire(import.meta.url)
const computer = {
  id: 'mac',
  name: 'Work Mac',
  address: 'http://192.168.1.3:7788',
  status: 'offline',
  routes: ['http://100.99.224.30:7788'],
}
const copy = {
  pairAddress: 'Server address',
  nearbyChecking: 'Checking…',
  nearbyUseAddress: 'Use this address for {0}',
  nearbyUnreachable: 'Could not reach this host.',
  nearbyMismatch: 'That is not {0}.',
  nearbyUnsupported: 'Pair {0} again.',
  nearbyInsecure: 'Keep encryption for {0}.',
}
function harness(os, reviewAddress, host = computer) {
  const slots = [],
    effects = [],
    cleanups = [],
    retries = []
  let cursor = 0,
    closed = 0
  const react = {
    useState(initial) {
      const i = cursor++
      if (!(i in slots)) slots[i] = initial
      return [
        slots[i],
        (value) => {
          slots[i] = typeof value === 'function' ? value(slots[i]) : value
        },
      ]
    },
    useRef(initial) {
      const i = cursor++
      return (slots[i] ??= { current: initial })
    },
    useEffect(effect) {
      const i = cursor++
      if (!(i in slots)) {
        slots[i] = true
        effects.push(effect)
      }
    },
  }
  const module = { exports: {} }
  const alerts = []
  const automatic = []
  const mocks = {
    react,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': {
      Platform: { OS: os },
      View: 'View',
      TextInput: 'TextInput',
      Pressable: 'Pressable',
      Alert: { alert: (...args) => alerts.push(args) },
    },
    '@ramu/shared/hostProof': { learnedRoutes },
    '@ramu/shared/networkLabel': { hostOfUrl, networkName, routeEncrypted, routeSpeed },
    'lucide-react-native': { Check: 'Check' },
    '../runtime/store': {
      useStore: () => ({ reviewAddress, retry: (id) => retries.push(id), automaticRoute: (id) => automatic.push(id) }),
    },
    '../i18n': { useT: () => copy, useSay: () => (text) => text, fill: (text, value) => text.replace('{0}', value) },
    '../theme': {
      useTheme: () => ({ c: {} }),
      font: { caption: 12, body: 15 },
      radius: { s: 8 },
      space: { s: 8, m: 12, l: 16 },
    },
    './ui': { Sheet: 'Sheet', T: 'T', Button: 'Button' },
  }
  runInNewContext(
    ts.transpileModule(readFileSync(new URL('../src/components/HostAddressSheet.tsx', import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { exports: module.exports, require: (id) => mocks[id], AbortController, Error },
  )
  return {
    render() {
      cursor = 0
      const tree = module.exports.HostAddressSheet({
        computer: host,
        onClose: () => {
          closed++
        },
      })
      effects.splice(0).forEach((effect) => cleanups.push(effect()))
      return tree
    },
    get closed() {
      return closed
    },
    retries,
    alerts,
    automatic,
    dispose() {
      cleanups.splice(0).forEach((cleanup) => cleanup?.())
    },
  }
}
const nodes = (tree) =>
  !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)]
const find = (tree, type, check = () => true) => nodes(tree).find((node) => node.type === type && check(node.props))
const settle = () => new Promise((resolve) => setImmediate(resolve))

for (const os of ['ios', 'android']) {
  test(`${os}: from Ramu Link, the local network asks once and Automatic hands the choice back`, async () => {
    const calls = []
    const linked = {
      ...computer,
      address: 'https://ramu-abc.akalstack.com',
      routes: ['http://192.168.1.3:7788', 'http://100.99.224.30:7788'],
    }
    const h = harness(os, async (...args) => (calls.push(args), 'moved'), linked)
    const row = (host) =>
      find(h.render(), 'Pressable', (props) => nodes(props.children?.[0]).some((node) => node.props?.children === host))
    row('192.168.1.3').props.onPress()
    assert.equal(calls.length, 0, 'nothing moves before the person agrees')
    assert.equal(h.alerts.length, 1)
    h.alerts[0][2][1].onPress()
    await settle()
    assert.deepEqual(calls[0].slice(0, 2), [linked.id, 'http://192.168.1.3:7788'])
    assert.equal(calls[0][3].allowPlain, true)
    row('100.99.224.30').props.onPress()
    await settle()
    assert.equal(h.alerts.length, 1, 'a VPN encrypts on its own, so it does not ask')
    find(h.render(), 'Pressable', (props) =>
      nodes(props.children?.[0]).some((node) => node.props?.children === 'Automatic'),
    ).props.onPress()
    assert.deepEqual(h.automatic, [linked.id])
    h.dispose()
  })

  test(`${os}: Switch network offers saved LAN/VPN routes and applies a verified choice in one tap without pairing`, async () => {
    const calls = []
    let finish
    const h = harness(os, (...args) => {
      calls.push(args)
      return new Promise((resolve) => {
        finish = resolve
      })
    })
    let tree = h.render()
    const route = new URL(computer.routes[0]).hostname
    const vpn = find(tree, 'Pressable', (props) =>
      nodes(props.children[0]).some((node) => node.props?.children === route),
    )
    assert.ok(vpn)
    vpn.props.onPress()
    vpn.props.onPress()
    tree = h.render()
    assert.equal(find(tree, 'TextInput').props.value, computer.routes[0])
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], computer.id)
    assert.equal(calls[0][1], computer.routes[0])
    assert.equal(calls[0][2].aborted, false)
    assert.equal(find(h.render(), 'Button').props.disabled, true)
    finish('moved')
    await settle()
    assert.equal(h.closed, 1)
    assert.deepEqual(h.retries, [], 'switching already starts the new connection')
    h.dispose()
  })

  test(`${os}: an invalid host stays in the address editor and preserves the current pairing`, async () => {
    const h = harness(os, async () => 'mismatch')
    find(h.render(), 'TextInput').props.onChangeText('http://100.99.224.30:7788')
    find(h.render(), 'Button').props.onPress()
    await settle()
    assert.equal(h.closed, 0)
    assert.deepEqual(h.retries, [])
    assert.ok(
      find(h.render(), 'T', (props) => props.accessibilityRole === 'alert' && props.children.includes('Work Mac')),
    )
    h.dispose()
  })

  test(`${os}: closing the sheet cancels a pending address verification and ignores its late answer`, async () => {
    let signal, finish
    const h = harness(os, (_id, _address, cancellation) => {
      signal = cancellation
      return new Promise((resolve) => {
        finish = resolve
      })
    })
    find(h.render(), 'Button').props.onPress()
    h.render().props.onClose()
    assert.equal(signal.aborted, true)
    finish('moved')
    await settle()
    assert.equal(h.closed, 1)
    assert.deepEqual(h.retries, [])
    h.dispose()
  })

  test(`${os}: choosing the unchanged offline address retries its connection`, async () => {
    const h = harness(os, async () => 'unchanged')
    find(h.render(), 'Button').props.onPress()
    await settle()
    assert.deepEqual(h.retries, ['mac'])
    assert.equal(h.closed, 1)
    h.dispose()
  })
}
