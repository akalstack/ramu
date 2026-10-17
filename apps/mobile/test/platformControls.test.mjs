import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as settingsModel from '../src/runtime/settingsModel.ts'

const require = createRequire(import.meta.url)
const palette = new Proxy({}, { get: (_, key) => String(key) })
const theme = {
  useTheme: () => ({ c: palette, scheme: 'light' }),
  font: { body: 15, control: 13, caption: 12 },
  radius: { s: 8, m: 12, full: 999 },
  space: { s: 8, m: 12, l: 16, xl: 24 },
}
const components = new Proxy({}, { get: (_, key) => String(key) })
const Toolbar = Object.assign(() => {}, { SearchBarSlot: 'NativeSearchSlot', Button: 'ToolbarButton' })
const Stack = { SearchBar: 'NativeSearch', Screen: 'StackScreen', Toolbar }

// Render the actual TSX at the native boundary, without needing a device for event regressions.
function load(file, os, overrides = {}, globals = {}) {
  const module = { exports: {} }
  const native = {
    ...components,
    useWindowDimensions: () => ({ width: 400, height: 800 }),
    View: 'View',
    Pressable: 'Pressable',
    Text: 'Text',
    TextInput: 'TextInput',
    Platform: { OS: os, select: (values) => values[os] ?? values.default },
    UIManager: { hasViewManagerConfig: () => false },
    StyleSheet: {
      create: (styles) => styles,
      flatten: (styles) => Object.assign({}, ...[styles].flat(Infinity).filter(Boolean)),
    },
  }
  const mocks = {
    'react-native': native,
    'expo-router': { Stack, useRouter: () => ({ push() {} }) },
    'lucide-react-native': components,
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    'react-native-screens/experimental': {},
    'expo-glass-effect': {
      isGlassEffectAPIAvailable: () => true,
      isLiquidGlassAvailable: () => true,
      GlassView: 'NativeGlass',
    },
    'expo-blur': { BlurView: 'BlurView' },
    ...overrides,
  }
  const code = ts.transpileModule(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  runInNewContext(code, {
    ...globals,
    exports: module.exports,
    require: (id) => {
      if (id in mocks) return mocks[id]
      if (id.endsWith('/theme')) return theme
      if (id === 'react' || id === 'react/jsx-runtime') return require(id)
      return components
    },
  })
  return module.exports
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return []
  return [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)]
}
function find(tree, type) {
  return nodes(tree).find((node) => node.type === type)
}

for (const os of ['android', 'ios']) {
  test(`${os} native settings search filters, navigates and clears results`, () => {
    let query = ''
    let destination
    const { default: Menu } = load('app/settings/index.tsx', os, {
      react: {
        useState: () => [
          query,
          (next) => {
            query = next
          },
        ],
      },
      'expo-router': {
        Stack,
        useRouter: () => ({
          push: (route) => {
            destination = route
          },
        }),
      },
      '../../runtime/store': { useStore: () => ({ language: 'en', selected: null }) },
      '../../runtime/useHostSettings': { useHostSettings: () => ({ state: { status: 'offline' } }) },
      '../../runtime/settingsModel': settingsModel,
      '../../i18n': { useT: () => ({ settings: 'Settings' }) },
    })
    const initial = Menu()
    const search = find(initial, 'NativeSearch')
    assert.ok(search, 'the OS owns search, instead of an elevated custom field')
    assert.equal(Boolean(find(initial, 'NativeSearchSlot')), os === 'ios')
    assert.equal(find(initial, 'TextInput'), undefined)
    search.props.onChangeText({ nativeEvent: { text: 'appearance' } })
    const result = nodes(Menu()).find((node) => node.type === 'Row' && node.props.onPress)
    assert.ok(result)
    result.props.onPress()
    assert.equal(destination.params.section, 'appearance')
    search.props.onClose()
    assert.equal(query, '')
    search.props.onChangeText({ nativeEvent: { text: 'no such setting xyz' } })
    assert.ok(
      nodes(Menu()).some((node) => node.type === 'T' && String(node.props.children).includes('No settings match')),
    )
    search.props.onCancelButtonPress()
    assert.equal(query, '')
  })
}

test('Android pairing actions use filled buttons, while iOS keeps glass', () => {
  const android = load('components/Screen.tsx', 'android')
  const ios = load('components/Screen.tsx', 'ios')
  const action = { title: 'Pair', primary: true, disabled: true }
  const button = android.GlassButton(action)
  assert.equal(button.type, 'Button')
  assert.equal(button.props.kind, 'primary')
  assert.equal(button.props.disabled, true)
  assert.ok(find(ios.GlassButton(action), 'Glass'))
  assert.equal(android.Header({ title: 'Settings' }).props.options.headerTitleAlign, 'left')
})

test('Android surfaces have no blanket shadow; iOS uses native Liquid Glass', () => {
  const android = load('components/Glass.tsx', 'android').Glass({ radius: 24 })
  const ios = load('components/Glass.tsx', 'ios').Glass({ radius: 24 })
  const style = Object.assign({}, ...android.props.style)
  assert.equal(style.elevation, 0)
  assert.equal(style.backgroundColor, 'raised2')
  assert.equal(ios.type, 'NativeGlass')
})

test('appearance overrides reach native controls and System releases the override', () => {
  let preference = 'dark'
  const nativeSchemes = []
  const saved = []
  const { ThemeProvider } = load('theme/index.tsx', 'ios', {
    react: {
      createContext: () => ({ Provider: 'ThemeProvider' }),
      useState: () => [
        preference,
        (next) => {
          preference = next
        },
      ],
      useMemo: (compute) => compute(),
      useEffect: (effect) => effect(),
    },
    'react-native': {
      Platform: { select: (values) => values.ios },
      useColorScheme: () => 'light',
      Appearance: { setColorScheme: (scheme) => nativeSchemes.push(scheme) },
    },
    '../storage': { readAppearance: () => preference, saveAppearance: (value) => saved.push(value) },
  })
  const dark = ThemeProvider({})
  assert.equal(dark.props.value.scheme, 'dark')
  assert.equal(nativeSchemes.at(-1), 'dark')
  dark.props.value.setAppearance('light')
  const light = ThemeProvider({})
  assert.equal(light.props.value.scheme, 'light')
  assert.equal(nativeSchemes.at(-1), 'light')
  light.props.value.setAppearance('system')
  assert.equal(ThemeProvider({}).props.value.scheme, 'light')
  assert.equal(nativeSchemes.at(-1), 'unspecified')
  assert.deepEqual(saved, ['light', 'system'])
})

for (const os of ['android', 'ios']) {
  test(`${os} thread search opens appropriately and filters without losing its query`, () => {
    const state = ['', []]
    let cursor = 0
    let onEnter
    let focused = 0
    let blurred = 0
    let frameId = 0
    const frames = new Map()
    const flushFrames = () => {
      const pending = [...frames.values()]
      frames.clear()
      pending.forEach((callback) => callback())
    }
    const ref = { current: { focus: () => focused++, blur: () => blurred++ } }
    const { default: SearchScreen } = load(
      'app/(tabs)/search/index.tsx',
      os,
      {
        'expo-router': {
          Stack,
          useRouter: () => ({}),
          useFocusEffect: (effect) => {
            onEnter = effect
          },
        },
        react: {
          useRef: () => ref,
          useCallback: (callback) => callback,
          useState: () => {
            const index = cursor++
            return [
              state[index],
              (value) => {
                state[index] = value
              },
            ]
          },
          useMemo: (compute) => compute(),
          useEffect: () => {},
        },
        '../../../runtime/store': {
          useStore: () => ({
            computers: [],
            projects: [],
            chats: [
              { id: 'a', title: 'Fix search', preview: '', lastActiveAt: 2 },
              { id: 'b', title: 'Pair a host', preview: '', lastActiveAt: 1 },
            ],
          }),
        },
        '../../../i18n': { useT: () => ({ search: 'Search threads', recent: 'Recent', chats: 'Threads' }) },
        '../../../components/Overlays': { useTabActions: () => null },
      },
      {
        requestAnimationFrame: (callback) => {
          frames.set(++frameId, callback)
          return frameId
        },
        cancelAnimationFrame: (id) => frames.delete(id),
      },
    )
    const render = () => {
      cursor = 0
      return SearchScreen()
    }
    const initial = render()
    const search = find(initial, 'NativeSearch')
    assert.equal(
      search.props.autoFocus,
      os === 'android',
      'Android also uses native autofocus for the initial header mount',
    )
    assert.equal(nodes(initial).filter((node) => node.type === 'ChatRow').length, 2)
    search.props.onChangeText({ nativeEvent: { text: 'pair' } })
    const results = nodes(render()).filter((node) => node.type === 'ChatRow')
    assert.equal(results.length, 1)
    assert.equal(results[0].props.chat.id, 'b')
    const onLeave = onEnter()
    assert.equal(focused, 0, 'wait for the native header to attach')
    flushFrames()
    assert.equal(focused, 1, 'entering the tab opens the input')
    onLeave()
    onEnter()
    flushFrames()
    assert.equal(focused, 2, 'returning to the tab opens the input again')
    assert.equal(blurred, 1, 'leaving the tab releases input focus')
    const leaveImmediately = onEnter()
    leaveImmediately()
    flushFrames()
    assert.equal(focused, 2, 'a cancelled visit cannot open the keyboard on another tab')
    assert.equal(nodes(render()).filter((node) => node.type === 'ChatRow').length, 1, 'rerendering keeps the query')
    search.props.onCancelButtonPress()
    assert.equal(nodes(render()).filter((node) => node.type === 'ChatRow').length, 2)
  })
}

test('scroll-edge support uses the public native registry and safely falls back in Expo Go', () => {
  for (const [os, available, expected] of [
    ['ios', true, true],
    ['ios', false, false],
    ['android', true, false],
  ]) {
    let checked
    const screen = load('components/Screen.tsx', os, {
      'react-native': {
        Platform: { OS: os },
        UIManager: {
          hasViewManagerConfig: (name) => {
            checked = name
            return available
          },
        },
      },
    })
    assert.equal(screen.nativeScrollEdge, expected)
    assert.equal(checked, os === 'ios' ? 'RNSScrollViewMarker' : undefined)
  }
  const screen = load('components/Screen.tsx', 'ios', {
    'react-native': {
      Platform: { OS: 'ios' },
      UIManager: {
        hasViewManagerConfig: () => {
          throw Error('unavailable')
        },
      },
    },
  })
  assert.equal(screen.nativeScrollEdge, false)
})

test('a new-thread form keeps its chosen host when the global selection changes', async () => {
  const values = []
  let cursor = 0
  let submitted
  const store = {
    selected: 'a',
    computers: [
      { id: 'a', name: 'Laptop', status: 'online' },
      { id: 'b', name: 'Server', status: 'online' },
    ],
    projects: [],
    defaults: {},
    isOnline: () => true,
    createChat: async (input) => {
      submitted = input
      return 'a:new-chat'
    },
  }
  const { default: NewChat } = load('app/new.tsx', 'android', {
    react: {
      useState(initial) {
        const index = cursor++
        if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial
        return [
          values[index],
          (next) => {
            values[index] = typeof next === 'function' ? next(values[index]) : next
          },
        ]
      },
      useEffect() {},
    },
    'expo-router': {
      useRouter: () => ({ replace() {} }),
      useLocalSearchParams: () => ({ project: 'no-project' }),
    },
    '../runtime/store': { useStore: () => store },
    '../runtime/types': { STANDALONE: 'no-project' },
    '../i18n': { useT: () => ({ newChat: 'New thread' }) },
    '../components/Keyboard': { useKeyboardInset: () => 0 },
  })
  NewChat()
  store.selected = 'b'
  cursor = 0
  const composer = find(NewChat(), 'Composer')
  assert.equal(composer.props.computerId, 'a')
  await composer.props.onSend('Run tests', 'send', [], [])
  assert.equal(submitted.computerId, 'a')
  assert.equal(submitted.projectId, 'no-project')
})
