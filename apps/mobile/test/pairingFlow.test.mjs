import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as nearby from '../src/runtime/nearbyModel.ts'
import * as pairing from '../src/runtime/pairingModel.ts'
import { encodePairWebLink, parsePairInput } from '../../../packages/contracts/src/index.ts'

const require = createRequire(import.meta.url)
function harness(os, options = {}) {
  const slots = []
  let cursor = 0
  const calls = [],
    alerts = [],
    toasts = [],
    navigation = []
  let finish
  const components = new Proxy({}, { get: (_, key) => key })
  const react = {
    useEffect() {},
    useRef(initial) {
      const i = cursor++
      return (slots[i] ??= { current: initial })
    },
    useState(initial) {
      const i = cursor++
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
      return [
        slots[i],
        (value) => {
          slots[i] = typeof value === 'function' ? value(slots[i]) : value
        },
      ]
    },
  }
  const mocks = {
    react,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': {
      ...Object.fromEntries(
        ['KeyboardAvoidingView', 'Pressable', 'TextInput', 'View', 'ActivityIndicator'].map((k) => [k, k]),
      ),
      AppState: { currentState: 'active' },
      Platform: { OS: os },
      StyleSheet: {},
      Keyboard: { dismiss() {} },
      useWindowDimensions: () => ({ width: 375 }),
      Alert: { alert: (...args) => alerts.push(args) },
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 34 }) },
    'expo-router': {
      useLocalSearchParams: () => ({}),
      useRouter: () => ({ canDismiss: () => false, replace: (path) => navigation.push(path) }),
    },
    'expo-camera': { CameraView: 'CameraView', useCameraPermissions: () => [{ granted: true }, () => {}] },
    '../runtime/transport': { needsHttpConsent: (address) => address.startsWith('http:') },
    '@ramu/contracts': { parsePairInput },
    '../runtime/pairingModel': pairing,
    '../runtime/toast': { showToast: (message) => toasts.push(message) },
    '../theme': { font: {}, radius: {}, space: { l: 16, m: 12 }, useTheme: () => ({ c: {} }) },
    '../runtime/store': {
      useStore: () => ({
        computers: [],
        pair: (...args) => {
          calls.push(args)
          return new Promise((resolve, reject) => {
            finish = (error) => (error ? reject(error) : resolve('id'))
          })
        },
        ...options.store,
      }),
    },
    '../components/Screen': {
      ...components,
      Screen: 'Screen',
      Header: 'Header',
      GlassButton: 'GlassButton',
      PageScrollView: 'ScrollView',
      useSheetKeyboardOffset: () => 0,
    },
    '../components/ui': { T: 'T', Card: 'Card', Toggle: 'Toggle', tap() {}, succeeded() {} },
    '../components/Motion': { animateLayout() {} },
    '../i18n': {
      useT: () => new Proxy({}, { get: (_, key) => key }),
      useSay: () => (text) => text,
      fill: (text, value) => text.replace('{0}', value),
    },
    '@ramu/shared/discovery/tracker': { reviewSelection: () => null },
    '../runtime/nearby': { useNearbyHosts: () => ({ state: { hosts: options.hosts ?? [] } }) },
    '../runtime/nearbyModel': nearby,
  }
  const module = { exports: {} }
  const code = ts.transpileModule(readFileSync(new URL('../src/app/pair.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(code, { exports: module.exports, require: (id) => mocks[id] ?? components })
  return {
    render: () => {
      cursor = 0
      return module.exports.default()
    },
    calls,
    alerts,
    toasts,
    navigation,
    finish: (error) => finish(error),
  }
}
function nodes(tree) {
  return !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)]
}
const find = (tree, type, predicate = () => true) =>
  nodes(tree).find((node) => node.type === type && predicate(node.props))
for (const os of ['ios', 'android']) {
  test(`${os}: scanning a code with an encrypted address pairs at once, once, and lands home`, async () => {
    const h = harness(os)
    let tree = h.render()
    assert.equal(find(tree, 'CameraView'), undefined)
    find(
      tree,
      'Pressable',
      (props) => props.accessibilityRole === 'tab' && props.children.props.children === 'pairScanQr',
    ).props.onPress()
    tree = h.render()
    const camera = find(tree, 'CameraView')
    const data = encodePairWebLink({
      url: 'https://studio.local:7788',
      code: 'ABCDE-FGHJK',
      expiresAt: Date.now() + 60000,
      name: 'Studio',
    })
    camera.props.onBarcodeScanned({ data })
    camera.props.onBarcodeScanned({ data })
    assert.deepEqual(h.calls, [['Studio', 'https://studio.local:7788', 'ABCDE-FGHJK', false]])
    tree = h.render()
    assert.equal(find(tree, 'CameraView'), undefined)
    assert.ok(
      find(tree, 'T', (props) => props.children === 'pairPairingWith'),
      'shows which computer it is pairing with',
    )
    assert.equal(find(tree, 'TextInput'), undefined, 'no detour through the form')
    h.finish()
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(h.toasts, ['pairedWith'])
    assert.deepEqual(h.navigation, ['/'])
  })
  test(`${os}: a refused code reads as expired with what to do next, not a status code`, async () => {
    const h = harness(os, { hosts: [] })
    let tree = h.render()
    find(
      tree,
      'Pressable',
      (props) => props.accessibilityRole === 'tab' && props.children.props.children === 'pairScanQr',
    ).props.onPress()
    tree = h.render()
    find(tree, 'CameraView').props.onBarcodeScanned({
      data: encodePairWebLink({ url: 'https://studio.local:7788', code: 'ABCDE-FGHJK', expiresAt: Date.now() + 60000 }),
    })
    h.finish(new Error('That pairing code is wrong, already used or expired'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    tree = h.render()
    assert.equal(h.alerts.length, 0)
    assert.ok(find(tree, 'T', (props) => props.children === 'pairProblemExpired'))
    assert.ok(find(tree, 'T', (props) => props.children === 'pairProblemExpiredNext'))
    assert.ok(find(tree, 'GlassButton', (props) => props.title === 'pairScanAgain'))
    assert.deepEqual(h.navigation, [])
  })
  test(`${os}: editing a scanned address clears HTTP consent and failed scans can be retried`, () => {
    const h = harness(os)
    let tree = h.render()
    const qr = () =>
      find(
        tree,
        'Pressable',
        (props) => props.accessibilityRole === 'tab' && props.children.props.children === 'pairScanQr',
      ).props.onPress()
    qr()
    tree = h.render()
    find(tree, 'CameraView').props.onBarcodeScanned({ data: 'invalid QR' })
    tree = h.render()
    assert.equal(h.alerts.length, 0)
    assert.ok(find(tree, 'T', (props) => props.children === 'pairProblemInvalid'))
    find(tree, 'GlassButton', (props) => props.title === 'pairScanAgain').props.onPress()
    tree = h.render()
    find(tree, 'CameraView').props.onBarcodeScanned({
      data: encodePairWebLink({ url: 'http://studio.local:7788', code: 'ABCDE-FGHJK', expiresAt: Date.now() + 60000 }),
    })
    tree = h.render()
    assert.equal(find(tree, 'GlassButton', (props) => props.primary).props.disabled, true)
    find(tree, 'Toggle').props.onValueChange(true)
    tree = h.render()
    assert.equal(find(tree, 'GlassButton', (props) => props.primary).props.disabled, false)
    find(tree, 'TextInput', (props) => props.accessibilityLabel === 'pairAddress').props.onChangeText(
      'http://other.local:7788',
    )
    tree = h.render()
    assert.equal(find(tree, 'Toggle').props.value, false)
    assert.equal(find(tree, 'GlassButton', (props) => props.primary).props.disabled, true)
  })
}

for (const os of ['ios', 'android']) {
  test(`${os}: a verified VPN result reconnects the existing host without requesting a pairing code`, async () => {
    const events = []
    const host = {
      key: 'paired-mac',
      name: 'Work Mac',
      label: 'Work Mac',
      hostId: 'a'.repeat(32),
      pairedHostId: 'mac',
      scheme: 'http',
      routes: [{ url: 'http://100.99.224.30:7788', interfaceName: null }],
    }
    const h = harness(os, {
      hosts: [host],
      store: {
        computers: [{ id: 'mac', name: 'Work Mac', address: 'http://192.168.1.3:7788', status: 'offline' }],
        reviewAddress: async (...args) => {
          events.push(['review', ...args])
          return 'moved'
        },
        select: (id) => events.push(['select', id]),
        retry: (id) => events.push(['retry', id]),
      },
    })
    let tree = h.render()
    find(
      tree,
      'Pressable',
      (props) => props.accessibilityRole === 'button' && props.accessibilityState?.selected === false,
    ).props.onPress()
    tree = h.render()
    const button = find(tree, 'GlassButton', (props) => props.primary && props.title === 'nearbyReconnect')
    assert.ok(button)
    const pending = button.props.onPress()
    await button.props.onPress()
    await pending
    assert.deepEqual(events, [
      ['review', 'mac', host.routes[0].url],
      ['select', 'mac'],
    ])
    assert.equal(h.calls.length, 0, 'no new pairing request or credential')
    assert.deepEqual(h.navigation, ['/'])
  })

  test(`${os}: failed host proof stays in discovery and never reconnects or pairs`, async () => {
    const host = {
      key: 'paired-mac',
      name: 'Work Mac',
      label: 'Work Mac',
      pairedHostId: 'mac',
      scheme: 'http',
      routes: [{ url: 'http://100.99.224.30:7788', interfaceName: null }],
    }
    const h = harness(os, {
      hosts: [host],
      store: {
        computers: [{ id: 'mac', name: 'Work Mac', address: 'http://192.168.1.3:7788' }],
        reviewAddress: async () => 'mismatch',
        select: () => assert.fail('must not select an impostor'),
        retry: () => assert.fail('must not connect'),
      },
    })
    find(
      h.render(),
      'Pressable',
      (props) => props.accessibilityRole === 'button' && props.accessibilityState?.selected === false,
    ).props.onPress()
    await find(h.render(), 'GlassButton', (props) => props.primary && props.title === 'nearbyReconnect').props.onPress()
    assert.equal(h.calls.length, 0)
    assert.deepEqual(h.navigation, [])
  })
}

for (const os of ['ios', 'android']) {
  test(`${os}: both Mac interface addresses are visible and selecting .3 reconnects without pairing`, async () => {
    const requests = []
    const host = {
      key: 'paired-mac',
      name: 'Work Mac',
      label: 'Work Mac',
      pairedHostId: 'mac',
      scheme: 'http',
      routes: ['http://192.168.1.4:7788', 'http://192.168.1.3:7788'].map((url) => ({ url, interfaceName: null })),
    }
    const h = harness(os, {
      hosts: [host],
      store: {
        computers: [{ id: 'mac', name: 'Work Mac', address: 'http://192.168.1.4:7788', status: 'offline' }],
        reviewAddress: async (_id, address) => {
          requests.push(address)
          return 'moved'
        },
        select() {},
        retry() {},
      },
    })
    let tree = h.render()
    assert.ok(
      find(
        tree,
        'T',
        (props) =>
          String(props.children).includes('192.168.1.3:7788') && String(props.children).includes('192.168.1.4:7788'),
      ),
    )
    find(
      tree,
      'Pressable',
      (props) => props.accessibilityRole === 'button' && props.accessibilityState?.selected === false,
    ).props.onPress()
    tree = h.render()
    const radios = nodes(tree).filter((node) => node.type === 'Pressable' && node.props.accessibilityRole === 'radio')
    assert.equal(radios.length, 2)
    radios[1].props.onPress()
    await find(h.render(), 'GlassButton', (props) => props.primary && props.title === 'nearbyReconnect').props.onPress()
    assert.deepEqual(requests, ['http://192.168.1.3:7788'])
    assert.equal(h.calls.length, 0)
  })
}
