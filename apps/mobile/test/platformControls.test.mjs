import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as settingsModel from '../src/runtime/settingsModel.ts'
import * as taskRemoval from '../../../packages/shared/src/chat/taskRemoval.ts'
import * as terminalOutput from '../../../packages/shared/src/workspace/terminalOutput.ts'
import * as terminalKeys from '../src/runtime/terminalKeys.ts'
import * as workspaceDefaults from '../../../packages/shared/src/workspaceDefaults.ts'
import * as workspaceChoices from '../src/runtime/workspaces.ts'
import * as explorerScopes from '../../../packages/shared/src/workspace/explorer.ts'
import * as explorerDrafts from '../src/runtime/composerDrafts.ts'
import * as localCommitStorage from '../src/storage/localCommit.ts'
import * as fileContextKeys from '../../../packages/shared/src/chat/fileContext.ts'
import * as composerTriggers from '../../../packages/shared/src/chat/composerTrigger.ts'
import * as agentDraftModel from '../../../packages/shared/src/workspace/agentDefaults.ts'

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
    ActivityIndicator: 'ActivityIndicator',
    ScrollView: 'ScrollView',
    Image: 'Image',
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
    '@ramu/shared/i18n': {
      translate: (_language, text, params = {}) =>
        text.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? `{${key}}`)),
    },
    'expo-router': { Stack, useRouter: () => ({ push() {} }), useFocusEffect() {} },
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
  mocks['react-native'] = { ...native, ...mocks['react-native'] }
  mocks['expo-router'] = { Stack, useRouter: () => ({ push() {} }), useFocusEffect() {}, ...mocks['expo-router'] }
  const code = ts.transpileModule(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(code, {
    ...globals,
    exports: module.exports,
    require: (id) => {
      if (id in mocks) return mocks[id]
      if (id === '@ramu/shared/types')
        return {
          DEFAULT_AGENT_SETTINGS: {
            provider: 'claude-code',
            model: '',
            effort: null,
            access: 'full',
            autoFallback: true,
          },
        }
      if (id.endsWith('/useAgentDraft'))
        return {
          useAgentDraft: (_host, _project, _key, settings) => ({
            settings,
            choice: { version: 1 },
            verify: async () => settings,
            consume() {},
            change() {},
            useHostDefault() {},
            useProjectDefault() {},
          }),
        }
      if (id.endsWith('/composerDrafts')) return explorerDrafts
      if (id === '@ramu/shared/chat/fileContext') return fileContextKeys
      if (id === '@ramu/shared/chat/composerTrigger') return composerTriggers
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
        memo: (component) => component,
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
      memo: (component) => component,
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
          memo: (component) => component,
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
    drafts: {},
    defaults: {},
    appPreferences: {
      a: { worktreeBranchNaming: 'custom', worktreeBranchInstructions: 'Use ABC-123/' },
      b: { worktreeBranchNaming: 'fixed' },
    },
    isOnline: () => true,
    createChat: async (input) => {
      submitted = input
      return 'a:new-chat'
    },
  }
  const { default: NewChat } = load('app/new.tsx', 'android', {
    react: {
      memo: (component) => component,
      useRef: (current) => ({ current }),
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
    '@ramu/shared/workspaceDefaults': workspaceDefaults,
    '@ramu/shared/workspace/explorer': explorerScopes,
    '../runtime/workspaces': workspaceChoices,
    '../runtime/useWorkspaces': { useWorkspaces: () => ({ rows: [] }) },
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
  assert.equal(submitted.branchNaming.strategy, 'custom')
  assert.equal(submitted.branchNaming.instructions, 'Use ABC-123/')
  assert.equal(submitted.branchNaming.prompt, 'Run tests')
})

test('helper details honor capabilities and disconnected hosts without losing the parent context', async () => {
  const helpers = await import('../../../packages/shared/src/chat/helperPresentation.ts')
  let online = true
  const calls = []
  const store = {
    language: 'en',
    isOnline: () => online,
    invoke: async (...args) => {
      calls.push(args)
    },
  }
  const { HelperDetails } = load('components/Helpers.tsx', 'android', {
    react: {
      memo: (component) => component,
      useState: (value) => [value === '' ? 'hello' : value, () => {}],
      useEffect() {},
      useRef: (value) => ({ current: value }),
    },
    '@ramu/shared/chat/helperPresentation': helpers,
    '../runtime/store': { useStore: () => store },
  })
  const chat = { id: 'remote:chat', computerId: 'remote', sessionId: 'parent' }
  const task = { agentId: 'helper', id: 'helper', name: 'Helper', status: 'running', canMessage: false, canStop: false }
  const readonly = HelperDetails({ task, chat, onClose() {} })
  assert.equal(
    nodes(readonly).some((node) => node.type === 'TextInput'),
    false,
  )
  assert.equal(
    nodes(readonly).some((node) => node.type === 'Button' && node.props.title === 'Stop agent'),
    false,
  )
  const capable = HelperDetails({ task: { ...task, canMessage: true, canStop: true }, chat, onClose() {} })
  const send = nodes(capable).find((node) => node.type === 'Button' && node.props.title === 'Send')
  send.props.onPress()
  send.props.onPress()
  await Promise.resolve()
  assert.deepEqual(calls, [['remote', 'agent.messageTask', 'parent', 'helper', 'hello']])
  online = false
  const offline = HelperDetails({ task: { ...task, canMessage: true, canStop: true }, chat, onClose() {} })
  assert.equal(
    nodes(offline).some((node) => node.type === 'TextInput'),
    false,
  )
  assert.equal(
    nodes(offline).some((node) => node.type === 'Button' && node.props.title === 'Stop agent'),
    false,
  )
})

test('Inbox request cards retain their host and request identity and become read-only offline', async () => {
  const { pendingRequest } = await import('../src/runtime/threadActivity.ts')
  let online = true
  const { InputRequests, InboxThread } = load('components/InputRequests.tsx', 'ios', {
    react: { useState: () => [true, () => {}] },
    '../runtime/store': { useStore: () => ({ language: 'en', isOnline: () => online }) },
    '../runtime/threadActivity': { pendingRequest },
  })
  const chat = {
    computerId: 'remote',
    id: 'remote:c',
    sessionId: 's',
    items: [
      { kind: 'permission', id: 'approval', requestSource: { name: 'Child', sessionId: 'child', agentId: 'child' } },
      { kind: 'question', id: 'answered', answers: { x: 'yes' } },
    ],
  }
  const waiting = InputRequests({ chat })
  const card = find(waiting, 'TranscriptItemView')
  assert.equal(card.props.item.id, 'approval')
  assert.equal(card.props.chat.computerId, 'remote')
  const row = InboxThread({ chat })
  assert.equal(
    nodes(row).some((node) => node.type === 'Button' && node.props.title === 'Hide requests · 1'),
    true,
  )
  online = false
  assert.equal(find(InputRequests({ chat }), 'TranscriptItemView'), undefined)
})

for (const os of ['ios', 'android']) {
  test(`${os} new threads restore an existing workspace and keep browse, context and creation in that scope`, async () => {
    const values = []
    let cursor = 0
    let submitted
    const destinations = []
    const store = {
      selected: 'a',
      computers: [{ id: 'a', name: 'Laptop', status: 'online' }],
      projects: [{ id: 'a:p', computerId: 'a', name: 'Project', kind: 'repo' }],
      drafts: {
        'a:new:a:p:workspace': JSON.stringify({ version: 1, mode: 'worktree', workspaceId: 'w', name: 'Login' }),
      },
      defaults: {},
      appPreferences: { a: { defaultCheckoutMode: 'current' } },
      isOnline: () => false,
      setDraft: (key, text) => {
        store.drafts[key] = text
      },
      createChat: async (input) => {
        submitted = input
        return 'a:pending'
      },
    }
    const catalog = {
      rows: [
        { id: 'w', projectId: 'p', name: 'Login' },
        { id: 'wrong', projectId: 'other', name: 'Login' },
      ],
    }
    const { default: NewChat } = load('app/new.tsx', os, {
      react: {
        memo: (component) => component,
        useRef: (current) => ({ current }),
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
        useRouter: () => ({ push: (path) => destinations.push(path), replace() {} }),
        useLocalSearchParams: () => ({ project: 'a:p' }),
      },
      '@ramu/shared/workspaceDefaults': workspaceDefaults,
      '@ramu/shared/workspace/explorer': explorerScopes,
      '../runtime/workspaces': workspaceChoices,
      '../runtime/useWorkspaces': { useWorkspaces: () => catalog },
      '../runtime/store': { useStore: () => store },
      '../runtime/types': { STANDALONE: 'no-project' },
      '../i18n': { useT: () => ({ browseFiles: 'Browse files' }) },
      '../components/Keyboard': { useKeyboardInset: () => 0 },
    })
    const render = () => {
      cursor = 0
      return NewChat()
    }
    let tree = render()
    let composer = find(tree, 'Composer')
    assert.equal(composer.props.scope, 'worktree:w')
    assert.equal(composer.props.draftKey, 'a:new:a:p')
    assert.equal(
      nodes(tree).some((node) => node.key === 'wrong'),
      false,
    )
    nodes(composer.props.header)
      .find((node) => node.props?.label === 'Browse files')
      .props.onPress()
    assert.deepEqual(JSON.parse(JSON.stringify(destinations[0])), {
      pathname: '/explorer',
      params: { computer: 'a', ctx: 'worktree:w', composerProject: 'a:p' },
    })
    await composer.props.onSend('Fix login', 'send', [], [])
    assert.equal(submitted.workspaceId, 'w')
    assert.equal(submitted.mode, 'worktree')
    assert.equal(submitted.computerId, 'a')
    // Changing checkout preserves the same unsent composer; its references now resolve in the explicitly chosen scope.
    nodes(tree)
      .find((node) => node.key === 'current')
      .props.onPress()
    composer = find(render(), 'Composer')
    assert.equal(composer.props.scope, 'project:p')
    assert.equal(composer.props.draftKey, 'a:new:a:p')
    assert.equal(JSON.parse(store.drafts['a:new:a:p:workspace']).mode, 'current')
    // Reopening restores the user's explicit choice rather than following a changed host default.
    values.length = 0
    store.appPreferences.a.defaultCheckoutMode = 'worktree'
    tree = render()
    await find(tree, 'Composer').props.onSend('Keep current', 'send', [], [])
    assert.equal(submitted.mode, 'current')
    assert.equal(submitted.workspaceId, undefined)
  })
}

function hookHarness() {
  const states = [],
    setters = [],
    refs = [],
    effects = [],
    memos = []
  let stateIndex = 0,
    refIndex = 0,
    effectIndex = 0,
    memoIndex = 0
  const pending = []
  const memo = (compute, deps) => {
    const index = memoIndex++
    const previous = memos[index]
    if (previous && deps?.every((dep, i) => Object.is(dep, previous.deps?.[i]))) return previous.value
    const value = compute()
    memos[index] = { deps, value }
    return value
  }
  return {
    react: {
      memo: (component) => component,
      useMemo: memo,
      useCallback: (callback, deps) => memo(() => callback, deps),
      useState(initial) {
        const index = stateIndex++
        if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
        setters[index] ??= (next) => {
          states[index] = typeof next === 'function' ? next(states[index]) : next
        }
        return [states[index], setters[index]]
      },
      useRef(initial) {
        const index = refIndex++
        return (refs[index] ??= { current: initial })
      },
      useEffect(run, deps) {
        const index = effectIndex++
        const previous = effects[index]
        if (previous && deps?.every((dep, i) => Object.is(dep, previous.deps?.[i]))) return
        pending.push(() => {
          previous?.cleanup?.()
          effects[index] = { deps, cleanup: run() }
        })
      },
    },
    render(run) {
      stateIndex = refIndex = effectIndex = memoIndex = 0
      const tree = run()
      while (pending.length) pending.shift()()
      return tree
    },
    dispose() {
      for (const effect of effects) effect?.cleanup?.()
    },
  }
}
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

for (const os of ['ios', 'android']) {
  test(`${os} usage details follow account events and discard responses after host changes or dismissal`, async () => {
    const presentation = await import('../../../packages/shared/src/usage/presentation.ts')
    const providers = await import('../../../packages/shared/src/providers/providers.ts')
    const { isMethodMissing } = await import('../src/runtime/goalVerify.ts')
    const hooks = hookHarness()
    const listeners = new Map()
    const requests = []
    const store = {
      language: 'en',
      computers: [
        { id: 'a', name: 'Laptop' },
        { id: 'b', name: 'Server' },
      ],
      appPreferences: {},
      usage: {},
      isOnline: () => true,
      invoke: (host, method) => {
        const request = { host, method, ...deferred() }
        requests.push(request)
        return request.promise
      },
      subscribe: (host, listener) => {
        listeners.set(host, listener)
        return () => listeners.delete(host)
      },
    }
    const { PlanUsageSheet, PlanUsageReading } = load('components/PlanUsage.tsx', os, {
      react: hooks.react,
      '@ramu/shared/usage/presentation': presentation,
      '@ramu/shared/providers/providers': providers,
      '../runtime/goalVerify': { isMethodMissing },
      '../runtime/store': { useStore: () => store },
      '../runtime/types': { providerNames: { 'claude-code': 'Claude' } },
    })
    let props = { hosts: ['a'], open: true, onClose() {} }
    const render = () => hooks.render(() => PlanUsageSheet(props))
    const readings = () =>
      nodes(render())
        .filter((node) => node.type === PlanUsageReading)
        .map((node) => node.props.reading)
    render()
    assert.equal(requests[0].method, 'usage.accounts')
    listeners.get('a')('usage:changed')
    const row = (usedPercent, accountId = 'work') => ({
      provider: 'claude-code',
      accountId,
      window: 'weekly',
      usedPercent,
      updatedAt: Date.now(),
      status: 'ok',
    })
    requests[1].resolve([row(42)])
    await settle()
    requests[0].resolve([row(1)])
    await settle()
    assert.equal(readings()[0].usedPercent, 42, 'older account reads cannot replace a newer event reading')
    listeners.get('a')('usage:changed')
    listeners.get('a')('usage:changed')
    requests[3].resolve([row(43)])
    await settle()
    requests[2].reject(Error('Old connection failed'))
    await settle()
    assert.equal(readings()[0].usedPercent, 43)
    assert.equal(
      nodes(render()).some(
        (node) => typeof node.props?.children === 'string' && node.props.children.includes('Could not load accounts'),
      ),
      false,
    )

    props = { ...props, accountId: 'personal' }
    assert.equal(readings().length, 0, 'a different login never borrows work readings')
    props = { ...props, accountId: undefined, hosts: ['b'] }
    render()
    assert.equal(listeners.has('a'), false)
    assert.equal(readings().length, 0)
    requests.at(-1).resolve([row(64)])
    await settle()
    assert.equal(readings()[0].usedPercent, 64)
    listeners.get('b')('usage:changed')
    const late = requests.at(-1)
    props = { ...props, open: false }
    render()
    late.resolve([row(99)])
    await settle()
    assert.equal(readings()[0].usedPercent, 64)
    assert.equal(listeners.size, 0, 'closing the sheet stops account event reads')
    hooks.dispose()
  })
}

test('usage refresh explains old hosts, preserves data and opens the selected host settings', async () => {
  const presentation = await import('../../../packages/shared/src/usage/presentation.ts')
  const providers = await import('../../../packages/shared/src/providers/providers.ts')
  const { isMethodMissing } = await import('../src/runtime/goalVerify.ts')
  const hooks = hookHarness()
  const calls = [],
    destinations = []
  let closed = 0,
    selected
  const reading = { provider: 'claude-code', window: 'five_hour', usedPercent: 15, updatedAt: Date.now(), status: 'ok' }
  const store = {
    language: 'en',
    computers: [{ id: 'a', name: 'Laptop' }],
    appPreferences: {},
    usage: { a: [reading] },
    isOnline: () => true,
    subscribe: () => () => {},
    select: (id) => {
      selected = id
    },
    invoke: async (host, method) => {
      calls.push([host, method])
      if (method === 'usage.refresh') throw Error('Unknown method usage.refresh')
      return [reading]
    },
  }
  const { PlanUsageSheet, PlanUsageReading } = load('components/PlanUsage.tsx', 'android', {
    react: hooks.react,
    'expo-router': { useRouter: () => ({ push: (path) => destinations.push(path) }) },
    '@ramu/shared/usage/presentation': presentation,
    '@ramu/shared/providers/providers': providers,
    '../runtime/goalVerify': { isMethodMissing },
    '../runtime/store': { useStore: () => store },
    '../runtime/types': { providerNames: { 'claude-code': 'Claude' } },
  })
  const render = () =>
    hooks.render(() =>
      PlanUsageSheet({
        hosts: ['a'],
        open: true,
        onClose: () => {
          closed++
        },
      }),
    )
  const action = (tree, label) =>
    nodes(tree).find((node) => node.type === 'Row' && nodes(node).some((child) => child.props?.children === label))
  render()
  await settle()
  action(render(), 'Refresh Claude usage').props.onPress()
  await settle()
  const tree = render()
  assert.equal(nodes(tree).find((node) => node.type === PlanUsageReading).props.reading.usedPercent, 15)
  assert.deepEqual(calls, [
    ['a', 'usage.accounts'],
    ['a', 'usage.refresh'],
  ])
  assert.equal(action(tree, 'Refresh Claude usage').props.onPress, undefined)
  assert.ok(
    nodes(tree).some(
      (node) => typeof node.props?.children === 'string' && node.props.children.includes('Refresh unavailable'),
    ),
  )
  action(tree, 'Access & Fallback settings').props.onPress()
  assert.equal(selected, 'a')
  assert.equal(closed, 1)
  assert.deepEqual(destinations, ['/settings/access'])
  assert.deepEqual(calls, [
    ['a', 'usage.accounts'],
    ['a', 'usage.refresh'],
  ])
  hooks.dispose()
})

for (const os of ['ios', 'android']) {
  test(`${os} Home Explorer browses the chosen existing workspace without creating a task`, async () => {
    const hooks = hookHarness()
    const calls = [],
      destinations = []
    const store = {
      projects: [{ id: 'remote:p', computerId: 'remote', name: 'Project' }],
      computers: [{ id: 'remote', name: 'Server' }],
      isOnline: () => true,
      subscribe: () => () => {},
      invoke: async (host, method, ...args) => {
        calls.push([host, method, ...args])
        if (method === 'files.explorerBindings')
          return [{ repoId: 'r', repoName: 'Repo', taskBranch: 'ramu/login', cwd: '/work/login', setupState: 'ready' }]
        if (method === 'files.browse')
          return { entries: [{ name: 'README.md', path: 'README.md', kind: 'file' }], truncated: false }
        throw Error(`Unexpected ${method}`)
      },
    }
    const { default: Explorer } = load('app/explorer.tsx', os, {
      react: hooks.react,
      'expo-router': {
        useRouter: () => ({ push: (path) => destinations.push(path) }),
        useLocalSearchParams: () => ({}),
        useFocusEffect() {},
      },
      '@ramu/shared/workspace/explorer': explorerScopes,
      '../runtime/useWorkspaces': { useWorkspaces: () => ({ rows: [{ id: 'w', projectId: 'p', name: 'Login' }] }) },
      '../runtime/store': { useStore: () => store },
      '../i18n': { useT: () => ({ currentCheckout: 'Current checkout', existingWorkspace: 'Existing workspace' }) },
    })
    const render = () => hooks.render(() => Explorer())
    const list = find(render(), 'PageFlatList')
    const projectRow = list.props.renderItem({ item: list.props.data[0] })
    projectRow.props.onPress()
    const picker = find(render(), 'PageFlatList').props.ListEmptyComponent
    nodes(picker)
      .find((node) => node.key === 'w')
      .props.onPress()
    render()
    await settle()
    const files = find(render(), 'PageFlatList')
    assert.equal(files.props.data[0].entry.path, 'README.md')
    files.props.renderItem({ item: files.props.data[0] }).props.onPress()
    assert.deepEqual(JSON.parse(JSON.stringify(destinations)), [
      { pathname: '/file', params: { computer: 'remote', ctx: 'worktree:w', repoId: 'r', path: 'README.md' } },
    ])
    assert.deepEqual(calls, [
      ['remote', 'files.explorerBindings', 'worktree:w'],
      ['remote', 'files.browse', 'worktree:w', 'r', ''],
    ])
    assert.ok(nodes(files.props.ListHeaderComponent).some((node) => node.props?.children === '/work/login'))
    hooks.dispose()
  })
}

test('file suggestions qualify cached catalogs by host even when scope and repository IDs collide', async () => {
  const hooks = hookHarness()
  const calls = []
  const store = {
    isOnline: () => true,
    invoke: async (host, method) => {
      calls.push([host, method])
      if (method === 'files.all') return [{ repoId: 'r', path: `${host}.ts` }]
      if (method === 'skills.list') return []
      if (method === 'tasks.bindings') return [{ repoId: 'r', repoName: host }]
    },
  }
  const { useComposerSuggest } = load('components/ComposerSuggest.tsx', 'ios', {
    react: hooks.react,
    '../runtime/store': { useStore: () => store },
  })
  let props = { computerId: 'a', scope: 'project:p', text: '@', caret: 1 }
  const render = () => hooks.render(() => useComposerSuggest(props))
  render()
  await settle()
  assert.equal(render().choices.find((choice) => choice.kind === 'File').file.path, 'a.ts')
  props = { ...props, computerId: 'b' }
  assert.equal(
    render().choices.some((choice) => choice.kind === 'File'),
    false,
    'never exposes the old host catalog while the new host loads',
  )
  await settle()
  assert.equal(render().choices.find((choice) => choice.kind === 'File').file.path, 'b.ts')
  assert.equal(calls.filter(([host]) => host === 'b').length, 3)
  hooks.dispose()
})

for (const os of ['ios', 'android']) {
  test(`${os} new-thread file context uses the selected checkout and late results cannot open another scope's picker`, async () => {
    const hooks = hookHarness()
    const requests = []
    let sent
    const store = {
      drafts: { 'host:new:p': 'Review this file' },
      selected: 'host',
      chats: [],
      missingMethods: {},
      appPreferences: {},
      isOnline: () => true,
      clearComposerDraft: () => true,
      setDraft: (key, value) => {
        store.drafts[key] = value
      },
      invoke: (host, method, scope) => {
        const request = { host, method, scope, ...deferred() }
        requests.push(request)
        return request.promise
      },
    }
    const { Composer } = load('components/Composer.tsx', os, {
      react: hooks.react,
      './ui': new Proxy({}, { get: (_, key) => (key === 'tap' ? () => {} : String(key)) }),
      '@ramu/shared/chat/composerDraft': {
        composerDraft: (text) => ({ chips: [], segments: [{ kind: 'text', source: text }] }),
      },
      '../runtime/store': { useStore: () => store },
      '../i18n': { useT: () => ({}) },
      '../runtime/goalVerify': { offersVerify: () => false },
      './ComposerSuggest': { useComposerSuggest: () => ({ visible: false }) },
    })
    let props = {
      computerId: 'host',
      scope: 'worktree:w',
      draftKey: 'host:new:p',
      running: false,
      model: { provider: 'claude-code', model: 'opus' },
      onModel() {},
      onSend: async (...args) => {
        sent = args
      },
    }
    const render = () => hooks.render(() => Composer(props))
    const action = (tree, text) =>
      nodes(tree).find((node) => node.type === 'Row' && nodes(node).some((child) => child.props?.children === text))
    render()
    action(render(), 'Choose host file context').props.onPress()
    assert.equal(requests[0].scope, 'worktree:w')
    assert.equal(requests[0].method, 'files.all')
    props = { ...props, scope: 'worktree:other' }
    render()
    requests[0].resolve([{ repoId: 'r', path: 'old.ts' }])
    await settle()
    assert.equal(
      nodes(render()).some((node) => node.type === 'Sheet' && node.props.open && node.props.title === 'File context'),
      false,
    )
    action(render(), 'Choose host file context').props.onPress()
    requests[1].resolve([{ repoId: 'r', path: 'new.ts' }])
    await settle()
    action(render(), 'new.ts').props.onPress()
    render()
    assert.equal(JSON.parse(store.drafts['host:new:p:context'])[0].path, 'new.ts')
    assert.equal(sent, undefined, 'adding context never submits the message')
    nodes(render())
      .find((node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Send')
      .props.onPress()
    await settle()
    assert.equal(sent[0], 'Review this file')
    assert.equal(sent[3][0].path, 'new.ts')
    assert.equal(requests[1].scope, 'worktree:other')
    hooks.dispose()
  })
}

test('workspace catalogs discard late hosts, explain unsupported methods and clear disconnected scope', async () => {
  const { isMethodMissing } = await import('../src/runtime/goalVerify.ts')
  const hooks = hookHarness()
  const requests = [],
    listeners = new Map()
  let online = true
  const store = {
    isOnline: () => online,
    invoke: (host, method) => {
      const request = { host, method, ...deferred() }
      requests.push(request)
      return request.promise
    },
    subscribe: (host, listener) => {
      listeners.set(host, listener)
      return () => listeners.delete(host)
    },
  }
  const { useWorkspaces } = load('runtime/useWorkspaces.ts', 'ios', {
    react: hooks.react,
    './store': { useStore: () => store },
    './goalVerify': { isMethodMissing },
  })
  let host = 'a'
  const render = () => hooks.render(() => useWorkspaces(host))
  render()
  host = 'b'
  render()
  requests[0].resolve([{ id: 'w', projectId: 'p', name: 'Wrong host' }])
  await settle()
  assert.equal(render().rows.length, 0)
  requests[1].reject(Error('Unknown method workspaces.list'))
  await settle()
  assert.equal(render().unsupported, true)
  render().refresh()
  render()
  requests[2].resolve([{ id: 'w', projectId: 'p', name: 'Correct host' }])
  await settle()
  assert.equal(render().rows[0].name, 'Correct host')
  assert.equal(listeners.has('a'), false)
  listeners.get('b')('workspace:changed')
  render()
  online = false
  render()
  requests.at(-1).resolve([{ id: 'w', name: 'Late data' }])
  await settle()
  assert.equal(render().rows.length, 0)
  assert.equal(listeners.size, 0)
  assert.ok(requests.every((request) => request.method === 'workspaces.list'))
  hooks.dispose()
})

for (const os of ['ios', 'android']) {
  test(`${os} title actions expose host pending/failure state and send an explicit retry once`, async () => {
    const hooks = hookHarness()
    const calls = []
    const request = deferred()
    let online = true
    const store = {
      isOnline: () => online,
      invoke: (...args) => {
        calls.push(args)
        return request.promise
      },
      refresh: async () => {},
    }
    const labels = {
      namingThread: 'Naming thread',
      retryTitleGeneration: 'Retry title generation',
      renameWithAI: 'Rename with AI',
    }
    const { ChatActionsSheet } = load('components/ChatActions.tsx', os, {
      react: hooks.react,
      '../runtime/store': { useStore: () => store },
      '../i18n': { useT: () => labels },
    })
    let chat = {
      id: 'remote:task',
      computerId: 'remote',
      taskId: 'task',
      title: 'My chosen title',
      pinnedAt: null,
      status: 'idle',
      mode: 'current',
      settings: { provider: 'codex', model: 'chosen' },
      titleGenerationState: 'pending',
    }
    const render = () => hooks.render(() => ChatActionsSheet({ chat, open: true, onClose() {} }))
    const action = (tree, label) =>
      nodes(tree).find((node) => node.type === 'Row' && nodes(node).some((child) => child.props?.children === label))
    let row = action(render(), labels.namingThread)
    assert.equal(row.props.onPress, undefined)
    assert.equal(row.props.accessibilityState.busy, true)
    chat = { ...chat, titleGenerationState: 'failed' }
    row = action(render(), labels.retryTitleGeneration)
    assert.equal(row.props.accessibilityState.disabled, false)
    row.props.onPress()
    row.props.onPress()
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], 'remote')
    assert.equal(calls[0][1], 'tasks.generateTitle')
    assert.equal(calls[0][2], 'task')
    assert.equal(calls[0][4], true)
    request.resolve({ title: 'New title' })
    await settle()
    online = false
    row = action(render(), labels.retryTitleGeneration)
    assert.equal(row.props.onPress, undefined)
    assert.equal(row.props.accessibilityState.disabled, true)
    assert.equal(find(render(), 'Sheet').props.title, 'My chosen title')
    hooks.dispose()
  })
}

for (const os of ['ios', 'android']) {
  test(`${os} file previews append to the source thread draft once and never start or submit work`, async () => {
    const hooks = hookHarness()
    const calls = [],
      destinations = []
    const store = {
      computers: [{ id: 'remote', status: 'online', name: 'Server' }],
      projects: [{ id: 'remote:p', computerId: 'remote' }],
      chats: [{ id: 'remote:chat', computerId: 'remote', taskId: 'task', projectId: 'remote:p' }],
      drafts: { 'remote:chat:task': '> Keep quote\n\nReview this', 'remote:chat:task:attachments': '[{"id":"image"}]' },
      isOnline: () => true,
      invoke: async (...args) => {
        calls.push(args)
        if (args[1] === 'files.explorerBindings') return [{ repoId: 'r', repoName: 'Repo', setupState: 'ready' }]
        if (args[1] === 'files.read') return { content: '# Read me' }
        throw Error(`Unexpected ${args[1]}`)
      },
      addExplorerFile(input) {
        const next = explorerDrafts.addExplorerFile(store, input)
        store.drafts = next.drafts
        return next.destination
      },
    }
    const labels = { addToMessage: 'Add to message', showInExplorer: 'Show in Explorer' }
    const { FileViewer } = load('components/FileViewer.tsx', os, {
      react: hooks.react,
      'expo-router': {
        useRouter: () => ({ dismissTo: (to) => destinations.push(to), push: (to) => destinations.push(to) }),
      },
      '../runtime/store': { useStore: () => store },
      '../i18n': { useT: () => labels },
      '../runtime/useWorkspaces': { useWorkspaces: () => ({ rows: [] }) },
      '../components/Code': { highlightLines: () => null, grammarFor: () => '' },
    })
    const render = () =>
      hooks.render(() => FileViewer({ computerId: 'remote', contextId: 'task', repoId: 'r', path: 'README.md' }))
    render()
    await settle()
    render()
    await settle()
    const button = nodes(render()).find((node) => node.type === 'Button' && node.props.title === labels.addToMessage)
    assert.equal(button.props.disabled, false)
    button.props.onPress()
    button.props.onPress()
    assert.equal(store.drafts['remote:chat:task'], '> Keep quote\n\nReview this')
    assert.equal(store.drafts['remote:chat:task:attachments'], '[{"id":"image"}]')
    assert.deepEqual(JSON.parse(store.drafts['remote:chat:task:context']), [
      { repoId: 'r', path: 'README.md', source: 'mention', referenceOnly: true },
    ])
    assert.deepEqual(JSON.parse(JSON.stringify(destinations)), [
      { pathname: '/chat/[id]', params: { id: 'remote:chat' } },
    ])
    assert.deepEqual(
      calls.map((call) => call[1]),
      ['files.explorerBindings', 'files.read'],
    )
    hooks.dispose()
  })

  test(`${os} a Home file start preserves the ordinary draft and a failed save stays in the preview`, async () => {
    const hooks = hookHarness()
    const destinations = []
    let fail = true
    const store = {
      computers: [{ id: 'host', name: 'Laptop', status: 'online' }],
      projects: [{ id: 'host:p', computerId: 'host' }],
      chats: [],
      drafts: { 'host:new:host:p': 'Urgent unrelated draft' },
      isOnline: () => true,
      invoke: async (_host, method) =>
        method === 'files.explorerBindings'
          ? [{ repoId: 'r', repoName: 'Repo', setupState: 'ready' }]
          : { content: 'Contents' },
      addExplorerFile(input) {
        if (fail) throw Error('Storage full')
        const next = explorerDrafts.addExplorerFile(store, input)
        store.drafts = next.drafts
        return next.destination
      },
    }
    const labels = {
      newThreadWithFile: 'New thread with file',
      fileDraftFailed: 'Could not add; draft kept',
      showInExplorer: 'Show in Explorer',
    }
    const { FileViewer } = load('components/FileViewer.tsx', os, {
      react: hooks.react,
      'expo-router': {
        useRouter: () => ({
          push: (to) => destinations.push({ kind: 'push', to }),
          dismissTo: (to) => destinations.push({ kind: 'dismiss', to }),
        }),
      },
      '../runtime/store': { useStore: () => store },
      '../i18n': { useT: () => labels },
      '../runtime/useWorkspaces': {
        useWorkspaces: () => ({ host: 'host', rows: [{ id: 'w', projectId: 'p', name: 'Feature' }] }),
      },
      '../components/Code': { highlightLines: () => null, grammarFor: () => '' },
    })
    const render = () =>
      hooks.render(() => FileViewer({ computerId: 'host', contextId: 'worktree:w', repoId: 'r', path: 'README.md' }))
    render()
    await settle()
    render()
    await settle()
    const action = () =>
      nodes(render()).find((node) => node.type === 'Button' && node.props.title === labels.newThreadWithFile)
    action().props.onPress()
    assert.equal(destinations.length, 0)
    assert.equal(store.drafts['host:new:host:p'], 'Urgent unrelated draft')
    assert.ok(nodes(render()).some((node) => node.props?.children === labels.fileDraftFailed))
    fail = false
    action().props.onPress()
    assert.equal(destinations[0].kind, 'push', 'a Home start never reuses a differently scoped mounted New screen')
    assert.deepEqual(JSON.parse(JSON.stringify(destinations[0].to)), {
      pathname: '/new',
      params: { computer: 'host', project: 'host:p', draftContext: 'worktree:w' },
    })
    const key = explorerDrafts.newComposerKey('host', 'host:p', 'worktree:w')
    assert.equal(JSON.parse(store.drafts[`${key}:workspace`]).workspaceId, 'w')
    assert.equal(store.drafts['host:new:host:p'], 'Urgent unrelated draft')
    hooks.dispose()
  })
}

test('file previews discard late host reads and an absent standalone binding never allocates a folder', async () => {
  const hooks = hookHarness()
  const reads = []
  const pending = deferred()
  const store = {
    computers: [
      { id: 'a', status: 'online' },
      { id: 'b', status: 'online' },
    ],
    chats: [],
    projects: [],
    isOnline: () => true,
    invoke: async (host, method) => {
      reads.push([host, method])
      if (host === 'a') return pending.promise
      return []
    },
  }
  const { FileViewer } = load('components/FileViewer.tsx', 'ios', {
    react: hooks.react,
    '../runtime/store': { useStore: () => store },
    '../i18n': { useT: () => ({ fileScopeUnavailable: 'Scope unavailable' }) },
    '../runtime/useWorkspaces': { useWorkspaces: () => ({ rows: [] }) },
    '../components/Code': { highlightLines: () => null, grammarFor: () => '' },
  })
  let props = { computerId: 'a', contextId: 'unstarted', repoId: 'r', path: 'README.md' }
  const render = () => hooks.render(() => FileViewer(props))
  render()
  props = { ...props, computerId: 'b' }
  render()
  await settle()
  pending.resolve([{ repoId: 'r', setupState: 'ready' }])
  await settle()
  const tree = render()
  assert.deepEqual(reads, [
    ['a', 'files.explorerBindings'],
    ['b', 'files.explorerBindings'],
  ])
  assert.ok(nodes(tree).some((node) => node.props?.children === 'Scope unavailable'))
  assert.equal(nodes(tree).find((node) => node.type === 'Button').props.disabled, true)
  hooks.dispose()
})

for (const os of ['ios', 'android']) {
  test(`${os} Show in Explorer expands only the selected repository, scrolls to the file and respects Collapse`, async () => {
    const hooks = hookHarness()
    const calls = [],
      navigations = [],
      scrolls = [],
      frames = new Map()
    let frameId = 0
    let params = { computer: 'a', ctx: 'project:p', repoId: 'r2', path: 'src/deep/README.md', revealId: 'one' }
    const directories = {
      '': [{ name: 'src', path: 'src', kind: 'dir' }],
      src: [{ name: 'deep', path: 'src/deep', kind: 'dir' }],
      'src/deep': [{ name: 'README.md', path: 'src/deep/README.md', kind: 'file' }],
    }
    const store = {
      projects: [],
      computers: [
        { id: 'a', name: 'Laptop' },
        { id: 'b', name: 'Server' },
      ],
      isOnline: () => true,
      subscribe: () => () => {},
      invoke: async (host, method, context, repoId, path) => {
        calls.push([host, method, context, repoId, path])
        if (method === 'files.explorerBindings')
          return [
            { repoId: 'r1', repoName: 'First', cwd: '/first', setupState: 'ready' },
            { repoId: 'r2', repoName: 'Second', cwd: '/second', setupState: 'ready' },
          ]
        if (method === 'files.browse')
          return {
            entries: repoId === 'r1' ? [{ name: 'README.md', path: 'README.md', kind: 'file' }] : directories[path],
            truncated: false,
          }
        throw Error(`Unexpected ${method}`)
      },
    }
    const { default: Explorer } = load(
      'app/explorer.tsx',
      os,
      {
        react: hooks.react,
        'expo-router': {
          useLocalSearchParams: () => params,
          useRouter: () => ({ push: (to) => navigations.push(to) }),
          useFocusEffect() {},
        },
        '@ramu/shared/workspace/explorer': explorerScopes,
        '../runtime/useWorkspaces': { useWorkspaces: () => ({ rows: [] }) },
        '../runtime/store': { useStore: () => store },
        '../i18n': { useT: () => ({ collapseFolders: 'Collapse', refreshFiles: 'Refresh' }) },
      },
      {
        requestAnimationFrame: (callback) => {
          frames.set(++frameId, callback)
          return frameId
        },
        cancelAnimationFrame: (id) => frames.delete(id),
      },
    )
    const render = () => hooks.render(() => Explorer())
    const initial = find(render(), 'PageFlatList')
    initial.props.ref.current = { scrollToIndex: (value) => scrolls.push(value), scrollToOffset() {} }
    await settle()
    render()
    await settle()
    let tree
    for (let attempt = 0; attempt < 5; attempt++) {
      await settle()
      tree = render()
      if (!nodes(tree).some((node) => node.type === 'ActivityIndicator')) break
    }
    assert.equal(
      nodes(tree).some((node) => node.type === 'ActivityIndicator'),
      false,
    )
    const list = find(tree, 'PageFlatList')
    assert.deepEqual(
      list.props.data.map((row) => [row.repoId, row.entry.path]),
      [
        ['r1', 'README.md'],
        ['r2', 'src'],
        ['r2', 'src/deep'],
        ['r2', 'src/deep/README.md'],
      ],
    )
    const targetRow = list.props.renderItem({ item: list.props.data[3] })
    assert.equal(targetRow.props.accessibilityState.selected, true)
    assert.equal(list.props.renderItem({ item: list.props.data[0] }).props.accessibilityState.selected, false)
    for (const callback of frames.values()) callback()
    frames.clear()
    assert.equal(scrolls.at(-1).index, 3)
    nodes(find(tree, 'Header').props.right)
      .find((node) => node.type === 'HeaderButton' && node.props.label === 'Collapse')
      .props.onPress()
    assert.equal(find(render(), 'PageFlatList').props.data.length, 2)
    nodes(find(render(), 'Header').props.right)
      .find((node) => node.type === 'HeaderButton' && node.props.label === 'Refresh')
      .props.onPress()
    render()
    await settle()
    render()
    await settle()
    assert.equal(find(render(), 'PageFlatList').props.data.length, 2, 'a refresh cannot undo an explicit Collapse')
    // A stale row from another host cannot open or expand anything in the newly selected scope.
    params = { ...params, computer: 'b', revealId: 'two' }
    render()
    targetRow.props.onPress()
    assert.equal(navigations.length, 0)
    await settle()
    render()
    await settle()
    assert.ok(calls.some(([host]) => host === 'b'))
    assert.ok(calls.every(([, method]) => method.startsWith('files.')))
    hooks.dispose()
  })
}

test('returning from Explorer updates only the mounted composer’s context and a late Send keeps newer work', async () => {
  const hooks = hookHarness()
  const request = deferred()
  let focus,
    sent = 0
  const store = {
    selected: 'a',
    computers: [{ id: 'a', status: 'online' }],
    projects: [{ id: 'a:p', computerId: 'a' }],
    chats: [{ id: 'a:chat', taskId: 'task', computerId: 'a', projectId: 'a:p' }],
    missingMethods: {},
    appPreferences: {},
    drafts: { 'a:chat:task': 'Keep my original request', 'a:chat:task:attachments': '[{"id":"image","name":"Photo"}]' },
    isOnline: () => true,
    setDraft: (key, value) => {
      store.drafts[key] = value
    },
    clearComposerDraft: (key, expected) => {
      const next = explorerDrafts.consumeComposerDraft(store.drafts, key, expected)
      if (!next) return false
      store.drafts = next
      return true
    },
  }
  const { Composer } = load('components/Composer.tsx', 'ios', {
    react: hooks.react,
    'expo-router': {
      useFocusEffect: (callback) => {
        focus = callback
      },
    },
    './ui': new Proxy({}, { get: (_, key) => (key === 'tap' ? () => {} : String(key)) }),
    '@ramu/shared/chat/composerDraft': {
      composerDraft: (text) => ({ chips: [], segments: [{ kind: 'text', source: text }] }),
    },
    '../runtime/store': { useStore: () => store },
    '../i18n': { useT: () => ({}) },
    '../runtime/goalVerify': { offersVerify: () => false },
    './ComposerSuggest': { useComposerSuggest: () => ({ visible: false }) },
  })
  const props = {
    computerId: 'a',
    taskId: 'task',
    draftKey: 'a:chat:task',
    running: false,
    model: { provider: 'claude-code', model: 'opus' },
    onModel() {},
    onSend: async () => {
      sent++
      await request.promise
    },
  }
  const render = () => hooks.render(() => Composer(props))
  render()
  // The file viewer remains above this mounted screen; its addition updates the same device store.
  store.drafts = explorerDrafts.addExplorerFile(store, {
    computerId: 'a',
    contextId: 'task',
    repoId: 'r',
    path: 'first.ts',
  }).drafts
  render()
  focus()
  let tree = render()
  assert.equal(JSON.parse(store.drafts['a:chat:task:context'])[0].path, 'first.ts')
  assert.equal(store.drafts['a:chat:task'], 'Keep my original request')
  assert.equal(JSON.parse(store.drafts['a:chat:task:attachments'])[0].id, 'image')
  nodes(tree)
    .find((node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Send')
    .props.onPress()
  store.drafts = explorerDrafts.addExplorerFile(store, {
    computerId: 'a',
    contextId: 'task',
    repoId: 'r',
    path: 'later.ts',
  }).drafts
  request.resolve()
  await settle()
  render()
  focus()
  render()
  assert.equal(sent, 1)
  assert.equal(store.drafts['a:chat:task'], 'Keep my original request')
  assert.equal(JSON.parse(store.drafts['a:chat:task:context']).length, 2)
  assert.equal(JSON.parse(store.drafts['a:chat:task:attachments'])[0].id, 'image')
  hooks.dispose()
})

for (const [initial, path] of [
  ['all', 'README.md'],
  ['file', 'image.png'],
]) {
  test(`file-to-draft retains the preview’s ${initial === 'all' ? 'combined diff' : 'image reference'} semantics`, async () => {
    const hooks = hookHarness()
    const calls = []
    const store = {
      computers: [{ id: 'a', status: 'online' }],
      projects: [{ id: 'a:p', computerId: 'a' }],
      chats: [{ id: 'a:chat', taskId: 'task', computerId: 'a', projectId: 'a:p' }],
      drafts: {},
      isOnline: () => true,
      invoke: async (...args) => {
        calls.push(args)
        if (args[1] === 'files.explorerBindings') return [{ repoId: 'r', setupState: 'ready', repoName: 'Repo' }]
        if (args[1] === 'git.diff') return { original: 'Before', modified: 'After' }
        if (args[1] === 'files.media') return { url: 'data:image/png;base64,AA==' }
        throw Error(`Unexpected ${args[1]}`)
      },
      addExplorerFile(input) {
        const next = explorerDrafts.addExplorerFile(store, input)
        store.drafts = next.drafts
        return next.destination
      },
    }
    const { FileViewer } = load('components/FileViewer.tsx', 'ios', {
      react: hooks.react,
      'expo-router': { useRouter: () => ({ dismissTo() {} }) },
      '../runtime/store': { useStore: () => store },
      '../i18n': { useT: () => ({ addToMessage: 'Add', addImageReference: 'Add image' }) },
      '../runtime/useWorkspaces': { useWorkspaces: () => ({ host: 'a', rows: [] }) },
      '../components/Code': { highlightLines: () => null, grammarFor: () => '' },
      '../runtime/diff': { changedFile: () => ({ path, hunks: [] }) },
    })
    const render = () =>
      hooks.render(() => FileViewer({ computerId: 'a', contextId: 'task', repoId: 'r', path, initial }))
    render()
    await settle()
    render()
    await settle()
    const action = nodes(render()).find((node) => node.type === 'Button')
    assert.equal(action.props.disabled, false)
    action.props.onPress()
    const context = JSON.parse(store.drafts['a:chat:task:context'])[0]
    if (initial === 'all') {
      assert.equal(calls.find((call) => call[1] === 'git.diff').at(-1), 'all')
      assert.equal(context.diff.staged, 'all')
    } else {
      assert.equal(context.source, 'tab')
      assert.equal(context.referenceOnly, true)
      assert.equal(JSON.stringify(store.drafts).includes('data:image'), false)
    }
    hooks.dispose()
  })
}

test('a file browsed from New returns to its original composer and keeps its workspace provenance', async () => {
  const hooks = hookHarness()
  const destinations = []
  const store = {
    computers: [{ id: 'a', status: 'online' }],
    projects: [{ id: 'a:p', computerId: 'a' }],
    chats: [],
    drafts: { 'a:new:a:p': '> Preserve quote\n\nExisting work', 'a:new:a:p:workspace': '{"version":1,"mode":null}' },
    isOnline: () => true,
    invoke: async (_host, method) =>
      method === 'files.explorerBindings' ? [{ repoId: 'r', setupState: 'ready' }] : { content: 'Readme' },
    addExplorerFile(input) {
      const next = explorerDrafts.addExplorerFile(store, input)
      store.drafts = next.drafts
      return next.destination
    },
  }
  const { FileViewer } = load('components/FileViewer.tsx', 'android', {
    react: hooks.react,
    'expo-router': {
      useRouter: () => ({
        dismissTo: (to) => destinations.push(to),
        push: () => {
          throw Error('must return to the existing New composer')
        },
      }),
    },
    '../runtime/store': { useStore: () => store },
    '../i18n': { useT: () => ({ addToMessage: 'Add to message' }) },
    '../runtime/useWorkspaces': { useWorkspaces: () => ({ host: 'a', rows: [] }) },
    '../components/Code': { highlightLines: () => null, grammarFor: () => '' },
  })
  const render = () =>
    hooks.render(() =>
      FileViewer({
        computerId: 'a',
        contextId: 'project:p',
        repoId: 'r',
        path: 'README.md',
        composer: { projectId: 'a:p' },
      }),
    )
  render()
  await settle()
  render()
  await settle()
  nodes(render())
    .find((node) => node.type === 'Button')
    .props.onPress()
  assert.deepEqual(JSON.parse(JSON.stringify(destinations)), [
    { pathname: '/new', params: { computer: 'a', project: 'a:p' } },
  ])
  assert.equal(store.drafts['a:new:a:p'], '> Preserve quote\n\nExisting work')
  assert.equal(store.drafts['a:new:a:p:workspace'], '{"version":1,"mode":null}')
  assert.equal(JSON.parse(store.drafts['a:new:a:p:context'])[0].path, 'README.md')
  hooks.dispose()
})

test('a combined mention/context budget failure leaves every reference editable instead of dropping files', async () => {
  const hooks = hookHarness()
  const alerts = []
  let sends = 0
  const contexts = Array.from({ length: 30 }, (_, i) => ({ repoId: 'r', path: `${i}.ts`, source: 'mention' }))
  const store = {
    selected: 'a',
    chats: [],
    missingMethods: {},
    appPreferences: {},
    drafts: {
      draft: '@extra Review files',
      'draft:context': JSON.stringify(contexts),
      'draft:mentions': JSON.stringify([
        { file: { repoId: 'r', path: 'extra.ts' }, insertion: '@extra ', token: '@extra ' },
      ]),
    },
    setDraft: (key, value) => {
      store.drafts[key] = value
    },
  }
  const { Composer } = load('components/Composer.tsx', 'ios', {
    react: hooks.react,
    'react-native': { Alert: { alert: (...args) => alerts.push(args) } },
    './ui': new Proxy({}, { get: (_, key) => (key === 'tap' ? () => {} : String(key)) }),
    '@ramu/shared/chat/composerDraft': {
      composerDraft: (text) => ({ chips: [], segments: [{ kind: 'text', source: text }] }),
    },
    '../runtime/store': { useStore: () => store },
    '../i18n': { useT: () => ({ fileReferenceLimit: 'Remove a reference before sending' }) },
    '../runtime/goalVerify': { offersVerify: () => false },
    './ComposerSuggest': { useComposerSuggest: () => ({ visible: false }) },
  })
  const render = () =>
    hooks.render(() =>
      Composer({
        computerId: 'a',
        draftKey: 'draft',
        running: false,
        model: { provider: 'claude-code', model: 'opus' },
        onModel() {},
        onSend: async () => {
          sends++
        },
      }),
    )
  render()
  nodes(render())
    .find((node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Send')
    .props.onPress()
  await settle()
  assert.equal(sends, 0)
  assert.equal(alerts[0][1], 'Remove a reference before sending')
  assert.equal(JSON.parse(store.drafts['draft:context']).length, 30)
  assert.equal(store.drafts.draft, '@extra Review files')
  hooks.dispose()
})

for (const scenario of ['unsupported', 'folder', 'line']) {
  test(`file preview handles ${scenario} without an unsafe fallback or a misleading Git action`, async () => {
    const hooks = hookHarness()
    const calls = [],
      timers = new Map()
    let timerId = 0
    const { isMethodMissing } = await import('../src/runtime/goalVerify.ts')
    const store = {
      computers: [{ id: 'a', status: 'online' }],
      projects: [{ id: 'a:p', computerId: 'a' }],
      chats: [],
      isOnline: () => true,
      invoke: async (...args) => {
        calls.push(args)
        if (scenario === 'unsupported') throw Error('Unknown method files.explorerBindings')
        if (args[1] === 'files.explorerBindings')
          return [{ repoId: 'r', setupState: 'ready', folderOnly: scenario === 'folder' }]
        return { content: '# Title\nSecond line' }
      },
    }
    const { FileViewer } = load(
      'components/FileViewer.tsx',
      'android',
      {
        react: hooks.react,
        '../runtime/store': { useStore: () => store },
        '../i18n': { useT: () => ({ fileScopeUnsupported: 'Update the host', fileNoGit: 'No Git in this folder' }) },
        '../runtime/goalVerify': { isMethodMissing },
        '../runtime/useWorkspaces': { useWorkspaces: () => ({ host: 'a', rows: [] }) },
        '../components/Code': { highlightLines: () => null, grammarFor: () => '' },
      },
      {
        setTimeout: (callback) => {
          timers.set(++timerId, callback)
          return timerId
        },
        clearTimeout: (id) => timers.delete(id),
      },
    )
    const render = () =>
      hooks.render(() =>
        FileViewer({
          computerId: 'a',
          contextId: 'project:p',
          repoId: 'r',
          path: 'README.md',
          ...(scenario === 'folder' ? { initial: 'all' } : scenario === 'line' ? { line: '2' } : {}),
        }),
      )
    render()
    await settle()
    render()
    await settle()
    const tree = render()
    if (scenario === 'unsupported') {
      assert.equal(calls.length, 1)
      assert.ok(nodes(tree).some((node) => node.props?.children === 'Update the host'))
    } else if (scenario === 'folder') {
      assert.ok(calls.every((call) => call[1] !== 'git.diff'))
      assert.ok(nodes(tree).some((node) => node.props?.children === 'No Git in this folder'))
      assert.equal(find(tree, 'Segmented').props.options.length, 1)
    } else {
      const list = find(tree, 'PageFlatList')
      assert.ok(list, 'a Markdown line link opens source so the requested line is visible')
      const scrolls = []
      list.props.ref.current = { scrollToIndex: (value) => scrolls.push(value) }
      for (const callback of timers.values()) callback()
      assert.equal(scrolls[0].index, 1)
    }
    hooks.dispose()
  })
}

test('a later line link to an already-open Markdown preview switches to source and scrolls without refetching', async () => {
  const hooks = hookHarness()
  const timers = new Map(),
    calls = [],
    scrolls = []
  let timerId = 0
  const store = {
    computers: [{ id: 'a', status: 'online' }],
    projects: [],
    chats: [],
    isOnline: () => true,
    invoke: async (_host, method) => {
      calls.push(method)
      return method === 'files.explorerBindings'
        ? [{ repoId: 'r', setupState: 'ready' }]
        : { content: '# Title\nSecond line' }
    },
  }
  const { FileViewer } = load(
    'components/FileViewer.tsx',
    'ios',
    {
      react: hooks.react,
      '../runtime/store': { useStore: () => store },
      '../i18n': { useT: () => ({}) },
      '../runtime/useWorkspaces': { useWorkspaces: () => ({ host: 'a', rows: [] }) },
      '../components/Code': { highlightLines: () => null, grammarFor: () => '' },
    },
    {
      setTimeout: (callback) => {
        timers.set(++timerId, callback)
        return timerId
      },
      clearTimeout: (id) => timers.delete(id),
    },
  )
  let line
  const render = () =>
    hooks.render(() => FileViewer({ computerId: 'a', contextId: 'task', repoId: 'r', path: 'README.md', line }))
  render()
  await settle()
  render()
  await settle()
  assert.equal(find(render(), 'PageFlatList'), undefined)
  line = '2'
  render()
  const list = find(render(), 'PageFlatList')
  list.props.ref.current = { scrollToIndex: (value) => scrolls.push(value) }
  for (const callback of timers.values()) callback()
  assert.equal(scrolls[0].index, 1)
  assert.deepEqual(calls, ['files.explorerBindings', 'files.read'])
  hooks.dispose()
})

for (const scenario of ['offline', 'missing', 'old-host', 'available', 'changed-owner']) {
  test(`restored attachments ${scenario} are checked on their owning host before any message delivery`, async () => {
    const hooks = hookHarness()
    const request = deferred(),
      calls = [],
      alerts = [],
      sent = []
    const key = 'a:chat:task'
    const store = {
      selected: 'a',
      chats: [],
      missingMethods: {},
      appPreferences: {},
      drafts: {
        [key]: 'Review the image',
        [`${key}:restored-attachments`]: 'yes',
        [`${key}:attachments`]: JSON.stringify([
          { id: 'image', name: 'shot.png', path: '/host/image', size: 4, mimeType: 'image/png' },
        ]),
      },
      setDraft: (key, value) => {
        store.drafts[key] = value
      },
      clearComposerDraft: () => true,
      isOnline: () => scenario !== 'offline',
      invoke: async (...args) => {
        calls.push(args)
        if (scenario === 'old-host') throw new Error('Unknown method attachments.status')
        if (scenario === 'changed-owner') return request.promise
        return [{ id: 'image', available: scenario === 'available' }]
      },
    }
    const { Composer } = load('components/Composer.tsx', 'ios', {
      react: hooks.react,
      './ui': new Proxy({}, { get: (_, key) => (key === 'tap' ? () => {} : String(key)) }),
      '@ramu/shared/chat/composerDraft': {
        composerDraft: (text) => ({ chips: [], segments: [{ kind: 'text', source: text }] }),
      },
      'react-native': { Alert: { alert: (...args) => alerts.push(args) } },
      '../runtime/store': { useStore: () => store },
      '../runtime/goalVerify': {
        offersVerify: () => false,
        isMethodMissing: (error) => error.message.includes('Unknown method'),
      },
      '../i18n': { useT: () => new Proxy({}, { get: (_, key) => String(key) }) },
      '../runtime/limitTray': { describeLimitTray: () => ({}), hostHasAutoResume: () => false },
      '../runtime/threadActivity': { needsGoalTray: () => false },
      './ComposerSuggest': { useComposerSuggest: () => ({ visible: false }) },
    })
    let props = {
      computerId: 'a',
      taskId: 'task',
      draftKey: key,
      running: false,
      model: { provider: 'codex', model: '' },
      onModel() {},
      onSend: async (...args) => sent.push(args),
    }
    const render = () => hooks.render(() => Composer(props))
    let tree = render()
    nodes(tree)
      .find((node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Send')
      .props.onPress()
    if (scenario === 'changed-owner') {
      store.drafts['b:chat:task'] = 'New host request'
      props = { ...props, computerId: 'b', draftKey: 'b:chat:task' }
      render()
      render()
      request.resolve([{ id: 'image', available: true }])
    }
    await settle()
    render()
    assert.equal(sent.length, scenario === 'available' ? 1 : 0)
    if (scenario === 'offline') assert.equal(calls.length, 0)
    else assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ['a', 'attachments.status', ['image']])
    if (scenario === 'missing') assert.equal(alerts.at(-1)[1], 'savedAttachmentMissing')
    if (scenario === 'old-host') assert.equal(alerts.at(-1)[1], 'savedAttachmentOldHost')
    if (scenario === 'offline') assert.equal(alerts.at(-1)[1], 'savedAttachmentOffline')
    if (scenario === 'changed-owner') assert.equal(store.drafts['b:chat:task'], 'New host request')
    if (scenario !== 'available') assert.equal(store.drafts[key], 'Review the image')
    hooks.dispose()
  })
}

for (const os of ['ios', 'android']) {
  test(`${os} native profile migration and Forget remove legacy and recovery copies only after committing`, () => {
    const files = new Map()
    class File {
      constructor(...parts) {
        this.path = parts.join('/')
      }
      get exists() {
        return files.has(this.path)
      }
      textSync() {
        if (!this.exists) throw new Error('missing')
        return files.get(this.path)
      }
      write(text) {
        files.set(this.path, text)
      }
      delete() {
        files.delete(this.path)
      }
    }
    const previous = { drafts: { 'a:new:p': 'Original draft' }, computers: [{ id: 'a' }] }
    files.set('document/ramu.mobile.v1.json', JSON.stringify(previous))
    // Interrupted first migration leaves its original legacy source intact.
    files.set('document/ramu.mobile.v1.0.json', '{interrupted')
    const storage = load('storage/index.ts', os, {
      'expo-file-system': { File, Paths: { document: 'document' } },
      './localCommit': localCommitStorage,
    })
    assert.deepEqual(JSON.parse(JSON.stringify(storage.readLocal({}))), previous)
    storage.writeLocal(previous)
    assert.equal(files.has('document/ramu.mobile.v1.json'), false)
    const saved = { ...previous, drafts: { ...previous.drafts, 'a:saved-messages': 'Saved library' } }
    storage.writeLocal(saved)
    assert.deepEqual(JSON.parse(JSON.stringify(storage.readLocal({}))), saved)
    storage.writeLocal({ computers: [], drafts: {} }, { replaceBackups: true })
    assert.deepEqual(JSON.parse(JSON.stringify(storage.readLocal({}))), { computers: [], drafts: {} })
    for (const raw of files.values()) assert.ok(!raw.includes('Original draft') && !raw.includes('Saved library'))
  })
}

for (const os of ['ios', 'android']) {
  test(`${os} new-thread repository defaults refresh without replacing explicit choices or accepting stale responses`, async () => {
    const hooks = hookHarness()
    const requests = []
    const listeners = new Map()
    let submitted
    const store = {
      selected: 'a',
      computers: [{ id: 'a', name: 'Laptop', status: 'online' }],
      projects: ['p', 'q'].map((id) => ({ id: `a:${id}`, computerId: 'a', name: id, kind: 'repo' })),
      drafts: { 'a:new:a:p': 'Keep my request' },
      defaults: {},
      appPreferences: { a: { defaultCheckoutMode: 'current' } },
      isOnline: () => true,
      setDraft: (key, value) => {
        store.drafts[key] = value
      },
      invoke: (host, method, project) => {
        const request = deferred()
        requests.push({ host, method, project, ...request })
        return request.promise
      },
      subscribe: (host, listener) => {
        listeners.set(host, listener)
        return () => {
          listeners.delete(host)
        }
      },
      createChat: async (input) => {
        submitted = input
        return 'a:new'
      },
    }
    const { default: NewChat } = load('app/new.tsx', os, {
      react: hooks.react,
      'expo-router': {
        useRouter: () => ({ replace() {} }),
        useLocalSearchParams: () => ({ project: 'a:p' }),
      },
      '@ramu/shared/workspaceDefaults': workspaceDefaults,
      '@ramu/shared/workspace/explorer': explorerScopes,
      '../runtime/workspaces': workspaceChoices,
      '../runtime/useWorkspaces': { useWorkspaces: () => ({ rows: [] }) },
      '../runtime/store': { useStore: () => store },
      '../runtime/types': { STANDALONE: 'no-project' },
      '../i18n': { useT: () => ({ newChat: 'New thread' }) },
      '../components/Keyboard': { useKeyboardInset: () => 0 },
    })
    const render = () => hooks.render(() => NewChat())
    render()
    assert.equal(requests.length, 1)
    listeners.get('a')('workspace:changed', {})
    listeners.get('a')('settings:changed', {})
    const latest = {
      defaultCheckoutMode: 'worktree',
      branchPrefix: 'latest/',
      branchNaming: 'fixed',
      branchInstructions: '',
      worktreeUnavailable: null,
      configSource: 'ramu.json',
    }
    requests[2].resolve(latest)
    await settle()
    let tree = render()
    nodes(tree)
      .find((node) => node.key === 'current')
      .props.onPress()
    render()
    requests[0].resolve({ ...latest, branchPrefix: 'stale/' })
    requests[1].resolve({ ...latest, branchPrefix: 'also-stale/' })
    await settle()
    tree = render()
    await find(tree, 'Composer').props.onSend('Keep my request', 'send', [], [])
    assert.equal(submitted.mode, 'current')
    assert.equal(submitted.branchPrefix, 'latest/')
    assert.equal(store.drafts['a:new:a:p'], 'Keep my request')
    listeners.get('a')('workspace:changed', {})
    const oldRequest = requests.at(-1)
    nodes(tree)
      .find((node) => node.key === 'a:q')
      .props.onPress()
    render()
    const nextRequest = requests.at(-1)
    assert.equal(nextRequest.project, 'q')
    nextRequest.resolve({ ...latest, defaultCheckoutMode: 'current', branchPrefix: 'project-q/' })
    oldRequest.resolve({ ...latest, branchPrefix: 'late-project-p/' })
    await settle()
    tree = render()
    await find(tree, 'Composer').props.onSend('Project Q request', 'send', [], [])
    assert.equal(submitted.projectId, 'a:q')
    assert.equal(submitted.branchPrefix, 'project-q/')
    hooks.dispose()
    assert.equal(listeners.size, 0)
  })
}

for (const os of ['ios', 'android']) {
  test(`${os} workspace name editing preserves its original concurrency check and does not repeat a pending save`, async () => {
    const hooks = hookHarness()
    const requests = []
    let closed = 0
    const labels = {
      renameWorkspace: 'Rename workspace',
      workspaceName: 'Workspace name',
      workspaceNameHint: 'Shared label',
      workspaceRenameOutdated: 'Update host',
      workspaceRenameOffline: 'Connect host',
      workspaceRenameConflict: 'Name changed elsewhere',
      save: 'Save',
      cancel: 'Cancel',
    }
    const { WorkspaceNameSheet } = load('components/WorkspaceNameSheet.tsx', os, {
      react: hooks.react,
      '../i18n': { useT: () => labels },
      '../runtime/goalVerify': { isMethodMissing: (error) => /unknown method/i.test(String(error)) },
    })
    let online = true
    let workspace = { id: 'w', name: 'Original' }
    const onSave = (name, before) => {
      const request = deferred()
      requests.push({ name, before, ...request })
      return request.promise
    }
    const render = () =>
      hooks.render(() =>
        WorkspaceNameSheet({
          workspace,
          online,
          onSave,
          onClose: () => {
            closed++
          },
        }),
      )
    let tree = render()
    find(tree, 'TextInput').props.onChangeText('  Shared login  ')
    workspace = { id: 'w', name: 'Someone else changed it' }
    tree = render()
    const save = nodes(tree).find((node) => node.type === 'Button' && node.props.title === 'Save')
    save.props.onPress()
    save.props.onPress()
    assert.equal(requests.length, 1)
    assert.equal(requests[0].name, 'Shared login')
    assert.equal(requests[0].before, 'Original')
    find(render(), 'Sheet').props.onClose()
    assert.equal(closed, 0)
    requests[0].reject(new Error('Workspace name changed elsewhere. Reopen the name editor to review it.'))
    await settle()
    tree = render()
    assert.equal(find(tree, 'TextInput').props.value, '  Shared login  ')
    assert.ok(nodes(tree).some((node) => node.type === 'T' && node.props.children === 'Name changed elsewhere'))
    online = false
    tree = render()
    find(tree, 'TextInput').props.onSubmitEditing()
    assert.equal(requests.length, 1)
    assert.equal(find(tree, 'TextInput').props.editable, false)
    online = true
    tree = render()
    nodes(tree)
      .find((node) => node.type === 'Button' && node.props.title === 'Save')
      .props.onPress()
    requests[1].reject(new Error('Unknown method workspaces.rename'))
    await settle()
    tree = render()
    assert.ok(nodes(tree).some((node) => node.type === 'T' && node.props.children === 'Update host'))
    nodes(tree)
      .find((node) => node.type === 'Button' && node.props.title === 'Save')
      .props.onPress()
    hooks.dispose()
    requests[2].resolve()
    await settle()
    assert.equal(closed, 0, 'a late response cannot close a new scope’s editor')
  })

  test(`${os} workspace rename uses its owning host and preserves the new-thread draft through a host switch`, async () => {
    const hooks = hookHarness()
    const calls = []
    const rename = deferred()
    let refreshed = 0
    const store = {
      selected: 'a',
      computers: ['a', 'b'].map((id) => ({ id, name: id, status: 'online' })),
      projects: [{ id: 'a:p', computerId: 'a', name: 'Project', kind: 'repo' }],
      drafts: {
        'a:new:a:p': 'Keep my message',
        'a:new:a:p:workspace': JSON.stringify({ version: 1, mode: 'worktree', workspaceId: 'w', name: 'Original' }),
      },
      defaults: {},
      appPreferences: { a: { defaultCheckoutMode: 'current' } },
      isOnline: () => true,
      setDraft: (key, value) => {
        store.drafts[key] = value
      },
      subscribe: () => () => {},
      invoke: (host, method, ...args) => {
        calls.push({ host, method, args })
        return method === 'workspaces.rename'
          ? rename.promise
          : Promise.resolve({ defaultCheckoutMode: 'current', branchPrefix: 'ramu/', branchNaming: 'fixed' })
      },
      createChat: async () => {
        throw new Error('Rename must not create a thread')
      },
    }
    const catalog = {
      rows: [{ id: 'w', projectId: 'p', name: 'Original' }],
      refresh: () => {
        refreshed++
      },
    }
    const { default: NewChat } = load('app/new.tsx', os, {
      react: hooks.react,
      'expo-router': { useRouter: () => ({ replace() {} }), useLocalSearchParams: () => ({ project: 'a:p' }) },
      '@ramu/shared/workspaceDefaults': workspaceDefaults,
      '@ramu/shared/workspace/explorer': explorerScopes,
      '../runtime/workspaces': workspaceChoices,
      '../runtime/useWorkspaces': { useWorkspaces: () => catalog },
      '../runtime/store': { useStore: () => store },
      '../runtime/types': { STANDALONE: 'no-project' },
      '../i18n': { useT: () => ({ renameWorkspace: 'Rename workspace' }) },
      '../components/Keyboard': { useKeyboardInset: () => 0 },
    })
    const render = () => hooks.render(() => NewChat())
    let tree = render()
    nodes(tree)
      .find(
        (node) =>
          node.type === 'Row' &&
          nodes(node).some((child) => child.type === 'T' && child.props.children === 'Rename workspace'),
      )
      .props.onPress()
    tree = render()
    const sheet = find(tree, 'WorkspaceNameSheet')
    assert.equal(sheet.props.workspace.id, 'w')
    const saving = sheet.props.onSave('New label', 'Original')
    nodes(tree)
      .find((node) => node.key === 'b')
      .props.onPress()
    tree = render()
    assert.equal(find(tree, 'WorkspaceNameSheet'), undefined)
    rename.resolve({ id: 'w', name: 'New label' })
    await saving
    sheet.props.onClose()
    render()
    assert.deepEqual(
      calls.filter((call) => call.method === 'workspaces.rename'),
      [{ host: 'a', method: 'workspaces.rename', args: ['w', 'New label', 'Original'] }],
    )
    assert.equal(refreshed, 0, 'a late old-host response does not refresh a new-host catalog')
    assert.equal(store.drafts['a:new:a:p'], 'Keep my message')
    assert.equal(JSON.parse(store.drafts['a:new:a:p:workspace']).workspaceId, 'w')
    assert.ok(!calls.some((call) => /tasks\.(create|setup)|agent\.start/.test(call.method)))
    hooks.dispose()
  })
}

for (const os of ['ios', 'android']) {
  test(`${os} branch naming cancels abandoned requests and manual edits win late generation`, async () => {
    const hooks = hookHarness()
    const requests = []
    const store = {
      invoke(host, method, ...args) {
        const request = deferred()
        requests.push({ host, method, args, ...request })
        return method === 'tasks.cancelBranch' ? Promise.resolve() : request.promise
      },
    }
    const { BranchNameControls } = load('components/BranchNameControls.tsx', os, {
      react: hooks.react,
      '@ramu/shared/workspaceDefaults': workspaceDefaults,
      '../runtime/store': { useStore: () => store },
      '../runtime/goalVerify': { isMethodMissing: (error) => /unknown method/i.test(String(error)) },
      '../i18n': { useT: () => components },
    })
    let props = {
      host: 'a',
      projectId: 'p',
      title: 'Fix login',
      online: true,
      branchPrefix: 'team/',
      intent: { strategy: 'semantic', instructions: '', prompt: 'Fix login' },
      onChange: (choice) => {
        props = { ...props, choice }
      },
    }
    const render = () => hooks.render(() => BranchNameControls(props))
    const button = (tree, title) => nodes(tree).find((node) => node.type === 'Button' && node.props.title === title)
    let tree = render()
    button(tree, 'branchNameGenerate').props.onPress()
    button(tree, 'branchNameGenerate').props.onPress()
    assert.equal(requests.length, 1, 'two taps before rerender start one model operation')
    const original = requests[0]
    assert.match(original.args[3], /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    tree = render()
    find(tree, 'TextInput').props.onChangeText('mine/login')
    tree = render()
    original.resolve({ name: 'late/login', source: 'generated' })
    await settle()
    assert.equal(props.choice.name, 'mine/login')
    assert.equal(requests[1].method, 'tasks.cancelBranch')
    assert.equal(requests[1].host, 'a')
    assert.equal(requests[1].args[0], original.args[3])
    button(tree, 'branchNameGenerate').props.onPress()
    const abandoned = requests.at(-1)
    props = { ...props, host: 'b', projectId: 'q' }
    render()
    abandoned.resolve({ name: 'wrong/host', source: 'generated' })
    await settle()
    assert.equal(props.choice.name, 'mine/login')
    assert.equal(requests.at(-1).method, 'tasks.cancelBranch')
    assert.equal(requests.at(-1).host, 'a')
    tree = render()
    button(tree, 'branchNameGenerate').props.onPress()
    const dismissed = requests.at(-1)
    hooks.dispose()
    dismissed.resolve({ name: 'dismissed/name', source: 'generated' })
    await settle()
    assert.equal(props.choice.name, 'mine/login')
  })

  test(`${os} branch previews use frozen naming inputs, reject invalid edits and surface old-host failures`, async () => {
    const hooks = hookHarness()
    const requests = []
    const { BranchNameControls } = load('components/BranchNameControls.tsx', os, {
      react: hooks.react,
      '@ramu/shared/workspaceDefaults': workspaceDefaults,
      '../runtime/store': {
        useStore: () => ({
          invoke(host, method, ...args) {
            const request = deferred()
            requests.push({ host, method, args, ...request })
            return request.promise
          },
        }),
      },
      '../runtime/goalVerify': { isMethodMissing: (error) => /unknown method/i.test(String(error)) },
      '../i18n': { useT: () => components },
    })
    let props = {
      host: 'a',
      projectId: 'p',
      title: 'Fix login',
      online: true,
      branchPrefix: 'team/',
      intent: { strategy: 'fixed', instructions: '', prompt: 'Fix login' },
      onChange: (choice) => {
        props = { ...props, choice }
      },
    }
    const render = () => hooks.render(() => BranchNameControls(props))
    const button = (tree, title) => nodes(tree).find((node) => node.type === 'Button' && node.props.title === title)
    let tree = render()
    assert.equal(button(tree, 'branchNameGenerate'), undefined)
    find(tree, 'TextInput').props.onChangeText('bad..name')
    tree = render()
    assert.equal(button(tree, 'branchNamePreview').props.disabled, true)
    button(tree, 'branchNamePreview').props.onPress()
    assert.equal(requests.length, 0)
    find(tree, 'TextInput').props.onChangeText('manual/login')
    tree = render()
    button(tree, 'branchNamePreview').props.onPress()
    requests[0].resolve([{ id: 'repo' }])
    await settle()
    const preview = requests[1]
    assert.equal(preview.method, 'tasks.plan')
    assert.deepEqual(Array.from(preview.args[2]), ['repo'])
    assert.equal(preview.args[3].name, 'manual/login')
    assert.equal(preview.args[4].branchPrefix, 'team/')
    assert.equal(preview.args[4].strategy, 'fixed')
    preview.resolve([
      {
        repoId: 'repo',
        repoName: 'Repo',
        baseRef: 'main',
        baseOid: 'abcd1234',
        taskBranch: 'manual/login',
        path: '/work/login',
      },
    ])
    await settle()
    tree = render()
    assert.ok(nodes(tree).some((node) => node.props?.children === 'branchNameProvisional'))
    find(tree, 'TextInput').props.onChangeText('manual/changed')
    render()
    tree = render()
    assert.ok(!nodes(tree).some((node) => node.props?.children === 'branchNameProvisional'))
    button(tree, 'branchNamePreview').props.onPress()
    requests.at(-1).reject(new Error('Unknown method tasks.plan'))
    await settle()
    tree = render()
    assert.ok(nodes(tree).some((node) => node.props?.children === 'branchNameOutdated'))
    props = { ...props, online: false }
    tree = render()
    assert.equal(button(tree, 'branchNamePreview').props.disabled, true)
    const count = requests.length
    button(tree, 'branchNamePreview').props.onPress()
    assert.equal(requests.length, count)
    hooks.dispose()
  })
}

for (const ambiguous of [false, true]) {
  test(`queued reviewed bases ${ambiguous ? 'keep unknown outcomes uncertain' : 'pause on confirmed rejection and require durable approval'}`, async () => {
    const { newChatHost } = await import('../src/runtime/newChatHost.ts')
    const hooks = hookHarness()
    const refs = []
    const calls = [],
      writes = []
    let failWrite = false
    class HostError extends Error {
      constructor(message, status = 0, ambiguous = false) {
        super(message)
        this.status = status
        this.ambiguous = ambiguous
      }
    }
    const initial = {
      computers: [{ id: 'a', name: 'Host', status: 'offline' }],
      projects: [{ id: 'a:p', computerId: 'a' }],
      chats: [],
      drafts: {},
      outbox: [],
    }
    const { StoreProvider } = load('runtime/store.tsx', 'ios', {
      react: {
        memo: (component) => component,
        ...hooks.react,
        createContext: () => ({ Provider: 'Store' }),
        useEffect() {},
        useRef(value) {
          const ref = hooks.react.useRef(value)
          refs.push(ref)
          return ref
        },
      },
      'react-native': { AppState: { currentState: 'active' } },
      '../storage': {
        readLocal: (defaults) => ({ ...defaults, ...initial }),
        writeLocal: (value) => {
          if (failWrite) throw new Error('Storage full')
          writes.push(JSON.parse(JSON.stringify(value)))
        },
      },
      './newChatHost': { newChatHost },
      './workspaces': workspaceChoices,
      './transport': { HostError },
      './threadActivity': { normalizeHelperGroups: (rows) => rows },
    })
    const render = () => hooks.render(() => StoreProvider({ children: null })).props.value
    let store = render()
    const stateRef = refs[0]
    const connectionRef = refs[1]
    connectionRef.current.set('a', {
      controller: new AbortController(),
      client: {
        invoke: async (method, ...args) => {
          calls.push({ method, args })
          if (method === 'tasks.workspaceOptions') return { branchNameControls: true }
          if (method === 'repos.list') return [{ id: 'repo' }]
          if (method === 'tasks.plan')
            return [
              {
                repoId: 'repo',
                repoName: 'Repo',
                baseRef: 'main',
                baseOid: 'new-base',
                taskBranch: 'mine/login',
                path: '/work/login',
              },
            ]
          if (method === 'tasks.create')
            throw new HostError(
              'Repository HEAD changed since preview. Review the worktree plan and try again.',
              400,
              ambiguous,
            )
          throw new Error(`Unexpected ${method}`)
        },
      },
    })
    stateRef.current.computers[0].status = 'online'
    const reviewed = [
      {
        repoId: 'repo',
        repoName: 'Repo',
        baseRef: 'main',
        baseOid: 'old-base',
        taskBranch: 'mine/login',
        path: '/work/login',
      },
    ]
    const candidate = { name: 'mine/login', source: 'manual' }
    await store.createChat({
      computerId: 'a',
      projectId: 'a:p',
      text: 'Fix login',
      provider: 'codex',
      model: '',
      effort: '',
      mode: 'worktree',
      branchPrefix: 'team/',
      branchChoice: candidate,
      reviewedPlan: reviewed,
      branchNaming: { strategy: 'fixed', instructions: '', prompt: 'Fix login' },
    })
    reviewed[0].baseOid = 'caller-mutated'
    candidate.name = 'caller-mutated'
    await settle()
    store = render()
    const item = store.outbox[0]
    assert.equal(item.state, ambiguous ? 'uncertain' : 'review')
    const first = calls.find((call) => call.method === 'tasks.create')
    assert.equal(first.args[1][0].baseOid, 'old-base')
    assert.equal(first.args[0].branchChoice.name, 'mine/login')
    assert.ok(!calls.some((call) => call.method === 'tasks.plan'))
    if (ambiguous) {
      await assert.rejects(store.previewOutbox(item.id), /not awaiting/)
      await assert.rejects(store.resumeOutbox(item.id, reviewed), /not awaiting/)
    } else {
      const updated = await store.previewOutbox(item.id)
      failWrite = true
      await assert.rejects(store.resumeOutbox(item.id, updated), /Storage full/)
      assert.equal(render().outbox[0].state, 'review')
      assert.equal(calls.filter((call) => call.method === 'tasks.create').length, 1)
      failWrite = false
      await store.resumeOutbox(item.id, updated)
      updated[0].baseOid = 'caller-mutated'
      await settle()
      store = render()
      assert.equal(store.outbox[0].state, 'review', 'a second base movement pauses again')
      const second = calls.filter((call) => call.method === 'tasks.create')[1]
      assert.equal(second.args[0].requestId, first.args[0].requestId)
      assert.equal(second.args[1][0].baseOid, 'new-base')
      assert.ok(
        writes.some(
          (value) => value.outbox[0]?.state === 'waiting' && value.outbox[0]?.reviewedPlan[0].baseOid === 'new-base',
        ),
      )
      assert.equal(store.chats.length, 1)
    }
    hooks.dispose()
  })
}

for (const os of ['ios', 'android']) {
  test(`${os} new-thread naming keeps reviewed bases through offline enqueue and drops a mismatched review`, async () => {
    const hooks = hookHarness()
    const submitted = []
    let online = true
    const store = {
      selected: 'a',
      computers: [{ id: 'a', name: 'Host' }],
      projects: [{ id: 'a:p', computerId: 'a', name: 'Project' }],
      drafts: { 'a:new:a:p': 'Fix login', 'a:new:a:p:workspace': '{"version":1,"mode":"worktree"}' },
      defaults: {},
      appPreferences: { a: { defaultCheckoutMode: 'current' } },
      isOnline: () => online,
      setDraft: (key, value) => {
        store.drafts[key] = value
      },
      subscribe: () => () => {},
      invoke: async () => ({
        defaultCheckoutMode: 'current',
        branchPrefix: 'team/',
        branchNaming: 'semantic',
        branchInstructions: '',
        branchNameControls: true,
        worktreeUnavailable: null,
      }),
      createChat: async (input) => {
        submitted.push(input)
        return 'pending'
      },
    }
    const { default: NewChat } = load('app/new.tsx', os, {
      react: hooks.react,
      'expo-router': { useLocalSearchParams: () => ({ project: 'a:p' }), useRouter: () => ({ replace() {} }) },
      '@ramu/shared/workspaceDefaults': workspaceDefaults,
      '@ramu/shared/workspace/explorer': explorerScopes,
      '../runtime/workspaces': workspaceChoices,
      '../runtime/useWorkspaces': { useWorkspaces: () => ({ rows: [] }) },
      '../runtime/store': { useStore: () => store },
      '../runtime/types': { STANDALONE: 'no-project' },
      '../i18n': { useT: () => components },
      '../components/Keyboard': { useKeyboardInset: () => 0 },
    })
    const render = () => hooks.render(() => NewChat())
    render()
    await settle()
    let tree = render()
    nodes(find(tree, 'Composer').props.header)
      .find((node) => node.props?.icon === 'GitBranch')
      .props.onPress()
    tree = render()
    let controls = find(tree, 'BranchNameControls')
    assert.equal(controls.props.host, 'a')
    controls.props.onChange({ name: 'mine/login', source: 'manual' })
    tree = render()
    controls = find(tree, 'BranchNameControls')
    assert.equal(controls.props.choice.name, 'mine/login')
    const reviewed = [{ repoId: 'repo', baseOid: 'reviewed-base' }]
    controls.props.onReview(reviewed)
    render()
    online = false
    render()
    tree = render()
    await find(tree, 'Composer').props.onSend('Fix login', 'send', [], [])
    assert.equal(submitted[0].reviewedPlan[0].baseOid, 'reviewed-base')
    assert.equal(submitted[0].branchChoice.name, 'mine/login')
    store.drafts['a:new:a:p'] = 'Fix another issue'
    tree = render()
    await find(tree, 'Composer').props.onSend('Fix another issue', 'send', [], [])
    assert.equal(submitted[1].reviewedPlan, undefined)
    assert.equal(submitted[1].branchChoice.name, 'mine/login', 'manual edits survive a changed prompt')
    find(tree, 'BranchNameControls').props.onChange({ name: 'bad..name', source: 'manual' })
    tree = render()
    await assert.rejects(find(tree, 'Composer').props.onSend('Fix another issue', 'send', [], []), /branchNameInvalid/)
    assert.equal(submitted.length, 2)
    hooks.dispose()
  })
}

for (const os of ['ios', 'android']) {
  test(`${os} changed-base review shows commits and requires a successful explicit approval before closing`, async () => {
    const hooks = hookHarness()
    const preview = deferred(),
      approval = deferred()
    const calls = []
    let online = true,
      closed = 0
    const { WorktreeBaseReview } = load('components/WorktreeBaseReview.tsx', os, {
      react: hooks.react,
      '../runtime/store': {
        useStore: () => ({
          isOnline: (host) => {
            assert.equal(host, 'a')
            return online
          },
          previewOutbox: (id) => {
            calls.push(['preview', id])
            return preview.promise
          },
          resumeOutbox: (id, plan) => {
            calls.push(['resume', id, plan])
            return approval.promise
          },
        }),
      },
      '../i18n': { useT: () => components },
    })
    const item = {
      id: 'pending',
      computerId: 'a',
      state: 'review',
      reviewedPlan: [{ repoId: 'r', baseOid: 'oldbase' }],
    }
    const render = () =>
      hooks.render(() =>
        WorktreeBaseReview({
          item,
          onClose: () => {
            closed++
          },
        }),
      )
    const button = (tree) =>
      nodes(tree).find((node) => node.type === 'Button' && node.props.title === 'branchRetryBases')
    let tree = render()
    assert.equal(button(tree).props.disabled, true)
    const plan = [
      {
        repoId: 'r',
        repoName: 'Repo',
        baseRef: 'main',
        baseOid: 'newbase',
        taskBranch: 'mine/login',
        path: '/work/login',
      },
    ]
    preview.resolve(plan)
    await settle()
    tree = render()
    assert.equal(button(tree).props.disabled, false)
    assert.ok(JSON.stringify(tree).includes('oldbase'))
    assert.ok(JSON.stringify(tree).includes('newbase'))
    button(tree).props.onPress()
    button(tree).props.onPress()
    assert.equal(calls.filter(([method]) => method === 'resume').length, 1)
    assert.equal(calls[1][1], 'pending')
    assert.equal(calls[1][2], plan)
    assert.equal(closed, 0)
    approval.reject(new Error('Storage full'))
    await settle()
    tree = render()
    assert.ok(
      nodes(tree).some(
        (node) => typeof node.props?.children === 'string' && node.props.children.includes('Storage full'),
      ),
    )
    assert.equal(closed, 0)
    online = false
    tree = render()
    assert.equal(button(tree).props.disabled, true)
    hooks.dispose()
  })
}

for (const os of ['ios', 'android']) {
  test(`${os} Explorer loads continuation pages once and discards pages from a previous host`, async () => {
    const hooks = hookHarness()
    const calls = []
    let params = { computer: 'a', ctx: 'project:p' }
    let finishPage
    const store = {
      projects: [],
      computers: [
        { id: 'a', name: 'Laptop' },
        { id: 'b', name: 'Server' },
      ],
      isOnline: () => true,
      subscribe: () => () => {},
      invoke: async (host, method, context, repo, path, cursor) => {
        calls.push([host, method, context, repo, path, cursor])
        if (method === 'files.explorerBindings') return [{ repoId: 'r', repoName: 'Repo', setupState: 'ready' }]
        if (method === 'files.browse') {
          if (cursor === 'page-2')
            return new Promise((resolve) => {
              finishPage = resolve
            })
          return {
            entries: [{ name: `${host}.txt`, path: `${host}.txt`, kind: 'file' }],
            truncated: host === 'a',
            ...(host === 'a' ? { nextCursor: 'page-2' } : {}),
          }
        }
        throw Error(`Unexpected ${method}`)
      },
    }
    const { default: Explorer } = load('app/explorer.tsx', os, {
      react: hooks.react,
      'expo-router': { useLocalSearchParams: () => params, useRouter: () => ({ push() {} }), useFocusEffect() {} },
      '@ramu/shared/workspace/explorer': explorerScopes,
      '../runtime/useWorkspaces': { useWorkspaces: () => ({ rows: [] }) },
      '../runtime/store': { useStore: () => store },
      '../i18n': { useT: () => ({ loadMoreFiles: 'Load more files' }) },
    })
    const render = () => hooks.render(() => Explorer())
    render()
    await settle()
    let tree = render()
    const more = nodes(find(tree, 'PageFlatList').props.ListFooterComponent).find((node) => node.type === 'Row')
    assert.ok(more)
    more.props.onPress()
    more.props.onPress()
    tree = render()
    assert.equal(
      nodes(find(tree, 'PageFlatList').props.ListFooterComponent).find((node) => node.type === 'Row').props.disabled,
      true,
    )
    assert.equal(calls.filter((call) => call[5] === 'page-2').length, 1)
    finishPage({ entries: [{ name: 'second.txt', path: 'second.txt', kind: 'file' }], truncated: false })
    await settle()
    tree = render()
    assert.deepEqual(
      find(tree, 'PageFlatList').props.data.map((row) => row.entry.path),
      ['a.txt', 'second.txt'],
    )
    assert.equal(
      nodes(find(tree, 'PageFlatList').props.ListFooterComponent).filter((node) => node.type === 'Row').length,
      0,
    )
    // Refresh, then switch hosts while the second page is outstanding.
    // The label is optional in this fixture; use the refresh button's position.
    const buttons = nodes(find(tree, 'Header').props.right).filter((node) => node.type === 'HeaderButton')
    buttons.at(-1).props.onPress()
    render()
    await settle()
    tree = render()
    nodes(find(tree, 'PageFlatList').props.ListFooterComponent)
      .find((node) => node.type === 'Row')
      .props.onPress()
    const oldFinish = finishPage
    params = { computer: 'b', ctx: 'project:p' }
    render()
    await settle()
    oldFinish({
      entries: [{ name: 'stale.txt', path: 'stale.txt', kind: 'file' }],
      truncated: false,
      nextCursor: 'stale',
    })
    await settle()
    tree = render()
    assert.deepEqual(
      find(tree, 'PageFlatList').props.data.map((row) => row.entry.path),
      ['b.txt'],
    )
    assert.equal(
      nodes(find(tree, 'PageFlatList').props.ListFooterComponent).filter((node) => node.type === 'Row').length,
      0,
    )
    more.props.onPress()
    assert.equal(calls.filter((call) => call[5] === 'page-2').length, 2)
    hooks.dispose()
  })
}

for (const os of ['ios', 'android']) {
  test(`${os} usage detail preserves provider allowance explanations in English and Indonesian`, async () => {
    const presentation = await import('../../../packages/shared/src/usage/presentation.ts')
    const store = { language: 'en' }
    const { PlanUsageReading } = load('components/PlanUsage.tsx', os, {
      '@ramu/shared/usage/presentation': presentation,
      '../runtime/store': { useStore: () => store },
      '../runtime/types': { providerNames: { cursor: 'Cursor', antigravity: 'Antigravity' } },
    })
    for (const language of ['en', 'id']) {
      store.language = language
      for (const [provider, scope] of [
        ['cursor', undefined],
        ['cursor', 'Cursor models'],
        ['cursor', 'Other models'],
        ['antigravity', 'Claude'],
        ['antigravity', 'GPT'],
      ]) {
        const reading = { provider, scope, window: 'monthly', status: 'ok', usedPercent: 30, updatedAt: Date.now() }
        const tree = PlanUsageReading({ reading })
        assert.ok(nodes(tree).some((node) => node.props?.children === presentation.usageScopeHint(reading, language)))
      }
    }
  })
}

test('usage refresh recovers after transient failure and reconnect without losing last-known account data', async () => {
  const presentation = await import('../../../packages/shared/src/usage/presentation.ts')
  const providers = await import('../../../packages/shared/src/providers/providers.ts')
  const { isMethodMissing } = await import('../src/runtime/goalVerify.ts')
  const hooks = hookHarness()
  const listeners = new Set()
  let online = true,
    failRefresh = true,
    failAccounts = false,
    percent = 15,
    reads = 0
  const store = {
    language: 'en',
    computers: [{ id: 'a', name: 'Laptop' }],
    appPreferences: {},
    usage: {},
    isOnline: () => online,
    subscribe: (_host, listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    invoke: async (_host, method) => {
      if (method === 'usage.refresh') {
        if (failRefresh) throw Error('Connection lost')
        return []
      }
      reads++
      if (failAccounts) throw Error('Temporary network failure')
      return [
        { provider: 'claude-code', window: 'five_hour', usedPercent: percent, updatedAt: Date.now(), status: 'ok' },
      ]
    },
  }
  const { PlanUsageSheet, PlanUsageReading } = load('components/PlanUsage.tsx', 'android', {
    react: hooks.react,
    'expo-router': { useRouter: () => ({ push() {} }) },
    '@ramu/shared/usage/presentation': presentation,
    '@ramu/shared/providers/providers': providers,
    '../runtime/goalVerify': { isMethodMissing },
    '../runtime/store': { useStore: () => store },
  })
  const render = () => hooks.render(() => PlanUsageSheet({ hosts: ['a'], open: true, onClose() {} }))
  const reading = () => nodes(render()).find((node) => node.type === PlanUsageReading).props.reading
  const refresh = () =>
    nodes(render()).find(
      (node) => node.type === 'Row' && nodes(node).some((child) => child.props?.children === 'Refresh Claude usage'),
    )
  const hasError = () => nodes(render()).some((node) => node.props?.tone === 'bad')
  render()
  await settle()
  refresh().props.onPress()
  await settle()
  assert.equal(reading().usedPercent, 15)
  assert.equal(hasError(), true)
  assert.equal(typeof refresh().props.onPress, 'function', 'transient failure must not disable retry')
  failRefresh = false
  percent = 20
  refresh().props.onPress()
  await settle()
  assert.equal(reading().usedPercent, 20)
  assert.equal(hasError(), false)
  failAccounts = true
  for (const listener of listeners) listener('usage:changed')
  await settle()
  assert.equal(reading().usedPercent, 20)
  assert.equal(hasError(), true)
  online = false
  render()
  assert.equal(listeners.size, 0)
  const before = reads
  assert.equal(reading().usedPercent, 20)
  assert.equal(reads, before)
  online = true
  failAccounts = false
  percent = 25
  render()
  await settle()
  assert.equal(reading().usedPercent, 25)
  assert.equal(hasError(), false)
  assert.equal(listeners.size, 1)
  hooks.dispose()
})

const actionSettingsCopy = {
  manageProjectActions: 'Manage actions',
  moveActionUp: 'Move up',
  moveActionDown: 'Move down',
  hideProjectAction: 'Hide action',
  showProjectAction: 'Show action',
  useRepositoryOrder: 'Use repository order',
  actionSettingsUnsupported: 'Update host',
  actionSettingsOffline: 'Connect to change actions',
  hiddenAction: 'Hidden',
  hiddenActionsHint: 'Hidden actions do not appear in menus or shortcuts.',
}
for (const os of ['ios', 'android']) {
  test(`${os} project action management reorders IDs and hides/restores on the owning host without executing commands`, async () => {
    const { isMethodMissing } = await import('../src/runtime/goalVerify.ts')
    const hooks = hookHarness()
    const calls = []
    const a = { id: 'test', name: 'Test', command: 'echo test', source: 'ramu.json' }
    const b = { id: 'dev', name: 'Dev', command: 'echo dev', source: 'ramu.json' }
    let settings = { actions: [a, b], hiddenIds: [], customOrder: false }
    let finish
    const store = {
      isOnline: () => true,
      subscribe: () => () => {},
      invoke: async (host, method, ...args) => {
        calls.push([host, method, ...args])
        if (method === 'projects.actionSettings') return settings
        if (method === 'projects.reorderActions') {
          settings = { ...settings, actions: [b, a], customOrder: true }
          return settings
        }
        if (method === 'projects.setActionVisibility') {
          settings = { ...settings, hiddenIds: args[2] ? [args[1]] : [] }
          return new Promise((resolve) => {
            finish = () => resolve(settings)
          })
        }
        if (method === 'projects.resetActionOrder') {
          settings = { ...settings, actions: [a, b], customOrder: false }
          return settings
        }
        throw Error(`Unexpected ${method}`)
      },
    }
    const { ProjectCommandSettings } = load('components/ProjectCommandSettings.tsx', os, {
      react: hooks.react,
      '../runtime/store': { useStore: () => store },
      '../runtime/goalVerify': { isMethodMissing },
      '../i18n': { useT: () => actionSettingsCopy },
    })
    const render = () =>
      hooks.render(() => ProjectCommandSettings({ hostId: 'remote', projectId: 'p', open: true, onClose() {} }))
    const button = (label) =>
      nodes(render()).find(
        (node) => node.type === 'Button' && (node.props.accessibilityLabel === label || node.props.title === label),
      )
    render()
    await settle()
    button('Move down: Test').props.onPress()
    await settle()
    assert.ok(
      calls.some(
        (call) => JSON.stringify(call) === JSON.stringify(['remote', 'projects.reorderActions', 'p', ['dev', 'test']]),
      ),
    )
    const hide = button('Hide action: Test')
    hide.props.onPress()
    hide.props.onPress()
    assert.equal(calls.filter((call) => call[1] === 'projects.setActionVisibility').length, 1)
    assert.equal(button('Hide action: Test').props.disabled, true)
    finish()
    await settle()
    assert.equal(button('Show action: Test').props.disabled, false)
    button('Show action: Test').props.onPress()
    finish()
    await settle()
    button('Use repository order').props.onPress()
    await settle()
    assert.ok(calls.every(([, method]) => method.startsWith('projects.')))
    assert.ok(calls.every(([host]) => host === 'remote'))
    assert.deepEqual(settings.hiddenIds, [])
    hooks.dispose()
  })

  test(`${os} project action management fences stale hosts, unsupported methods, offline controls and dismissed reads`, async () => {
    const { isMethodMissing } = await import('../src/runtime/goalVerify.ts')
    const hooks = hookHarness()
    const requests = [],
      listeners = new Map()
    let props = { hostId: 'a', projectId: 'p', open: true, onClose() {} }
    let online = true
    const store = {
      isOnline: () => online,
      subscribe: (host, listener) => {
        listeners.set(host, listener)
        return () => listeners.delete(host)
      },
      invoke: (host, method) => {
        const request = { host, method, ...deferred() }
        requests.push(request)
        return request.promise
      },
    }
    const { ProjectCommandSettings } = load('components/ProjectCommandSettings.tsx', os, {
      react: hooks.react,
      '../runtime/store': { useStore: () => store },
      '../runtime/goalVerify': { isMethodMissing },
      '../i18n': { useT: () => actionSettingsCopy },
    })
    const render = () => hooks.render(() => ProjectCommandSettings(props))
    const has = (text) => nodes(render()).some((node) => node.props?.children === text)
    const settings = (name) => ({
      actions: [{ id: 'same-id', name, command: 'echo safe', source: 'ramu.json' }],
      hiddenIds: [],
      customOrder: false,
    })
    render()
    requests[0].resolve(settings('Host A'))
    await settle()
    assert.ok(
      nodes(render()).some((node) => Array.isArray(node.props?.children) && node.props.children[0] === 'Host A'),
    )
    listeners.get('a')('workspace:changed')
    const late = requests[1]
    props = { ...props, hostId: 'b' }
    render()
    requests[2].reject(Error('Unknown method projects.actionSettings'))
    late.resolve(settings('Late A'))
    await settle()
    assert.equal(has('Update host'), true)
    assert.equal(nodes(render()).filter((node) => node.type === 'Button').length, 0)
    online = false
    render()
    assert.equal(has('Connect to change actions'), true)
    assert.equal(listeners.size, 0)
    online = true
    render()
    requests.at(-1).resolve(settings('Host B'))
    await settle()
    const oldButton = nodes(render()).find(
      (node) => node.type === 'Button' && node.props.accessibilityLabel === 'Hide action: Host B',
    )
    online = false
    render()
    assert.ok(
      nodes(render())
        .filter((node) => node.type === 'Button')
        .every((node) => node.props.disabled),
    )
    props = { ...props, hostId: 'c' }
    render()
    const count = requests.length
    oldButton.props.onPress()
    assert.equal(requests.length, count)
    online = true
    render()
    const last = requests.at(-1)
    props = { ...props, open: false }
    render()
    last.resolve(settings('After dismissal'))
    await settle()
    assert.equal(listeners.size, 0)
    assert.equal(
      nodes(render()).some(
        (node) => Array.isArray(node.props?.children) && node.props.children[0] === 'After dismissal',
      ),
      false,
    )
    hooks.dispose()
  })
}

for (const os of ['ios', 'android']) {
  test(`${os} project menu opens action management for its explicit host and project without starting work`, () => {
    const hooks = hookHarness()
    let closed = 0
    const store = { isOnline: () => true }
    const { ProjectActionsSheet } = load('components/ChatActions.tsx', os, {
      react: hooks.react,
      '../runtime/store': { useStore: () => store },
      '../i18n': { useT: () => actionSettingsCopy },
      './ProjectCommandSettings': { ProjectCommandSettings: 'ProjectCommandSettings' },
    })
    const render = () =>
      hooks.render(() =>
        ProjectActionsSheet({
          project: { id: 'remote:p', computerId: 'remote', name: 'Project' },
          open: true,
          onClose: () => {
            closed++
          },
        }),
      )
    nodes(render())
      .find((node) => node.type === 'Row' && nodes(node).some((child) => child.props?.children === 'Manage actions'))
      .props.onPress()
    const manager = find(render(), 'ProjectCommandSettings')
    assert.equal(manager.props.hostId, 'remote')
    assert.equal(manager.props.projectId, 'p')
    manager.props.onClose()
    assert.equal(closed, 1)
    hooks.dispose()
  })
}

const projectModelCopy = {
  projectModelChoose: 'Choose a model before starting',
  projectModelInvalid: 'Invalid model choice',
  projectModelChanged: 'Project model changed; review before sending',
  projectModelManual: 'Draft model',
  projectModelLoading: 'Loading project model',
  projectModelDefault: 'Project model default',
  projectModelUnsupported: 'Update host for project defaults',
  projectModelUseDefault: 'Use project default',
  projectModelUseHost: 'Use host default',
}
const modelBase = {
  provider: 'codex',
  model: 'host-model',
  effort: 'high',
  access: 'edits',
  autoFallback: false,
  accountId: 'work',
  serviceTier: 'fast',
}
const modelRepository = {
  status: 'ready',
  source: 'ramu.json',
  requested: { provider: 'claude-code', model: 'repository-model' },
  selection: { provider: 'claude-code', model: 'repository-model', effort: 'low' },
}

for (const os of ['ios', 'android']) {
  test(`${os} explicit new-thread models survive default changes and stay isolated by host and composer scope`, async () => {
    const { isMethodMissing } = await import('../src/runtime/goalVerify.ts')
    const hooks = hookHarness(),
      listeners = new Set(),
      calls = []
    let props = { host: 'a', project: 'a:p', key: 'a:new:a:p', base: modelBase }
    let latest = modelRepository,
      online = true
    const store = {
      drafts: {},
      isOnline: () => online,
      setDraft: (key, value) => {
        store.drafts[key] = value
      },
      subscribe: (_host, listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      invoke: async (...args) => {
        calls.push(args)
        return latest
      },
    }
    const { useAgentDraft } = load('runtime/useAgentDraft.ts', os, {
      react: hooks.react,
      './store': { useStore: () => store },
      './goalVerify': { isMethodMissing },
      '@ramu/shared/workspace/agentDefaults': agentDraftModel,
      '../i18n': { useT: () => projectModelCopy },
    })
    const render = () => hooks.render(() => useAgentDraft(props.host, props.project, props.key, props.base))
    assert.equal(render().blocked, true)
    await settle()
    assert.equal(render().settings.model, 'repository-model')
    assert.equal(render().settings.accountId, undefined)
    assert.equal(render().settings.access, 'edits')
    render().change({ ...render().settings, access: 'auto' })
    latest = { ...modelRepository, selection: { ...modelRepository.selection, model: 'new-repository-model' } }
    for (const listener of listeners) listener('workspace:changed')
    await settle()
    assert.equal(render().settings.model, 'new-repository-model')
    assert.equal(render().settings.access, 'auto')
    render().change({
      ...render().settings,
      provider: 'codex',
      model: 'chosen',
      effort: 'high',
      serviceTier: 'standard',
    })
    props = { ...props, base: { ...modelBase, model: 'changed-host-model' } }
    assert.equal(render().settings.model, 'chosen')
    props = { host: 'b', project: 'b:p', key: 'b:new:b:p', base: modelBase }
    assert.notEqual(render().settings.model, 'chosen')
    await settle()
    props = { host: 'a', project: 'a:p', key: 'a:new:a:p', base: modelBase }
    assert.equal(render().settings.model, 'chosen')
    props = { ...props, key: 'a:new:a:p:files:worktree' }
    assert.notEqual(render().settings.model, 'chosen')
    props = { ...props, key: 'a:new:a:p' }
    render().useProjectDefault()
    await settle()
    assert.equal(render().settings.model, 'new-repository-model')
    online = false
    const count = calls.length
    assert.equal((await render().verify()).model, 'new-repository-model')
    assert.equal(calls.length, count)
    hooks.dispose()
  })

  test(`${os} model preflight rejects changed or late host results and preserves newer choices after enqueue`, async () => {
    const { isMethodMissing } = await import('../src/runtime/goalVerify.ts')
    const hooks = hookHarness(),
      calls = []
    let props = { host: 'a', project: 'a:p', key: 'a:new:a:p' },
      latest = modelRepository,
      waiting
    const store = {
      drafts: {},
      isOnline: () => true,
      subscribe: () => () => {},
      setDraft: (key, value) => {
        store.drafts[key] = value
      },
      invoke: (...args) => {
        calls.push(args)
        return waiting ? waiting.promise : Promise.resolve(latest)
      },
    }
    const { useAgentDraft } = load('runtime/useAgentDraft.ts', os, {
      react: hooks.react,
      './store': { useStore: () => store },
      './goalVerify': { isMethodMissing },
      '@ramu/shared/workspace/agentDefaults': agentDraftModel,
      '../i18n': { useT: () => projectModelCopy },
    })
    const render = () => hooks.render(() => useAgentDraft(props.host, props.project, props.key, modelBase))
    render()
    await settle()
    latest = { ...modelRepository, selection: { ...modelRepository.selection, model: 'changed-before-send' } }
    await assert.rejects(render().verify(), /review before sending/)
    assert.equal(render().settings.model, 'changed-before-send')
    assert.equal((await render().verify()).model, 'changed-before-send')
    waiting = deferred()
    const old = render().verify()
    props = { host: 'b', project: 'b:p', key: 'b:new:b:p' }
    render()
    waiting.resolve(modelRepository)
    await assert.rejects(old, /review before sending/)
    await settle()
    assert.notEqual(render().settings.model, 'changed-before-send')
    waiting = undefined
    render().useHostDefault()
    const sent = render()
    sent.change({ ...modelBase, model: 'newer-manual' })
    render()
    sent.consume()
    assert.equal(JSON.parse(store.drafts['b:new:b:p:agent']).selection.model, 'newer-manual')
    render().consume()
    assert.equal(store.drafts['b:new:b:p:agent'], '')
    hooks.dispose()
  })

  test(`${os} unknown saved model formats require an explicit model and old hosts keep their displayed host default`, async () => {
    const { isMethodMissing } = await import('../src/runtime/goalVerify.ts')
    const hooks = hookHarness()
    const store = {
      drafts: { 'a:new:a:p:agent': '{"version":99}' },
      isOnline: () => true,
      subscribe: () => () => {},
      setDraft: (key, value) => {
        store.drafts[key] = value
      },
      invoke: async () => {
        throw Error('Unknown method tasks.agentDefaults')
      },
    }
    const { useAgentDraft } = load('runtime/useAgentDraft.ts', os, {
      react: hooks.react,
      './store': { useStore: () => store },
      './goalVerify': { isMethodMissing },
      '@ramu/shared/workspace/agentDefaults': agentDraftModel,
      '../i18n': { useT: () => projectModelCopy },
    })
    const render = () => hooks.render(() => useAgentDraft('a', 'a:p', 'a:new:a:p', modelBase))
    render()
    await settle()
    assert.equal(render().blocked, true)
    render().change({ ...render().settings, access: 'auto' })
    assert.equal(store.drafts['a:new:a:p:agent'], '{"version":99}')
    render().useHostDefault()
    assert.equal(render().blocked, false)
    assert.equal((await render().verify()).model, 'host-model')
    store.drafts = {}
    assert.equal(render().unsupported, true)
    assert.equal(render().blocked, false)
    assert.equal((await render().verify()).model, 'host-model')
    hooks.dispose()
  })
}

for (const os of ['ios', 'android']) {
  test(`${os} New thread queues the reviewed repository model and preserves its draft when the preference changes before send`, async () => {
    const { isMethodMissing } = await import('../src/runtime/goalVerify.ts')
    const hooks = hookHarness(),
      submitted = [],
      destinations = [],
      calls = []
    let latest = modelRepository
    const copy = { ...projectModelCopy, newChat: 'New thread' }
    const store = {
      selected: 'a',
      computers: [{ id: 'a', name: 'Laptop', status: 'online' }],
      projects: [{ id: 'a:p', computerId: 'a', name: 'Project' }],
      drafts: { 'a:new:a:p': 'Keep the full draft' },
      defaults: { a: modelBase },
      appPreferences: { a: { defaultCheckoutMode: 'current' } },
      isOnline: () => true,
      subscribe: () => () => {},
      setDraft: (key, value) => {
        store.drafts[key] = value
      },
      invoke: async (host, method, ...args) => {
        calls.push([host, method, ...args])
        if (method === 'tasks.agentDefaults') return latest
        if (method === 'tasks.workspaceOptions')
          return {
            defaultCheckoutMode: 'current',
            branchNaming: 'fixed',
            branchPrefix: 'ramu/',
            branchInstructions: '',
            worktreeUnavailable: null,
          }
        throw Error(`Unexpected ${method}`)
      },
      createChat: async (input) => {
        submitted.push(input)
        return 'a:pending'
      },
    }
    const agentHook = load('runtime/useAgentDraft.ts', os, {
      react: hooks.react,
      './store': { useStore: () => store },
      './goalVerify': { isMethodMissing },
      '@ramu/shared/workspace/agentDefaults': agentDraftModel,
      '../i18n': { useT: () => copy },
    })
    const { default: NewChat } = load('app/new.tsx', os, {
      react: hooks.react,
      'expo-router': {
        useLocalSearchParams: () => ({ project: 'a:p' }),
        useRouter: () => ({ replace: (to) => destinations.push(to) }),
      },
      '@ramu/shared/workspaceDefaults': workspaceDefaults,
      '@ramu/shared/workspace/explorer': explorerScopes,
      '../runtime/workspaces': workspaceChoices,
      '../runtime/useWorkspaces': { useWorkspaces: () => ({ rows: [] }) },
      '../runtime/useAgentDraft': agentHook,
      '../runtime/store': { useStore: () => store },
      '../runtime/types': { STANDALONE: 'no-project' },
      '../i18n': { useT: () => copy },
      '../components/Keyboard': { useKeyboardInset: () => 0 },
    })
    const render = () => hooks.render(() => NewChat())
    render()
    await settle()
    const composer = find(render(), 'Composer')
    assert.equal(composer.props.model.provider, 'claude-code')
    assert.equal(composer.props.model.model, 'repository-model')
    assert.equal(composer.props.model.settings.access, 'edits')
    assert.equal(composer.props.model.settings.accountId, undefined)
    await composer.props.onSend('Keep the full draft', 'send', [], [])
    assert.equal(submitted[0].provider, 'claude-code')
    assert.equal(submitted[0].model, 'repository-model')
    assert.equal(submitted[0].settings.autoFallback, false)
    latest = { ...modelRepository, selection: { ...modelRepository.selection, model: 'new-model-before-send' } }
    await assert.rejects(
      find(render(), 'Composer').props.onSend('Keep the full draft', 'send', [], []),
      /review before sending/,
    )
    assert.equal(submitted.length, 1)
    assert.equal(store.drafts['a:new:a:p'], 'Keep the full draft')
    const current = find(render(), 'Composer')
    assert.equal(current.props.model.model, 'new-model-before-send')
    current.props.onModel({
      provider: 'codex',
      model: 'manual-model',
      effort: 'high',
      settings: { access: 'edits', autoFallback: false },
    })
    await find(render(), 'Composer').props.onSend('Keep the full draft', 'send', [], [])
    assert.equal(submitted[1].model, 'manual-model')
    assert.equal(store.drafts['a:new:a:p:agent'], '')
    assert.equal(destinations.length, 2)
    store.createChat = async (input) => {
      submitted.push(input)
      store.drafts['a:new:a:p'] = 'Newer unsent text'
      return 'a:newer-pending'
    }
    find(render(), 'Composer').props.onModel({ provider: 'codex', model: 'retain-for-newer-text', effort: 'high' })
    await find(render(), 'Composer').props.onSend('Keep the full draft', 'send', [], [])
    assert.equal(JSON.parse(store.drafts['a:new:a:p:agent']).selection.model, 'retain-for-newer-text')
    assert.equal(store.drafts['a:new:a:p'], 'Newer unsent text')
    assert.ok(calls.every(([host]) => host === 'a'))
    assert.ok(calls.every(([, method]) => ['tasks.workspaceOptions', 'tasks.agentDefaults'].includes(method)))
    hooks.dispose()
  })
}

for (const os of ['ios', 'android']) {
  test(`${os} unhydrated hosts never present an invented host default and restored manual drafts retain their reviewed access policy`, async () => {
    const { isMethodMissing } = await import('../src/runtime/goalVerify.ts')
    const hooks = hookHarness()
    const store = {
      drafts: {},
      isOnline: () => false,
      subscribe: () => () => {},
      setDraft: (key, value) => {
        store.drafts[key] = value
      },
      invoke: async () => {
        throw Error('Offline')
      },
    }
    const { useAgentDraft } = load('runtime/useAgentDraft.ts', os, {
      react: hooks.react,
      './store': { useStore: () => store },
      './goalVerify': { isMethodMissing },
      '@ramu/shared/workspace/agentDefaults': agentDraftModel,
      '../i18n': { useT: () => projectModelCopy },
    })
    const render = () =>
      hooks.render(() => useAgentDraft('a', 'a:p', 'a:new:a:p', { ...modelBase, access: 'full' }, false))
    assert.equal(render().blocked, true)
    render().useHostDefault()
    assert.equal(store.drafts['a:new:a:p:agent'], undefined)
    const previous = agentDraftModel.editAgentDraft({ version: 1 }, modelBase, {
      ...modelBase,
      model: 'reviewed-manual-model',
    })
    store.drafts['a:new:a:p:agent'] = JSON.stringify(previous)
    assert.equal(render().blocked, false)
    assert.equal((await render().verify()).access, 'edits')
    assert.equal(render().settings.autoFallback, false)
    assert.equal(render().settings.model, 'reviewed-manual-model')
    hooks.dispose()
  })
}

for (const os of ['ios', 'android']) {
  test(`${os} a configuration refresh supersedes an older model preflight without overwriting the newer selection`, async () => {
    const { isMethodMissing } = await import('../src/runtime/goalVerify.ts')
    const hooks = hookHarness(),
      requests = []
    let listener
    const store = {
      drafts: {},
      isOnline: () => true,
      setDraft() {},
      subscribe: (_host, read) => {
        listener = read
        return () => {}
      },
      invoke: () => {
        const request = deferred()
        requests.push(request)
        return request.promise
      },
    }
    const { useAgentDraft } = load('runtime/useAgentDraft.ts', os, {
      react: hooks.react,
      './store': { useStore: () => store },
      './goalVerify': { isMethodMissing },
      '@ramu/shared/workspace/agentDefaults': agentDraftModel,
      '../i18n': { useT: () => projectModelCopy },
    })
    const render = () => hooks.render(() => useAgentDraft('a', 'a:p', 'a:new:a:p', modelBase))
    render()
    requests[0].resolve(modelRepository)
    await settle()
    const pending = render().verify()
    listener('workspace:changed')
    requests[2].resolve({ ...modelRepository, selection: { ...modelRepository.selection, model: 'newest-model' } })
    await settle()
    requests[1].resolve(modelRepository)
    await assert.rejects(pending, /review before sending/)
    assert.equal(render().settings.model, 'newest-model')
    hooks.dispose()
  })
}

function chatView() {
  let states = []
  const componentStates = new Map()
  let cursor = 0
  const store = { language: 'en', drafts: {}, chats: [], setDraft() {} }
  const component = load('components/Transcript.tsx', 'ios', {
    react: {
      memo: (component) => component,
      ...require('react'),
      useState(initial) {
        const at = cursor++
        if (!(at in states)) states[at] = typeof initial === 'function' ? initial() : initial
        return [
          states[at],
          (next) => {
            states[at] = typeof next === 'function' ? next(states[at]) : next
          },
        ]
      },
      useEffect() {},
      useContext: () => () => {},
    },
    '../runtime/store': { useStore: () => store },
    '@ramu/shared/i18n': { translate: (_language, text) => text },
    '../i18n': { useT: () => ({}), fill: (text) => text },
    './ui': { ...components, tap() {}, T: 'T', Card: 'Card' },
    './Motion': { Collapse: 'Collapse', Disclosure: 'Disclosure', Breathe: 'Breathe' },
  })
  const invoke = (node) => {
    states = componentStates.get(node.type) ?? []
    componentStates.set(node.type, states)
    cursor = 0
    return node.type(node.props)
  }
  return {
    invoke,
    block(item) {
      const root = component.TranscriptItemView({ item, chat: { id: 'chat' } })
      const block = nodes(root).find((node) => node.type?.name === 'TranscriptBlock')
      return invoke(invoke(block))
    },
  }
}

test('mobile answered questions keep the bold answer outside the collapsed original options', () => {
  const view = chatView()
  let tree = view.block({
    kind: 'question',
    id: 'q',
    outcome: 'answered',
    answers: { q: 'Story' },
    questions: [
      {
        id: 'q',
        question: 'Where?',
        multiSelect: false,
        options: [
          { label: 'Story', description: 'Under the story' },
          { label: 'Epic', description: 'New epic' },
        ],
      },
    ],
  })
  tree = view.invoke(tree) // QuestionHistory
  const entry = nodes(tree).find((node) => node.type?.name === 'QuestionHistoryEntry')
  let history = view.invoke(entry)
  const collapse = find(history, 'Collapse')
  assert.equal(collapse.props.open, false)
  const answer = nodes(history).find((node) => node.props?.copyable === 'Story')
  assert.equal(answer.props.weight, '600')
  assert.ok(!nodes(collapse).includes(answer))
  const options = nodes(collapse).filter((node) => node.type?.name === 'Option')
  assert.deepEqual(
    options.map((node) => [node.props.label, node.props.selected]),
    [
      ['Story', true],
      ['Epic', false],
    ],
  )
  find(history, 'Pressable').props.onPress()
  history = view.invoke(entry)
  assert.equal(find(history, 'Collapse').props.open, true)
  assert.equal(find(history, 'Pressable').props.accessibilityState.expanded, true)
})

test('mobile grouped tool rows expand with the same disclosure and preserve every tool', () => {
  const view = chatView()
  const item = {
    kind: 'tools',
    id: 'first',
    tools: [
      { kind: 'tool', id: 'first', tool: 'read', verb: 'Read', subject: 'a.ts', status: 'completed' },
      { kind: 'tool', id: 'second', tool: 'execute', verb: 'Bash', subject: 'tests', status: 'in_progress' },
    ],
  }
  let tree = view.block(item)
  assert.equal(find(tree, 'Collapse').props.open, false)
  assert.equal(nodes(tree).filter((node) => node.type?.name === 'ToolRow').length, 2)
  find(tree, 'Pressable').props.onPress()
  tree = view.block(item)
  assert.equal(find(tree, 'Collapse').props.open, true)
  assert.equal(find(tree, 'Pressable').props.accessibilityState.expanded, true)
})

for (const os of ['ios', 'android']) {
  const deletion = (rows, invokeOverride) => {
    const alerts = [],
      calls = []
    const { confirmChatDeletion } = load('components/ChatActions.tsx', os, {
      'react-native': { Alert: { alert: (...args) => alerts.push(args) } },
      '@ramu/shared/i18n': { translate: (_language, text) => text },
      '@ramu/shared/chat/taskRemoval': taskRemoval,
    })
    const chat = {
      id: 'remote:task',
      taskId: 'task',
      title: 'Selected thread',
      computerId: 'remote',
      mode: 'worktree',
      workspaceId: 'workspace',
    }
    const store = {
      language: 'en',
      computers: [{ id: 'remote', name: 'Selected host' }],
      chats: [],
      invoke: async (...args) => {
        calls.push(args)
        return invokeOverride ? invokeOverride(...args) : args[1] === 'term.background.list' ? rows : undefined
      },
      refresh: async () => {},
    }
    return { alerts, calls, chat, store, confirmChatDeletion }
  }
  test(`${os} deletion shows commands on their host and sends one reviewed request only after approval`, async () => {
    const f = deletion([{ id: 'command', taskId: 'task', command: 'pnpm dev', state: 'running' }])
    let done = 0
    await f.confirmChatDeletion(f.store, f.chat, () => done++)
    assert.equal(f.calls.length, 1)
    assert.ok(f.alerts[0][1].includes('Selected host'))
    assert.ok(f.alerts[0][1].includes('pnpm dev'))
    assert.ok(f.alerts[0][1].includes('\n\n'))
    const approve = f.alerts[0][2].find((button) => button.text === 'Stop commands and delete thread')
    approve.onPress()
    approve.onPress()
    await settle()
    assert.equal(f.calls.filter(([, method]) => method === 'tasks.delete').length, 1)
    assert.deepEqual(f.calls[1], [
      'remote',
      'tasks.delete',
      'task',
      false,
      { backgroundIds: ['command'], forgetUnknown: false },
    ])
    assert.equal(done, 1)
  })
  test(`${os} unknown ownership requires acknowledgement and never offers worktree removal`, async () => {
    const f = deletion([{ id: 'unknown', taskId: 'task', command: 'old server', state: 'unknown' }])
    await f.confirmChatDeletion(f.store, f.chat)
    assert.ok(f.alerts[0][1].includes('Unknown commands cannot be stopped'))
    assert.equal(
      f.alerts[0][2].some((button) => button.text === 'Delete and remove worktree'),
      false,
    )
    f.alerts[0][2].find((button) => button.text === 'Delete thread and forget records').onPress()
    await settle()
    assert.deepEqual(f.calls[1], [
      'remote',
      'tasks.delete',
      'task',
      false,
      { backgroundIds: ['unknown'], forgetUnknown: true },
    ])
  })
  test(`${os} late review and unavailable hosts never authorize deletion`, async () => {
    const response = deferred()
    const f = deletion([], () => response.promise)
    let current = true
    const pending = f.confirmChatDeletion(f.store, f.chat, undefined, () => current)
    current = false
    response.resolve([])
    await pending
    assert.equal(f.alerts.length, 0)
    assert.equal(f.calls.length, 1)
    const offline = deletion([], async () => {
      throw new Error('offline')
    })
    await offline.confirmChatDeletion(offline.store, offline.chat)
    assert.equal(offline.alerts[0][0], 'Could not update thread')
    assert.equal(offline.calls.length, 1)
  })
  test(`${os} keeps shared worktrees and retains the ordinary two-argument deletion when no command needs review`, async () => {
    const f = deletion([])
    f.store.chats = [{ taskId: 'other', computerId: 'remote', workspaceId: 'workspace' }]
    await f.confirmChatDeletion(f.store, f.chat)
    assert.equal(
      f.alerts[0][2].some((button) => button.text === 'Delete and remove worktree'),
      false,
    )
    f.alerts[0][2].find((button) => button.text === 'Delete').onPress()
    await settle()
    assert.deepEqual(f.calls[1], ['remote', 'tasks.delete', 'task', false])
  })
}

for (const os of ['ios', 'android']) {
  function managedFixture(options = {}) {
    const hooks = hookHarness(),
      listeners = new Map(),
      calls = [],
      alerts = []
    let open = options.open ?? true,
      host = 'a',
      online = true,
      snapshot = options.snapshot
    let record = {
      id: 'command',
      taskId: 'task',
      repoId: null,
      cwd: '/checkout',
      command: 'pnpm dev',
      state: 'running',
      startedAt: 1,
      endedAt: null,
      exitCode: null,
      cursor: 3,
      output: 'abc',
      capabilities: { inspect: true, stop: true, forceStop: true, input: true },
      ...options.record,
    }
    const store = {
      language: 'en',
      computers: [
        { id: 'a', name: 'Host A' },
        { id: 'b', name: 'Host B' },
      ],
      drafts: { message: 'keep this draft' },
      isOnline: () => online,
      invoke: async (...args) => {
        calls.push(args)
        if (options.invoke) return options.invoke(...args)
        if (args[1] === 'term.background.list') return [record]
        if (args[1] === 'term.background.inspect') return snapshot ? snapshot.promise : record
        if (args[1] === 'term.background.stop') {
          record = { ...record, state: 'stopping' }
          return record
        }
        throw new Error(`Unexpected ${args[1]}`)
      },
      subscribe: (id, callback) => {
        const set = listeners.get(id) ?? new Set()
        set.add(callback)
        listeners.set(id, set)
        return () => set.delete(callback)
      },
    }
    const { BackgroundTerminals } = load('components/BackgroundTerminals.tsx', os, {
      react: hooks.react,
      'react-native': { Alert: { alert: (...args) => alerts.push(args) } },
      '../runtime/store': { useStore: () => store },
      '../runtime/goalVerify': { isMethodMissing: (error) => /unknown method/i.test(String(error)) },
      '@ramu/shared/workspace/terminalOutput': terminalOutput,
      './TerminalView': { default: 'TerminalView' },
    })
    const render = () =>
      hooks.render(() =>
        BackgroundTerminals({
          chat: {
            id: `${host}:task`,
            taskId: 'task',
            computerId: host,
            title: 'Selected task',
            executionState: 'idle',
          },
          open,
          onOpen: () => {
            open = true
          },
          onClose: () => {
            open = false
          },
        }),
      )
    const emit = (channel, value, id = host) => {
      for (const callback of [...(listeners.get(id) ?? [])]) callback(channel, value)
    }
    const select = async () => {
      render()
      await settle()
      find(render(), 'Row').props.onPress()
      render()
      await settle()
      return render()
    }
    return {
      render,
      select,
      emit,
      calls,
      alerts,
      hooks,
      store,
      listeners,
      setOpen: (value) => {
        open = value
      },
      setHost: (value) => {
        host = value
      },
      setOnline: (value) => {
        online = value
      },
      setRecord: (value) => {
        record = value
      },
      clearSnapshot: () => {
        snapshot = null
      },
    }
  }
  test(`${os} discovers managed commands after the turn ends and inspecting/hiding never opens or closes a shell`, async () => {
    const f = managedFixture({ open: false })
    f.render()
    await settle()
    const badge = nodes(f.render()).find(
      (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Background terminals',
    )
    assert.ok(badge)
    badge.props.onPress()
    f.render()
    await settle()
    find(f.render(), 'Row').props.onPress()
    f.render()
    await settle()
    const view = find(f.render(), 'TerminalView')
    assert.equal(view.props.enabled, false)
    assert.equal(view.props.output, 'abc')
    view.props.onInput('must-not-run\r')
    view.props.onResize(80, 24)
    find(f.render(), 'Sheet').props.onClose()
    f.render()
    await settle()
    assert.equal(f.listeners.get('a').size, 1, 'closing output leaves only the count subscription')
    assert.ok(f.calls.every(([, method]) => ['term.background.list', 'term.background.inspect'].includes(method)))
    assert.equal(f.store.drafts.message, 'keep this draft')
    f.hooks.dispose()
  })
  test(`${os} hydrates output without duplicates and ignores data from another host or command`, async () => {
    const response = deferred()
    const f = managedFixture({ snapshot: response })
    f.render()
    await settle()
    find(f.render(), 'Row').props.onPress()
    f.render()
    f.emit('term:data', { id: 'command', data: 'bcd', cursor: 4 })
    f.emit('term:data', { id: 'command', data: 'cdef', cursor: 6 })
    f.emit('term:data', { id: 'command', data: 'cdef', cursor: 6 })
    f.emit('term:data', { id: 'other', data: 'wrong-command', cursor: 100 })
    response.resolve({
      id: 'command',
      taskId: 'task',
      cwd: '/checkout',
      command: 'pnpm dev',
      state: 'running',
      startedAt: 1,
      exitCode: null,
      cursor: 3,
      output: 'abc',
      capabilities: { inspect: true, stop: true, forceStop: true, input: true },
    })
    await settle()
    assert.equal(find(f.render(), 'TerminalView').props.output, 'abcdef')
    f.emit('term:data', { id: 'command', data: 'cdef', cursor: 6 })
    f.emit('term:data', { id: 'command', data: 'BAD', cursor: 9 }, 'b')
    assert.equal(find(f.render(), 'TerminalView').props.output, 'abcdef')
    f.emit('term:data', { id: 'command', data: 'ij', cursor: 10 })
    assert.equal(find(f.render(), 'TerminalView').props.output, 'ij')
    assert.equal(find(f.render(), 'TerminalView').props.cursor, 10)
    f.hooks.dispose()
  })
  test(`${os} requires fresh stop capabilities and explicit force approval without replaying launches`, async () => {
    const f = managedFixture()
    let tree = await f.select()
    const stop = nodes(tree).find((node) => node.type === 'Button' && node.props.title === 'Stop')
    stop.props.onPress()
    stop.props.onPress()
    await settle()
    f.render()
    await settle()
    tree = f.render()
    assert.equal(f.calls.filter(([, method]) => method === 'term.background.stop').length, 1)
    assert.deepEqual(
      f.calls.find(([, method]) => method === 'term.background.stop'),
      ['a', 'term.background.stop', 'task', 'command', false],
    )
    const force = nodes(tree).find((node) => node.type === 'Button' && node.props.title === 'Force stop')
    force.props.onPress()
    assert.equal(f.calls.filter(([, method]) => method === 'term.background.stop').length, 1)
    const approve = f.alerts[0][2].find((button) => button.text === 'Force stop')
    approve.onPress()
    await settle()
    f.render()
    await settle()
    assert.equal(f.calls.filter(([, method]) => method === 'term.background.stop').length, 2)
    assert.equal(f.calls.findLast(([, method]) => method === 'term.background.stop')[4], true)
    assert.ok(f.calls.every(([, method]) => method.startsWith('term.background.')))
    f.hooks.dispose()
  })
  test(`${os} leaves unknown records read-only and disables cached controls while offline`, async () => {
    const unknown = managedFixture({
      record: { state: 'unknown', capabilities: { inspect: true, stop: false, forceStop: false, input: false } },
    })
    let tree = await unknown.select()
    assert.equal(find(tree, 'TerminalView').props.enabled, false)
    assert.equal(
      nodes(tree).some((node) => node.type === 'Button' && ['Stop', 'Force stop'].includes(node.props.title)),
      false,
    )
    unknown.hooks.dispose()
    const f = managedFixture()
    await f.select()
    f.setOnline(false)
    f.render()
    tree = f.render()
    assert.equal(nodes(tree).find((node) => node.type === 'Button' && node.props.title === 'Stop').props.disabled, true)
    assert.equal(
      f.calls.some(([, method]) => method === 'term.background.stop'),
      false,
    )
    f.hooks.dispose()
  })
  test(`${os} rejects stale inspection responses and force confirmations after leaving a host`, async () => {
    const response = deferred()
    const f = managedFixture({ snapshot: response })
    f.render()
    await settle()
    find(f.render(), 'Row').props.onPress()
    f.render()
    f.setHost('b')
    f.render()
    await settle()
    f.render()
    response.resolve({ id: 'command', taskId: 'task', output: 'host-a-secret', cursor: 13 })
    await settle()
    assert.equal(find(f.render(), 'TerminalView'), undefined)
    assert.equal(f.listeners.get('a').size, 0)
    f.hooks.dispose()
    const stopping = managedFixture({ record: { state: 'stopping' } })
    const tree = await stopping.select()
    nodes(tree)
      .find((node) => node.type === 'Button' && node.props.title === 'Force stop')
      .props.onPress()
    stopping.setOpen(false)
    stopping.render()
    stopping.alerts[0][2].find((button) => button.text === 'Force stop').onPress()
    await settle()
    assert.equal(
      stopping.calls.some(([, method]) => method === 'term.background.stop'),
      false,
    )
    stopping.hooks.dispose()
  })
  test(`${os} explains an older host without creating a terminal`, async () => {
    const f = managedFixture({
      invoke: async () => {
        throw new Error('Unknown method term.background.list')
      },
    })
    f.render()
    await settle()
    const tree = f.render()
    assert.ok(
      nodes(tree).some(
        (node) =>
          node.type === 'T' && node.props.children === 'Update Ramu on this host to manage background commands.',
      ),
    )
    assert.equal(find(tree, 'TerminalView'), undefined)
    assert.deepEqual(
      f.calls.map(([, method]) => method),
      ['term.background.list'],
    )
    f.hooks.dispose()
  })
}

for (const os of ['ios', 'android']) {
  test(`${os} ordinary terminal tabs never adopt managed command records`, async () => {
    const hooks = hookHarness(),
      calls = []
    const store = {
      computers: [{ id: 'a', status: 'online', name: 'Host A' }],
      chats: [],
      projects: [],
      invoke: async (...args) => {
        calls.push(args)
        if (args[1] === 'term.list')
          return [{ id: 'background', taskId: 'task', repoId: null, cwd: '/checkout', exited: true, background: true }]
        if (args[1] === 'term.open')
          return { id: 'ordinary', taskId: 'task', repoId: null, cwd: '/checkout', exited: false }
        if (args[1] === 'term.snapshot') return { output: 'ordinary-output', cursor: 15, exited: false }
        throw new Error(`Unexpected ${args[1]}`)
      },
      subscribe: () => () => {},
    }
    const { TerminalScreen } = load('components/TerminalScreen.tsx', os, {
      react: hooks.react,
      'react-native': { Keyboard: { addListener: () => ({ remove() {} }) } },
      '../runtime/store': { useStore: () => store },
      '../runtime/terminalKeys': terminalKeys,
      './TerminalView': { default: 'TerminalView' },
    })
    const render = () => hooks.render(() => TerminalScreen({ computerId: 'a', ctx: 'task', onBack() {} }))
    render()
    await settle()
    render()
    await settle()
    assert.equal(find(render(), 'TerminalView').props.session, 'ordinary')
    assert.equal(
      calls.some(([, method, id]) => method === 'term.snapshot' && id === 'background'),
      false,
    )
    assert.ok(
      calls.some(([, method]) => method === 'term.open'),
      'opening the ordinary Terminal screen remains an explicit shell action',
    )
    hooks.dispose()
  })
}

for (const os of ['ios', 'android']) {
  test(`${os} thread rows expose approval priority, old-host input and offline last-known status without changing navigation`, () => {
    let destination
    let online = true
    const goalHold = load('../../../packages/shared/src/chat/goalHold.ts', os)
    const status = load('../../../packages/shared/src/chat/threadStatus.ts', os, { './goalHold': goalHold })
    const strings = {
      threadApproval: 'Approval',
      threadApprovalFull: 'Approval needed',
      threadInput: 'Needs input',
      threadInputFull: 'Waiting for your input',
      threadOffline: 'Offline · last-known activity',
      offline: 'Offline',
    }
    const { ChatRow } = load('components/ChatRow.tsx', os, {
      react: { memo: (component) => component, useState: () => [false, () => {}] },
      'expo-router': {
        useRouter: () => ({
          push: (route) => {
            destination = route
          },
        }),
      },
      '@ramu/shared/chat/threadStatus': status,
      '../i18n': { useT: () => strings, ago: () => 'now' },
      '../runtime/store': {
        useStore: () => ({ isOnline: () => online, inbox: { a: [{ kind: 'done', sessionId: 's' }] } }),
      },
      './ChatActions': { useChatCommands: () => ({}), ChatActionsSheet: 'ChatActionsSheet' },
      './SwipeRow': { SwipeRow: 'SwipeRow' },
      './ui': { Row: 'Row', T: 'T', StatusIcon: 'StatusIcon' },
    })
    const chat = {
      id: 'a:t',
      taskId: 't',
      computerId: 'a',
      title: 'Build',
      status: 'idle',
      sessionId: 's',
      pinnedAt: null,
      items: [],
      inputSummary: { count: 1, approvals: 1, requests: [] },
    }
    let tree = ChatRow({ chat })
    assert.equal(find(tree, 'Row').props.accessibilityLabel, 'Build, Approval needed')
    assert.equal(find(tree, 'StatusIcon').props.status, 'needs-input')
    assert.ok(nodes(tree).some((node) => node.type === 'T' && node.props.children === 'Approval'))
    find(tree, 'Row').props.onPress()
    assert.deepEqual(JSON.parse(JSON.stringify(destination)), { pathname: '/chat/[id]', params: { id: 'a:t' } })
    online = false
    tree = ChatRow({ chat })
    assert.match(find(tree, 'Row').props.accessibilityLabel, /Offline · last-known activity/)
    assert.ok(nodes(tree).some((node) => node.type === 'T' && node.props.children === 'Offline'))
    tree = ChatRow({ chat: { ...chat, status: 'needs-input', inputSummary: undefined } })
    assert.match(find(tree, 'Row').props.accessibilityLabel, /Waiting for your input/)
    assert.ok(!nodes(tree).some((node) => node.type === 'T' && node.props.children === 'Approval'))
  })
}
