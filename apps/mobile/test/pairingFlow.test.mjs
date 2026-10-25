import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as nearby from '../src/runtime/nearbyModel.ts'
import { decodePairQr, encodePairQr } from '../../../packages/contracts/src/index.ts'

const require = createRequire(import.meta.url)
function harness(os) {
  const slots = []
  let cursor = 0
  const calls = [],
    alerts = [],
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
      ...Object.fromEntries(['KeyboardAvoidingView', 'Pressable', 'TextInput', 'View'].map((k) => [k, k])),
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
    '@ramu/contracts': { decodePairQr },
    '../theme': { font: {}, radius: {}, space: { l: 16, m: 12 }, useTheme: () => ({ c: {} }) },
    '../runtime/store': {
      useStore: () => ({
        computers: [],
        pair: (...args) => {
          calls.push(args)
          return new Promise((resolve) => {
            finish = resolve
          })
        },
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
    '../components/ui': { T: 'T', Card: 'Card', Toggle: 'Toggle', tap() {} },
    '../components/Motion': { animateLayout() {} },
    '../i18n': { useT: () => new Proxy({}, { get: (_, key) => key }), useSay: () => (text) => text },
    '@ramu/shared/discovery/tracker': { reviewSelection: () => null },
    '../runtime/nearby': { useNearbyHosts: () => ({ state: { hosts: [] } }) },
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
    navigation,
    finish: () => finish(),
  }
}
function nodes(tree) {
  return !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)]
}
const find = (tree, type, predicate = () => true) =>
  nodes(tree).find((node) => node.type === type && predicate(node.props))
for (const os of ['ios', 'android']) {
  test(`${os}: scanning closes the camera, keeps Pair outside the scroll view and prevents duplicate pairing`, async () => {
    const h = harness(os)
    let tree = h.render()
    assert.equal(find(tree, 'CameraView'), undefined)
    find(
      tree,
      'Pressable',
      (props) => props.accessibilityRole === 'tab' && props.children.props.children === 'pairScanQr',
    ).props.onPress()
    tree = h.render()
    find(tree, 'CameraView').props.onBarcodeScanned({
      data: encodePairQr({ url: 'https://studio.local:7788', code: 'ABCDE-FGHJK', expiresAt: Date.now() + 60000 }),
    })
    tree = h.render()
    assert.equal(find(tree, 'CameraView'), undefined)
    assert.equal(
      find(find(tree, 'ScrollView'), 'GlassButton', (props) => props.primary),
      undefined,
    )
    assert.equal(find(tree, 'TextInput').props.style.height, undefined, 'fields can grow with system text sizing')
    const pair = find(tree, 'GlassButton', (props) => props.primary)
    assert.equal(pair.props.disabled, false)
    const pending = pair.props.onPress()
    await pair.props.onPress()
    assert.equal(h.calls.length, 1)
    assert.equal(find(h.render(), 'GlassButton', (props) => props.primary).props.disabled, true)
    h.finish()
    await pending
    assert.deepEqual(h.navigation, ['/'])
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
    assert.equal(h.alerts.length, 1)
    tree = h.render()
    find(tree, 'GlassButton', (props) => props.title === 'pairScanAgain').props.onPress()
    tree = h.render()
    find(tree, 'CameraView').props.onBarcodeScanned({
      data: encodePairQr({ url: 'http://studio.local:7788', code: 'ABCDE-FGHJK', expiresAt: Date.now() + 60000 }),
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
