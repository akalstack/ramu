import { runsBy } from '../src/runtime/groupRuns.ts'
import * as hostConnection from '../src/runtime/hostConnection.ts'
import * as toolActivity from '../../../packages/shared/src/chat/toolActivity.ts'
import * as recentThreads from '../src/runtime/recentThreads.ts'
import * as sendJournal from '../src/runtime/sendJournal.ts'
import * as goalVerify from '../src/runtime/goalVerify.ts'
import * as threadGroups from '../src/runtime/threadGroups.ts'
import * as sideChat from '../src/runtime/sideChat.ts'
import * as scrollSurface from '../src/runtime/scrollSurface.ts'
import * as mobileTranscript from '../src/runtime/transcript.ts'
import * as chatViewport from '../src/runtime/chatViewport.ts'
import * as transcriptChanges from '../src/runtime/transcriptChanges.ts'
import * as phoneBehavior from '../src/runtime/busyMode.ts'
import * as chatPresentation from '../../../packages/shared/src/chat/presentation.ts'
import * as browserViewerState from '../src/runtime/browserViewerState.ts'
import * as browserBridge from '../../../packages/shared/src/browserBridge.ts'
import * as remoteKeyboard from '../src/runtime/remoteKeyboard.ts'
import * as computerGestures from '../src/runtime/computerGestures.ts'
import * as sharedViewerAccess from '../../../packages/shared/src/viewerAccess.ts'
import * as viewerAccess from '../src/runtime/viewerAccess.ts'
import * as scheduleModel from '../src/runtime/scheduleModel.ts'
import { goBackOrHome } from '../src/runtime/navigation.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as settingsModel from '../src/runtime/settingsModel.ts'
import * as taskRemoval from '../../../packages/shared/src/chat/taskRemoval.ts'
import * as terminalOutput from '../../../packages/shared/src/workspace/terminalOutput.ts'
import * as sharedMcp from '../../../packages/shared/src/mcp.ts'
import * as terminalKeys from '../src/runtime/terminalKeys.ts'
import * as workspaceDefaults from '../../../packages/shared/src/workspaceDefaults.ts'
import * as workspaceChoices from '../src/runtime/workspaces.ts'
import * as explorerScopes from '../../../packages/shared/src/workspace/explorer.ts'
import * as explorerNavigation from '../src/runtime/explorerNavigation.ts'
import * as routingDraft from '../src/runtime/routingDraft.ts'
import * as otherHostTargets from '../src/runtime/otherHostTargets.ts'
import * as correlation from '../src/runtime/correlationId.ts'
import * as browserLinks from '../../../packages/shared/src/browserLinks.ts'
import * as explorerDrafts from '../src/runtime/composerDrafts.ts'
import * as routingChoices from '../src/runtime/routingChoices.ts'
import * as localCommitStorage from '../src/storage/localCommit.ts'
import * as fileContextKeys from '../../../packages/shared/src/chat/fileContext.ts'
import * as replyPreviews from '../../../packages/shared/src/chat/replyPreview.ts'
import * as composerTriggers from '../../../packages/shared/src/chat/composerTrigger.ts'
import * as agentDraftModel from '../../../packages/shared/src/workspace/agentDefaults.ts'

const require = createRequire(import.meta.url)
const palette = new Proxy({}, { get: (_, key) => String(key) })
const theme = {
  useTheme: () => ({ c: palette, scheme: 'light', textSize: 'normal' }),
  TEXT_SCALE: { normal: 1 },
  font: { body: 15, control: 13, caption: 12 },
  radius: { s: 8, m: 12, full: 999 },
  space: { s: 8, m: 12, l: 16, xl: 24 },
}
const components = new Proxy({}, { get: (_, key) => String(key) })
const Toolbar = Object.assign(() => {}, {
  SearchBarSlot: 'NativeSearchSlot',
  Button: 'ToolbarButton',
  Menu: 'ToolbarMenu',
  MenuAction: 'ToolbarMenuAction',
  View: 'ToolbarView',
})
const Stack = { SearchBar: 'NativeSearch', Screen: 'StackScreen', Toolbar }

// Render the actual TSX at the native boundary, without needing a device for event regressions.
/** Selecting threads is off: rows and the Threads screen render as they do outside Select. */
const threadSelectionStub = {
  threadSelection: { start() {}, toggle() {}, keep() {}, clear() {} },
  useThreadSelection: () => ({ on: false, ids: new Set() }),
}

function load(file, os, overrides = {}, globals = {}) {
  const module = { exports: {} }
  const native = {
    ...components,
    useWindowDimensions: () => ({ width: 400, height: 800 }),
    View: 'View',
    ActivityIndicator: 'ActivityIndicator',
    ScrollView: 'ScrollView',
    KeyboardAvoidingView: 'KeyboardAvoidingView',
    Modal: 'Modal',
    Keyboard: { dismiss() {} },
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
    '../runtime/scrollSurface': scrollSurface,
    './transcript': mobileTranscript,
    './chatViewport': chatViewport,
    './transcriptChanges': transcriptChanges,
    'react-native': native,
    '@ramu/shared/i18n': {
      translate: (_language, text, params = {}) =>
        text.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? `{${key}}`)),
    },
    'expo-router': { Stack, useLocalSearchParams: () => ({}), useRouter: () => ({ push() {} }), useFocusEffect() {} },
    'lucide-react-native': components,
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    'react-native-screens/experimental': {},
    '../runtime/useDictation': {
      useVoiceSettings: () => [{}],
      useVoiceCapability: () => ({}),
      useMicControl: () => ({ kind: 'hidden' }),
      useDictation: () => ({ snapshot: { state: { phase: 'idle' } }, session: { cancel() {} } }),
    },
    '@ramu/shared/voice/dictation': { dictationBusy: () => false },
    '@ramu/shared/sharedFields': { sharedValue: () => undefined },
    '@ramu/shared/hostInbox': { inboxBlocker: () => null },
    '../runtime/busyMode': {
      BUSY_MODE_DEVICE_KEY: 'pref-device:queueWhileBusy',
      resolveBusyMode: () => ({ mode: 'steer', source: 'default' }),
      otherBusyMode: () => 'queue',
    },
    '../runtime/computerUse': { useComputerUse: () => ({ session: undefined, refresh() {} }) },
    '../runtime/threadSelection': threadSelectionStub,
    '../../../runtime/threadSelection': threadSelectionStub,
    '../../../components/BulkThreadActions': { useBulkThreadActions: () => ({ writable: () => false }) },
    'expo-glass-effect': {
      isGlassEffectAPIAvailable: () => true,
      isLiquidGlassAvailable: () => true,
      GlassView: 'NativeGlass',
    },
    'expo-blur': { BlurView: 'BlurView' },
    // Sheets size their hosted content to the sheet; a fixed phone width keeps their trees plain to inspect.
    './hostedWidth': { useHostedWidth: () => ({ width: 390, onLayout() {} }) },
    ...overrides,
  }
  mocks['react-native'] = { ...native, ...mocks['react-native'] }
  mocks['expo-router'] = {
    Stack,
    useLocalSearchParams: () => ({}),
    useRouter: () => ({ push() {} }),
    useFocusEffect() {},
    ...mocks['expo-router'],
  }
  const code = ts.transpileModule(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), {
    compilerOptions: {
      esModuleInterop: false,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  runInNewContext(code, {
    URL,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (callback) => setTimeout(callback, 0),
    cancelAnimationFrame: clearTimeout,
    ...globals,
    exports: module.exports,
    require: (id) => {
      // Copy translated at its call site reads English in tests unless a test supplies its own.
      if (id.endsWith('/i18n') && id in mocks && !mocks[id].useSay)
        return { ...mocks[id], useSay: () => (text) => text }
      if (id.endsWith('/i18n') && !(id in mocks))
        return { useT: () => ({}), useSay: () => (text) => text, ago: () => '' }
      if (id in mocks) return mocks[id]
      // Opening a referenced file navigates; tests that follow a tap supply their own opener.
      if (id.endsWith('/runtime/openFile'))
        return {
          useOpenLink: () => async () => false,
          useOpenFile: () => ({
            open() {},
            async openLink() {
              return false
            },
          }),
        }
      // Logins name themselves only when a host answers; tests that need names supply them.
      if (id.endsWith('/useAccountLogins')) return { useAccountLogins: () => ({}) }
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
      if (id === '@ramu/shared/browserLiveViewer')
        return load('../../../packages/shared/src/browserLiveViewer.ts', os, {}, globals)
      if (id === '@ramu/shared/browserLinks') return browserLinks
      if (id === '@ramu/shared/browserBridge') return browserBridge
      if (id === '@ramu/shared/chat/toolActivity') return toolActivity
      if (id === './sendJournal') return sendJournal
      if (id === '@ramu/shared/mapBounded') return { mapBounded: (items, _limit, run) => Promise.all(items.map(run)) }
      if (id === './goalVerify') return goalVerify
      if (id === '@ramu/shared/sync/streamSync')
        return load('../../../packages/shared/src/sync/streamSync.ts', os, {}, globals)
      if (id === '../../../runtime/recentThreads') return recentThreads
      if (id === '../../../runtime/threadGroups') return threadGroups
      if (id === '../../../runtime/sideChat') return sideChat
      if (id === '@ramu/shared/chat/presentation') return chatPresentation
      if (id === '@ramu/shared/viewerAccess') return sharedViewerAccess
      if (id.endsWith('/browserViewerState')) return browserViewerState
      if (id.endsWith('/remoteKeyboard')) return remoteKeyboard
      if (id.endsWith('/computerGestures')) return computerGestures
      if (id.endsWith('/ViewerChrome'))
        return new Proxy(
          { useViewerMenu: () => ({ anchor: { current: null }, at: null, open() {}, close() {} }) },
          { get: (target, key) => (key in target ? target[key] : String(key)) },
        )
      if (id.endsWith('/viewerAccess')) return viewerAccess
      if (id.endsWith('/navigation')) return { goBackOrHome }
      if (id.endsWith('/composerDrafts')) return explorerDrafts
      if (id.endsWith('/routingChoices')) return routingChoices
      if (id.endsWith('/explorerNavigation')) return explorerNavigation
      if (id.endsWith('/routingDraft')) return routingDraft
      if (id.endsWith('/otherHostTargets')) return otherHostTargets
      if (id.endsWith('/correlationId')) return correlation
      if (id === '@ramu/shared/chat/fileContext') return fileContextKeys
      if (id === '@ramu/shared/chat/replyPreview') return replyPreviews
      if (id === '@ramu/shared/chat/composerTrigger') return composerTriggers
      if (id.endsWith('/Screen'))
        return new Proxy(
          { useScrolledUnderBar: () => ({ scrolled: false, onScroll() {} }) },
          { get: (target, key) => (key in target ? target[key] : String(key)) },
        )
      if (id.endsWith('/theme')) return theme
      // Builds without the native Markdown view, as in Expo Go: messages keep the React Native renderer and its selection.
      if (id.endsWith('/NativeMarkdown'))
        return { nativeMarkdown: false, MessageSelectionMenuContext: require('react').createContext(null) }
      // A thread's status line and origin read from the real rules; bulk thread actions only run when a test taps them.
      if (id === '@ramu/shared/chat/threadStatus' || id === './threadStatus')
        return load('../../../packages/shared/src/chat/threadStatus.ts', os, {}, globals)
      if (id === './goalHold') return load('../../../packages/shared/src/chat/goalHold.ts', os, {}, globals)
      if (id === '@ramu/shared/chat/scheduleRuns')
        return load('../../../packages/shared/src/chat/scheduleRuns.ts', os, {}, globals)
      if (id === '@ramu/shared/workspace/threadOrigin') return { threadOriginLabel: () => 'Started by another thread' }
      if (id.endsWith('/BulkThreadActions'))
        return { useBulkThreadActions: () => ({ archive: async () => {}, markDone: async () => {} }) }
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

for (const os of ['ios', 'android']) {
  test(`${os} mobile browser status reads its host and opens only deliberately selected public websites`, async () => {
    const hooks = hookHarness(),
      calls = [],
      opened = []
    const store = {
      language: 'en',
      computers: [{ id: 'a', name: 'Laptop' }],
      isOnline: () => true,
      mayUse: () => true,
      invoke: async (...args) => {
        calls.push(args)
        if (args[1] === 'hostBrowser.status') return { available: false }
        return {
          available: true,
          tabs: [
            { id: 'public', title: 'Public', url: 'https://www.example.com', controller: 'agent' },
            { id: 'local', title: 'Local', url: 'http://localhost:3000', controller: 'agent' },
          ],
          externalURLs: ['https://www.example.com'],
        }
      },
    }
    const { BrowserActivity } = load('components/BrowserActivity.tsx', os, {
      react: hooks.react,
      '../runtime/store': { useStore: () => store },
      '@ramu/shared/browserLinks': browserLinks,
      'react-native': {
        Linking: {
          openURL: async (url) => {
            opened.push(url)
          },
        },
      },
    })
    let open = false
    const render = () =>
      hooks.render(() =>
        BrowserActivity({
          chat: { computerId: 'a', taskId: 'thread' },
          open,
          onClose: () => {
            open = false
          },
        }),
      )
    const button = (title) =>
      nodes(render()).find(
        (node) => (node.type === 'Button' || node.type?.name === 'ContentAction') && node.props.title === title,
      )
    render()
    assert.equal(calls.length, 0)
    assert.equal(button('Browser'), undefined)
    open = true
    render()
    await settle()
    assert.deepEqual(calls, [
      ['a', 'hostBrowser.status'],
      ['a', 'browser.activity', 'thread'],
    ])
    const external = nodes(render()).filter(
      (node) => node.type === 'Button' && node.props.title === 'Open in system browser',
    )
    assert.equal(external.length, 1)
    assert.deepEqual(opened, [])
    external[0].props.onPress()
    await settle()
    assert.deepEqual(opened, ['https://www.example.com'])
    assert.ok(
      nodes(render()).some(
        (node) => node.props.children === 'Open this local or private address on its owning computer.',
      ),
    )
    hooks.dispose()
  })
}

test('the phone opens its host browser directly inside the menu screen', async () => {
  const hooks = hookHarness()
  const store = {
    language: 'en',
    computers: [{ id: 'a', name: 'Laptop' }],
    isOnline: () => true,
    mayUse: () => true,
    invoke: async (_host, method) =>
      method === 'hostBrowser.status' ? { enabled: true, available: false } : { available: true, tabs: [] },
  }
  const { BrowserActivity } = load('components/BrowserActivity.tsx', 'ios', {
    react: hooks.react,
    '../runtime/store': { useStore: () => store },
    '@ramu/shared/browserLinks': browserLinks,
  })
  const render = () =>
    hooks.render(() => BrowserActivity({ chat: { computerId: 'a', taskId: 'thread' }, open: true, onClose() {} }))
  render()
  await settle()
  const tree = render()
  // The browser owns one full-screen surface, without a sheet header above its own chrome.
  assert.equal(find(tree, 'ViewerScreen').props.open, true)
  assert.ok(!nodes(tree).some((node) => node.type === 'Sheet'))
  assert.equal(find(tree, 'BrowserViewer').props.hostManaged, true)
  assert.ok(!nodes(tree).some((node) => node.type === 'Button' && node.props.title === 'View host browser'))
  hooks.dispose()
})

test('a destination clarification keeps the composer draft instead of acknowledging a send', async () => {
  const hooks = hookHarness()
  let cleared = 0,
    sent = 0
  const store = {
    selected: 'a',
    computers: [{ id: 'a', status: 'online' }],
    projects: [],
    chats: [],
    missingMethods: {},
    appPreferences: {},
    drafts: { 'a:new:none': 'Fix login' },
    isOnline: () => true,
    mayUse: () => true,
    setDraft: (key, value) => {
      store.drafts[key] = value
    },
    clearComposerDraft: () => {
      cleared++
      return true
    },
  }
  const { Composer } = load('components/Composer.tsx', 'ios', {
    react: hooks.react,
    './ui': new Proxy({}, { get: (_, key) => (key === 'tap' ? () => {} : String(key)) }),
    '@ramu/shared/chat/composerDraft': {
      composerDraft: (text) => ({ chips: [], segments: [{ kind: 'text', source: text }] }),
    },
    '../runtime/store': { useStore: () => store },
    '../i18n': { useT: () => ({}) },
    '../runtime/goalVerify': { canEditVerify: () => false },
    './ComposerSuggest': { useComposerSuggest: () => ({ visible: false }) },
  })
  const render = () =>
    hooks.render(() =>
      Composer({
        computerId: 'a',
        draftKey: 'a:new:none',
        running: false,
        model: { provider: 'claude-code', model: 'opus' },
        onModel() {},
        onSend: async () => {
          sent++
          return false
        },
      }),
    )
  const button = nodes(render()).find((node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Send')
  button.props.onPress()
  await settle()
  assert.equal(sent, 1)
  assert.equal(cleared, 0)
  assert.equal(store.drafts['a:new:none'], 'Fix login')
  hooks.dispose()
})

for (const os of ['ios', 'android']) {
  test(`${os} rule edits retain failed text, enforce explicit scopes and save one revision on the owning host`, async () => {
    const hooks = hookHarness()
    const calls = []
    let finish,
      fail = true,
      closed = 0
    const store = {
      language: 'en',
      computers: [{ id: 'remote', access: 'owner' }],
      projects: [{ id: 'remote:p', computerId: 'remote', name: 'Project' }],
      isOnline: () => true,
      mayUse: () => true,
      invoke: async (...args) => {
        calls.push(args)
        await new Promise((resolve) => {
          finish = resolve
        })
        if (fail) throw Error('Concurrent edit')
      },
    }
    const { RuleEditor } = load('components/RulesSettings.tsx', os, {
      react: hooks.react,
      '../runtime/store': { useStore: () => store },
      '@ramu/shared/types': { RULE_BODY_LIMIT: 8000, RULE_NAME_LIMIT: 120 },
      '@ramu/shared/providers/providers': { AGENT_PROVIDERS: ['codex'], providerName: (id) => id },
    })
    const render = () =>
      hooks.render(() =>
        RuleEditor({
          hostId: 'remote',
          rule: null,
          onClose: () => {
            closed++
          },
          onSaved() {},
        }),
      )
    const button = (title) =>
      nodes(render()).find(
        (node) => (node.type === 'Button' || node.type?.name === 'ContentAction') && node.props.title === title,
      )
    const input = (label) =>
      nodes(render()).find((node) => node.type === 'TextInput' && node.props.accessibilityLabel === label)
    input('Rule name').props.onChangeText('Careful changes')
    input('Rule text').props.onChangeText('Preserve user edits.')
    assert.equal(button('Save').props.disabled, true)
    button('Project').props.onPress()
    const provider = () => nodes(render()).find((node) => node.type === 'ToggleRow' && node.props.title === 'codex')
    provider().props.onChange(true)
    assert.equal(button('Save').props.disabled, false)
    provider().props.onChange(false)
    assert.equal(button('Save').props.disabled, true) // Deselecting the last provider never means all providers.
    provider().props.onChange(true)
    const save = button('Save')
    save.props.onPress()
    save.props.onPress()
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], 'remote')
    assert.equal(calls[0][1], 'rules.save')
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0][2])), {
      name: 'Careful changes',
      body: 'Preserve user edits.',
      projectId: 'p',
      providers: ['codex'],
      activation: 'always',
      enabled: true,
    })
    finish()
    await settle()
    assert.equal(closed, 0)
    assert.equal(input('Rule text').props.value, 'Preserve user edits.')
    assert.ok(nodes(render()).some((node) => node.props.children === 'Error: Concurrent edit'))
    fail = false
    button('Save').props.onPress()
    finish()
    await settle()
    assert.equal(closed, 1)
    hooks.dispose()
  })
}

for (const os of ['ios', 'android']) {
  test(`${os} routing metadata saves on its owner, preserves failed edits and blocks repeated saves`, async () => {
    const hooks = hookHarness()
    const calls = []
    let finish,
      closed = 0,
      fail = true
    const store = {
      language: 'en',
      computers: [{ id: 'remote', access: 'owner' }],
      isOnline: () => true,
      mayUse: () => true,
      refresh: async () => {},
      invoke: async (...args) => {
        calls.push(args)
        await new Promise((resolve) => {
          finish = resolve
        })
        if (fail) throw new Error('Host unavailable')
      },
    }
    const { ProjectRoutingSettings } = load('components/ProjectRoutingSettings.tsx', os, {
      react: hooks.react,
      '../runtime/store': { useStore: () => store },
    })
    const render = () =>
      hooks.render(() =>
        ProjectRoutingSettings({
          project: { id: 'remote:project', computerId: 'remote', name: 'Store', aliases: ['Shop'] },
          onClose: () => {
            closed++
          },
        }),
      )
    const input = () =>
      nodes(render()).find(
        (node) => node.type === 'TextInput' && node.props.accessibilityLabel === 'Other names, separated by commas',
      )
    const save = () => nodes(render()).find((node) => node.type === 'Button' && node.props.title === 'Save')
    input().props.onChangeText('Storefront, Payments')
    const button = save()
    button.props.onPress()
    button.props.onPress()
    assert.equal(calls.length, 1)
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), [
      'remote',
      'projects.setRouting',
      'project',
      ['Storefront', 'Payments'],
      '',
    ])
    finish()
    await settle()
    assert.equal(closed, 0)
    assert.equal(input().props.value, 'Storefront, Payments')
    assert.ok(nodes(render()).some((node) => node.props.children === 'Error: Host unavailable'))
    fail = false
    save().props.onPress()
    finish()
    await settle()
    assert.equal(closed, 1)
    hooks.dispose()
  })
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
    assert.equal(find(Menu(), 'Header').props.align, 'center')
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

test('iOS composite titles use a bounded leading item in the native bar', () => {
  const { Header, Screen } = load('components/Screen.tsx', 'ios')
  const tree = Header({ title: 'A long thread title', subtitle: 'host · project' })
  const options = find(tree, 'StackScreen').props.options
  assert.equal(options.headerTransparent, false)
  assert.equal(options.header, undefined)
  const title = nodes(tree).find((node) => node.props?.children === 'A long thread title')
  const subtitle = nodes(tree).find((node) => node.props?.children === 'host · project')
  assert.equal(title.props.size, 13)
  assert.equal(title.props.numberOfLines, 2)
  assert.equal(subtitle.props.numberOfLines, 1)
  assert.equal(title.props.style.textAlign, 'left')
  assert.equal(subtitle.props.style.textAlign, 'left')
  assert.ok(nodes(tree).some((node) => node.type === 'ToolbarButton' && node.props.icon === 'chevron.left'))
  assert.equal(Screen({ children: 'body', scrollable: false }).props.style.paddingTop, undefined)
})

test('native chat toolbar actions receive taps and keep their supplied symbols', () => {
  let opened = false
  const screen = load('components/Screen.tsx', 'ios', {
    './ui': { tap() {}, T: 'T', Button: 'Button', IconButton: 'IconButton' },
  })
  const { jsx, jsxs } = require('react/jsx-runtime')
  const actions = jsxs(require('react').Fragment, {
    children: [
      jsx(screen.HeaderButton, {
        icon: 'GitBranch',
        label: 'Source Control',
        systemIcon: 'arrow.triangle.branch',
        onPress() {},
      }),
      jsx(screen.HeaderMenu, {
        label: 'Thread actions',
        actions: [
          {
            label: 'Browser',
            onPress: () => {
              opened = true
            },
          },
        ],
        onPress() {},
      }),
    ],
  })
  const tree = screen.Header({ title: 'Thread', scrollEdge: true, right: actions })
  const native = nodes(tree).filter((node) => node.type === 'ToolbarButton')
  assert.equal(native.length, 2)
  assert.equal(native[1].props.accessibilityLabel, 'Source Control')
  const menu = find(tree, 'ToolbarMenu')
  assert.equal(menu.props.icon, 'ellipsis')
  find(menu, 'ToolbarMenuAction').props.onPress()
  assert.equal(opened, true)
  const options = find(tree, 'StackScreen').props.options
  assert.equal(options.headerTransparent, false)
  assert.ok(nodes(tree).some((node) => node.props?.transparent === false))
  assert.ok(
    nodes(tree).some(
      (node) => node.props?.transparent === false && node.props?.largeStyle?.backgroundColor === 'window',
    ),
  )
  assert.equal(options.headerStyle.backgroundColor, 'window')
  assert.equal(options.scrollEdgeEffects.top, 'soft')
  assert.ok(nodes(tree).some((node) => node.props?.style?.width >= 140 && node.props.style.width <= 220))
})

test('computer video does not evaluate WebRTC exports when its native module is absent', () => {
  let touched = false
  const video = load('components/useComputerVideo.ts', 'ios', {
    'react-native': { NativeModules: {} },
    'react-native-webrtc': {
      get RTCPeerConnection() {
        touched = true
        throw new Error('Missing native module')
      },
    },
  })
  assert.equal(video.webrtc(), null)
  assert.equal(video.webrtc(), null)
  assert.equal(touched, false)
})

test('a linked development build can use WebRTC and initialization failure falls back to image frames', () => {
  const hooks = hookHarness()
  const native = {
    RTCPeerConnection: class {
      constructor() {
        throw new Error('Video cannot start')
      }
    },
  }
  const video = load('components/useComputerVideo.ts', 'ios', {
    react: hooks.react,
    'react-native': { NativeModules: { WebRTCModule: {} } },
    'react-native-webrtc': native,
    '../runtime/store': {
      useStore: () => ({
        invoke: async () => {
          throw new Error('No video request expected')
        },
      }),
    },
  })
  assert.equal(video.webrtc(), native)
  const render = () => hooks.render(() => video.useComputerVideo('host', 'thread', true, true))
  render()
  assert.equal(render().status, 'failed')
  hooks.dispose()
})

test('Android complex panels use a full-screen keyboard-aware layout', () => {
  for (const os of ['android']) {
    const hooks = hookHarness()
    const ui = load('components/ui.tsx', os, {
      react: { ...hooks.react, createContext: require('react').createContext },
    })
    const sheet = ui.Sheet({
      open: true,
      title: 'Questions',
      presentation: 'screen',
      onClose() {},
      children: 'answer form',
    })
    const modal = sheet.type(sheet.props)
    assert.equal(modal.props.presentationStyle, 'fullScreen')
    assert.equal(modal.props.visible, true)
    const body = nodes(modal).find((node) => typeof node.type === 'function')
    const keyboard = hooks.render(() => body.type(body.props))
    assert.equal(keyboard.type, 'KeyboardAvoidingView')
    assert.equal(keyboard.props.behavior, 'padding')
    const scroll = find(keyboard, 'ScrollView')
    assert.equal(scroll.props.style.flex, 1)
    assert.equal(scroll.props.keyboardShouldPersistTaps, 'handled')
    assert.equal(nodes(keyboard).find((node) => node.type === ui.IconButton).props.label, 'Close')
  }
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
      useState: (initial) => [
        initial === undefined
          ? undefined
          : typeof initial === 'function' && initial.name === 'readAppearance'
            ? preference
            : typeof initial === 'function'
              ? initial()
              : initial,
        (next) => {
          preference = next
        },
      ],
      useRef: (value) => ({ current: value }),
      useMemo: (compute) => compute(),
      useEffect: (effect) => effect(),
    },
    'react-native': {
      Platform: { select: (values) => values.ios },
      useColorScheme: () => 'light',
      Appearance: { setColorScheme: (scheme) => nativeSchemes.push(scheme) },
    },
    '@ramu/shared/theme': { DEFAULT_THEME: { id: 'default' } },
    '@ramu/shared/themePresets': { themePreset: () => undefined, THEME_PRESETS: [] },
    '../storage': {
      readAppearance: () => preference,
      readTextSize: () => 'normal',
      readSelectedThemeId: () => '',
      readThemeLibraryText: () => '[]',
      saveAppearance: (value) => saved.push(value),
    },
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
      'app/search.tsx',
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
        '../runtime/store': {
          useStore: () => ({
            computers: [],
            projects: [],
            chats: [
              { id: 'a', title: 'Fix search', preview: '', lastActiveAt: 2 },
              { id: 'b', computerId: 'host', taskId: 'pair-task', title: 'Pair a host', preview: '', lastActiveAt: 1 },
            ],
          }),
        },
        '../i18n': { useT: () => ({ search: 'Search threads', recent: 'Recent', chats: 'Threads' }) },
        '../components/Overlays': { useTabActions: () => null },
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
    state[1] = [{ query: 'pair', computerId: 'host', hit: { taskId: 'pair-task', seq: 1, sessionId: 's' } }]
    const results = nodes(render()).filter((node) => node.type === 'ChatRow')
    assert.equal(results.length, 1)
    assert.equal(results[0].props.chat.id, 'b')
    assert.equal(nodes(render()).filter((node) => node.type === 'Row').length, 1)
    search.props.onChangeText({ nativeEvent: { text: 'fix' } })
    assert.equal(
      nodes(render()).filter((node) => node.type === 'Row').length,
      0,
      'old message matches disappear immediately when the query changes',
    )
    search.props.onChangeText({ nativeEvent: { text: 'pair' } })
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

test('new thread with Auto moves to the composer once its host connects after the tab mounted', () => {
  const hooks = hookHarness()
  let keyboard = 0
  let online = false
  let asTab = false
  const destinations = []
  const store = {
    selected: 'a',
    language: 'en',
    computers: [{ id: 'a', name: 'Laptop', status: 'online' }],
    projects: [{ id: 'a:ramu', name: 'ramu', computerId: 'a', root: '/work/ramu', kind: 'repository' }],
    invoke: async () => ({}),
    subscribe: () => () => {},
    drafts: {},
    defaults: {},
    appPreferences: {},
    isOnline: () => online,
    mayUse: () => true,
    setDraft: (key, value) => {
      store.drafts[key] = value
    },
  }
  const { default: NewChat } = load('app/new.tsx', 'ios', {
    react: hooks.react,
    'expo-router': {
      useRouter: () => ({ replace() {}, navigate: (path) => destinations.push(path) }),
      useLocalSearchParams: () => ({}),
    },
    '@ramu/shared/workspaceDefaults': workspaceDefaults,
    '@ramu/shared/workspace/explorer': explorerScopes,
    '../runtime/workspaces': workspaceChoices,
    '../runtime/useWorkspaces': { useWorkspaces: () => ({ rows: [] }) },
    '../runtime/store': { useStore: () => store },
    '../runtime/types': { STANDALONE: 'no-project' },
    '../i18n': { useT: () => ({ newChat: 'New thread' }) },
    '../components/Keyboard': {
      useKeyboardInset: () => keyboard,
      useKeyboardOpen: () => keyboard > 0,
      KeyboardPadding: 'KeyboardPadding',
    },
  })
  const render = () => hooks.render(() => NewChat({ asTab }))
  assert.equal(find(render(), 'Header').props.title, 'Choose a project')
  online = true
  render()
  assert.equal(find(render(), 'Header').props.title, 'New thread')
})

test('new thread switches projects and composer in one flow without losing the draft identity', () => {
  const hooks = hookHarness()
  let keyboard = 0
  let asTab = false
  const destinations = []
  const store = {
    selected: 'a',
    language: 'en',
    computers: [{ id: 'a', name: 'Laptop', status: 'online' }],
    projects: [{ id: 'a:ramu', name: 'ramu', computerId: 'a', root: '/work/ramu', kind: 'repository' }],
    invoke: async () => ({}),
    subscribe: () => () => {},
    drafts: {},
    defaults: {},
    // Auto off: with Auto on the screen opens on the composer instead of this picker.
    appPreferences: { a: { autoProjectSelection: false } },
    isOnline: () => true,
    mayUse: () => true,
    setDraft: (key, value) => {
      store.drafts[key] = value
    },
  }
  const { default: NewChat } = load('app/new.tsx', 'ios', {
    react: hooks.react,
    'expo-router': {
      useRouter: () => ({ replace() {}, navigate: (path) => destinations.push(path) }),
      useLocalSearchParams: () => ({}),
    },
    '@ramu/shared/workspaceDefaults': workspaceDefaults,
    '@ramu/shared/workspace/explorer': explorerScopes,
    '../runtime/workspaces': workspaceChoices,
    '../runtime/useWorkspaces': { useWorkspaces: () => ({ rows: [] }) },
    '../runtime/store': { useStore: () => store },
    '../runtime/types': { STANDALONE: 'no-project' },
    '../i18n': { useT: () => ({ newChat: 'New thread' }) },
    '../components/Keyboard': {
      useKeyboardInset: () => keyboard,
      useKeyboardOpen: () => keyboard > 0,
      KeyboardPadding: 'KeyboardPadding',
    },
  })
  const render = () => hooks.render(() => NewChat({ asTab }))
  let tree = render()
  assert.equal(find(tree, 'Header').props.title, 'Choose a project')
  const project = nodes(find(tree, 'PageScrollView')).find(
    (node) => node.type === 'Row' && nodes(node).some((child) => child.props?.children === 'ramu'),
  )
  project.props.onPress()
  tree = render()
  assert.equal(find(tree, 'Header').props.title, 'New thread')
  let composer = find(tree, 'Composer')
  const draftKey = composer.props.draftKey
  store.drafts[draftKey] = 'Keep this task'
  assert.equal(composer.props.autoFocus, true)
  const back = find(tree, 'Header').props.left
  assert.equal(back.props.label, 'Back to projects')
  assert.equal(back.props.systemIcon, 'chevron.left')
  assert.equal(find(tree, 'Header').props.right.props.label, 'Close')
  back.props.onPress()
  tree = render()
  assert.equal(find(tree, 'Header').props.title, 'Choose a project')
  assert.equal(nodes(tree).filter((node) => node.type === 'Sheet' && node.props.open).length, 0)
  nodes(find(tree, 'PageScrollView'))
    .find((node) => node.type === 'Row' && nodes(node).some((child) => child.props?.children === 'ramu'))
    .props.onPress()
  keyboard = 300
  tree = render()
  composer = find(tree, 'Composer')
  assert.equal(composer.props.draftKey, draftKey)
  assert.equal(store.drafts[draftKey], 'Keep this task')
  // With the keyboard up the same mark and question stay at one size; only their place moves.
  assert.ok(nodes(tree).some((node) => node.type === 'AnimatedMark' && node.props.size === 48))
  assert.ok(
    !nodes(tree).some((node) => typeof node.props?.children === 'string' && node.props.children.startsWith('Runs on ')),
  )
  asTab = true
  keyboard = 0
  // The gap above the tab bar belongs to the keyboard padding, which the rising keyboard takes over (on the UI thread)
  // instead of adding to it, so the composer never lifts farther from the keys.
  assert.equal(
    find(render(), 'KeyboardPadding').props.gap,
    theme.space.m,
    'the composer has an extra gap above the tab bar, without lifting farther from the keyboard',
  )
  asTab = false
  assert.equal(find(render(), 'KeyboardPadding').props.gap, 0)
  asTab = true
  const close = find(render(), 'Header').props.right
  close.props.onPress()
  assert.deepEqual(destinations, ['/'])
  assert.equal(store.drafts[draftKey], 'Keep this task', 'closing the tab keeps its draft')
  hooks.dispose()
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
    mayUse: () => true,
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
    '../components/Keyboard': {
      useKeyboardInset: () => 0,
      useKeyboardOpen: () => 0 > 0,
      KeyboardPadding: 'KeyboardPadding',
    },
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
    computers: [{ id: 'remote', status: 'online' }],
    isOnline: () => online,
    mayUse: () => true,
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
      mayUse: () => true,
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
      '../components/Keyboard': {
        useKeyboardInset: () => 0,
        useKeyboardOpen: () => 0 > 0,
        KeyboardPadding: 'KeyboardPadding',
      },
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
    // Files for the message come from + → Add a host file in this scope; the tray has no separate Browse files.
    assert.equal(
      nodes(composer.props.header).some((node) => node.props?.label === 'Browse files'),
      false,
    )
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
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
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
      mayUse: () => true,
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
      './SheetOptions': { SheetGroup: 'SheetGroup', SheetOption: 'SheetOption' },
      react: hooks.react,
      '@ramu/shared/usage/presentation': presentation,
      '@ramu/shared/providers/providers': providers,
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

test('usage refresh explains a failure, preserves data and opens the selected host settings', async () => {
  const presentation = await import('../../../packages/shared/src/usage/presentation.ts')
  const providers = await import('../../../packages/shared/src/providers/providers.ts')
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
    mayUse: () => true,
    subscribe: () => () => {},
    select: (id) => {
      selected = id
    },
    invoke: async (host, method) => {
      calls.push([host, method])
      if (method === 'usage.refresh') throw Error('Refresh refused')
      return [reading]
    },
  }
  const { PlanUsageSheet, PlanUsageReading } = load('components/PlanUsage.tsx', 'android', {
    './SheetOptions': { SheetGroup: 'SheetGroup', SheetOption: 'SheetOption' },
    react: hooks.react,
    'expo-router': { useRouter: () => ({ push: (path) => destinations.push(path) }) },
    '@ramu/shared/usage/presentation': presentation,
    '@ramu/shared/providers/providers': providers,
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
  assert.ok(
    nodes(tree).some(
      (node) => typeof node.props?.children === 'string' && node.props.children.includes('Refresh unavailable'),
    ),
  )
  nodes(tree)
    .find((node) => node.type === 'SheetOption' && node.props.title === 'Models & access settings')
    .props.onPress()
  assert.equal(selected, 'a')
  assert.equal(closed, 1)
  assert.deepEqual(destinations, ['/settings/providers'])
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
      drafts: {},
      rememberExplorer() {},
      projects: [{ id: 'remote:p', computerId: 'remote', name: 'Project' }],
      computers: [{ id: 'remote', name: 'Server' }],
      isOnline: () => true,
      mayUse: () => true,
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
    appPreferences: {},
    isOnline: () => true,
    mayUse: () => true,
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
  test(`${os} new-thread skill discovery uses the selected checkout and late results cannot open another scope's picker`, async () => {
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
      mayUse: () => true,
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
    const { Composer } = load(
      'components/Composer.tsx',
      os,
      {
        react: hooks.react,
        './ui': new Proxy({}, { get: (_, key) => (key === 'tap' ? () => {} : String(key)) }),
        './SheetOptions': { SheetGroup: 'SheetGroup', SheetOption: 'SheetOption' },
        '@ramu/shared/chat/composerDraft': {
          composerDraft: (text) => ({ chips: [], segments: [{ kind: 'text', source: text }] }),
        },
        '../runtime/store': { useStore: () => store },
        '../i18n': { useT: () => ({}) },
        '../runtime/goalVerify': { canEditVerify: () => false },
        './ComposerSuggest': { useComposerSuggest: () => ({ visible: false }) },
      },
      // The menu's next step waits for the sheet to close; run it at once here.
      {
        setTimeout: (run) => {
          run()
          return 0
        },
        clearTimeout() {},
      },
    )
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
    const action = (tree, text) => nodes(tree).find((node) => node.type === 'SheetOption' && node.props.title === text)
    render()
    assert.equal(action(render(), 'Add a host file'), undefined)
    assert.equal(action(render(), 'Enter a command'), undefined)
    action(render(), 'Use a skill').props.onPress()
    assert.equal(requests[0].scope, 'worktree:w')
    assert.equal(requests[0].method, 'skills.list')
    props = { ...props, scope: 'worktree:other' }
    render()
    requests[0].resolve([{ name: 'Old skill', description: 'Old', path: 'old.md' }])
    await settle()
    assert.equal(
      nodes(render()).some((node) => node.type === 'Sheet' && node.props.open && node.props.title === 'Host skills'),
      false,
    )
    action(render(), 'Use a skill').props.onPress()
    requests[1].resolve([{ name: 'New skill', description: 'New', path: 'new.md' }])
    await settle()
    action(render(), 'New skill').props.onPress()
    render()
    assert.match(store.drafts['host:new:p'], /Use the host skill at new.md/)
    assert.equal(sent, undefined, 'adding context never submits the message')
    nodes(render())
      .find((node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Send')
      .props.onPress()
    await settle()
    assert.match(sent[0], /Review this file[\s\S]*Use the host skill at new.md/)
    assert.equal(requests[1].scope, 'worktree:other')
    hooks.dispose()
  })
}

test('workspace catalogs discard late hosts, explain failures and clear disconnected scope', async () => {
  const hooks = hookHarness()
  const requests = [],
    listeners = new Map()
  let online = true
  const store = {
    isOnline: () => online,
    mayUse: () => true,
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
  })
  let host = 'a'
  const render = () => hooks.render(() => useWorkspaces(host))
  render()
  host = 'b'
  render()
  requests[0].resolve([{ id: 'w', projectId: 'p', name: 'Wrong host' }])
  await settle()
  assert.equal(render().rows.length, 0)
  requests[1].reject(Error('Could not list workspaces'))
  await settle()
  assert.match(render().error, /Could not list workspaces/)
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
      mayUse: () => true,
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
      './SheetOptions': { SheetGroup: 'SheetGroup', SheetOption: 'SheetOption' },
      '../runtime/groupRuns': { runsBy },
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
      nodes(tree).find((node) => node.type === 'SheetOption' && node.props.title === label)
    let row = action(render(), labels.namingThread)
    assert.equal(row.props.onPress, undefined)
    assert.equal(row.props.disabled, true)
    chat = { ...chat, titleGenerationState: 'failed' }
    row = action(render(), labels.retryTitleGeneration)
    assert.equal(row.props.disabled, false)
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
    assert.equal(row.props.disabled, true)
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
      mayUse: () => true,
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
    const adding = button.props.onPress()
    button.props.onPress()
    await adding
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
      mayUse: () => true,
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
    await action().props.onPress()
    assert.equal(destinations.length, 0)
    assert.equal(store.drafts['host:new:host:p'], 'Urgent unrelated draft')
    assert.ok(nodes(render()).some((node) => node.props?.children === labels.fileDraftFailed))
    fail = false
    await action().props.onPress()
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
    mayUse: () => true,
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
      drafts: {},
      rememberExplorer() {},
      projects: [],
      computers: [
        { id: 'a', name: 'Laptop' },
        { id: 'b', name: 'Server' },
      ],
      isOnline: () => true,
      mayUse: () => true,
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
      // Each repository is a root row (path '') with its tree one level below.
      [
        ['r1', ''],
        ['r1', 'README.md'],
        ['r2', ''],
        ['r2', 'src'],
        ['r2', 'src/deep'],
        ['r2', 'src/deep/README.md'],
      ],
    )
    assert.deepEqual(
      list.props.data.map((row) => row.depth),
      [0, 1, 0, 1, 2, 3],
    )
    const targetRow = list.props.renderItem({ item: list.props.data[5] })
    assert.equal(targetRow.props.accessibilityState.selected, true)
    assert.equal(list.props.renderItem({ item: list.props.data[1] }).props.accessibilityState.selected, false)
    for (const callback of frames.values()) callback()
    frames.clear()
    assert.equal(scrolls.at(-1).index, 5)
    nodes(find(tree, 'Header').props.right)
      .find((node) => node.type === 'HeaderButton' && node.props.label === 'Collapse')
      .props.onPress()
    // Collapse leaves only the repository roots; opening one shows its top level again.
    let collapsed = find(render(), 'PageFlatList')
    assert.deepEqual(
      collapsed.props.data.map((row) => [row.repoId, row.entry.path]),
      [
        ['r1', ''],
        ['r2', ''],
      ],
    )
    collapsed.props.renderItem({ item: collapsed.props.data[0] }).props.onPress()
    collapsed = find(render(), 'PageFlatList')
    assert.deepEqual(
      collapsed.props.data.map((row) => row.entry.path),
      ['', 'README.md', ''],
    )
    collapsed.props.renderItem({ item: collapsed.props.data[0] }).props.onPress()
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
    mayUse: () => true,
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
    '../runtime/goalVerify': { canEditVerify: () => false },
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
      mayUse: () => true,
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
    mayUse: () => true,
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
  await nodes(render())
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
    '../runtime/goalVerify': { canEditVerify: () => false },
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
    const store = {
      computers: [{ id: 'a', status: 'online' }],
      projects: [{ id: 'a:p', computerId: 'a' }],
      chats: [],
      isOnline: () => true,
      mayUse: () => true,
      invoke: async (...args) => {
        calls.push(args)
        if (scenario === 'unsupported') throw Error('Bindings refused')
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
        '../i18n': { useT: () => ({ fileNoGit: 'No Git in this folder' }) },
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
      assert.ok(nodes(tree).some((node) => String(node.props?.children).includes('Bindings refused')))
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
    mayUse: () => true,
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

for (const scenario of ['offline', 'missing', 'available', 'changed-owner']) {
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
      mayUse: () => true,
      invoke: async (...args) => {
        calls.push(args)
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
        canEditVerify: () => false,
      },
      '../i18n': { useT: () => new Proxy({}, { get: (_, key) => String(key) }) },
      '../runtime/limitTray': { describeLimitTray: () => ({}) },
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
    let nativeClears = 0
    find(tree, 'TextInput').props.ref.current = {
      clear() {
        nativeClears++
      },
    }
    nodes(tree)
      .find((node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Send')
      .props.onPress()
    assert.equal(nativeClears, 0, 'native input stays visible during attachment validation')
    assert.equal(store.drafts[key], 'Review the image', 'the recovery draft remains until acceptance')
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
    if (scenario === 'offline') assert.equal(alerts.at(-1)[1], 'savedAttachmentOffline')
    if (scenario === 'changed-owner') assert.equal(store.drafts['b:chat:task'], 'New host request')
    if (scenario !== 'available') assert.equal(store.drafts[key], 'Review the image')
    hooks.dispose()
  })
}

for (const os of ['ios', 'android']) {
  test(`${os} native profile saves commit and Forget removes recovery copies`, async () => {
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
      async text() {
        return this.textSync()
      }
      async write(text) {
        await Promise.resolve()
        this.writeSync(text)
      }
      writeSync(text) {
        files.set(this.path, text)
      }
      delete() {
        files.delete(this.path)
      }
    }
    const previous = { drafts: { 'a:new:p': 'Original draft' }, computers: [{ id: 'a' }] }
    const storage = load('storage/index.ts', os, {
      'expo-file-system': { File, Paths: { document: 'document' } },
      './localCommit': localCommitStorage,
    })
    storage.saveAppearance('dark')
    assert.equal(storage.readAppearance(), 'dark')
    storage.saveTextSize('larger')
    assert.equal(storage.readTextSize(), 'larger')
    storage.saveThemeLibraryText('[]')
    storage.saveSelectedThemeId('theme')
    storage.contentStorage.setItem('test.states', 'state')
    assert.equal(storage.contentStorage.getItem('test.states'), 'state')
    await storage.writeLocal(previous)
    const saved = { ...previous, drafts: { ...previous.drafts, 'a:saved-messages': 'Saved library' } }
    await storage.writeLocal(saved)
    assert.deepEqual(JSON.parse(JSON.stringify(storage.readLocal({}))), saved)
    await storage.writeLocal({ computers: [], drafts: {} }, { replaceBackups: true })
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
      mayUse: () => true,
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
      '../components/Keyboard': {
        useKeyboardInset: () => 0,
        useKeyboardOpen: () => 0 > 0,
        KeyboardPadding: 'KeyboardPadding',
      },
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
    nodes(find(tree, 'Composer').props.header)
      .find((node) => node.props?.icon === 'FolderGit2' || node.props?.icon === 'Folder')
      .props.onPress()
    tree = render()
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
      workspaceRenameOffline: 'Connect host',
      workspaceRenameConflict: 'Name changed elsewhere',
      save: 'Save',
      cancel: 'Cancel',
    }
    const { WorkspaceNameSheet } = load('components/WorkspaceNameSheet.tsx', os, {
      react: hooks.react,
      '../i18n': { useT: () => labels },
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
    requests[1].reject(new Error('Rename refused'))
    await settle()
    tree = render()
    assert.ok(nodes(tree).some((node) => node.type === 'T' && String(node.props.children).includes('Rename refused')))
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
      mayUse: () => true,
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
      '../components/Keyboard': {
        useKeyboardInset: () => 0,
        useKeyboardOpen: () => 0 > 0,
        KeyboardPadding: 'KeyboardPadding',
      },
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
    const button = (tree, title) =>
      nodes(tree).find(
        (node) => (node.type === 'Button' || node.type?.name === 'ContentAction') && node.props.title === title,
      )
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

  test(`${os} branch previews use frozen naming inputs, reject invalid edits and surface failures`, async () => {
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
    const button = (tree, title) =>
      nodes(tree).find(
        (node) => (node.type === 'Button' || node.type?.name === 'ContentAction') && node.props.title === title,
      )
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
    requests.at(-1).reject(new Error('Plan refused'))
    await settle()
    tree = render()
    assert.ok(nodes(tree).some((node) => String(node.props?.children).includes('Plan refused')))
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
      writes = [],
      journals = []
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
      './hostConnection': hostConnection,
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
        readSendJournal: () => [],
        readDrafts: () => null,
        writeDrafts: () => {},
        writeSendJournal: (ids) => {
          if (failWrite) throw new Error('Storage full')
          journals.push([...ids])
        },
      },
      './newChatHost': { newChatHost },
      './workspaces': workspaceChoices,
      './transport': { HostError, SuspendedError: class extends HostError {} },
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
          if (method === 'thread.start')
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
    const first = calls.find((call) => call.method === 'thread.start')
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
      assert.equal(calls.filter((call) => call.method === 'thread.start').length, 1)
      failWrite = false
      await store.resumeOutbox(item.id, updated)
      updated[0].baseOid = 'caller-mutated'
      await settle()
      store = render()
      assert.equal(store.outbox[0].state, 'review', 'a second base movement pauses again')
      const second = calls.filter((call) => call.method === 'thread.start')[1]
      assert.equal(second.args[0].requestId, first.args[0].requestId)
      assert.equal(second.args[1][0].baseOid, 'new-base')
      assert.ok(
        writes.some(
          (value) => value.outbox[0]?.state === 'waiting' && value.outbox[0]?.reviewedPlan[0].baseOid === 'new-base',
        ),
      )
      assert.equal(store.chats.length, 1)
    }
    assert.ok(
      journals.some((ids) => ids.includes(item.id)),
      'the message is journalled before it reaches the network',
    )
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
      mayUse: () => true,
      setDraft: (key, value) => {
        store.drafts[key] = value
      },
      subscribe: () => () => {},
      invoke: async () => ({
        defaultCheckoutMode: 'current',
        branchPrefix: 'team/',
        branchNaming: 'semantic',
        branchInstructions: '',
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
      '../components/Keyboard': {
        useKeyboardInset: () => 0,
        useKeyboardOpen: () => 0 > 0,
        KeyboardPadding: 'KeyboardPadding',
      },
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
      drafts: {},
      rememberExplorer() {},
      projects: [],
      computers: [
        { id: 'a', name: 'Laptop' },
        { id: 'b', name: 'Server' },
      ],
      isOnline: () => true,
      mayUse: () => true,
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
    mayUse: () => true,
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
    './SheetOptions': { SheetGroup: 'SheetGroup', SheetOption: 'SheetOption' },
    react: hooks.react,
    'expo-router': { useRouter: () => ({ push() {} }) },
    '@ramu/shared/usage/presentation': presentation,
    '@ramu/shared/providers/providers': providers,
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
  actionSettingsOffline: 'Connect to change actions',
  hiddenAction: 'Hidden',
  hiddenActionsHint: 'Hidden actions do not appear in menus or shortcuts.',
}
for (const os of ['ios', 'android']) {
  test(`${os} project action management reorders IDs and hides/restores on the owning host without executing commands`, async () => {
    const hooks = hookHarness()
    const calls = []
    const a = { id: 'test', name: 'Test', command: 'echo test', source: 'ramu.json' }
    const b = { id: 'dev', name: 'Dev', command: 'echo dev', source: 'ramu.json' }
    let settings = { actions: [a, b], hiddenIds: [], customOrder: false }
    let finish
    const store = {
      isOnline: () => true,
      mayUse: () => true,
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

  test(`${os} project action management fences stale hosts, failures, offline controls and dismissed reads`, async () => {
    const hooks = hookHarness()
    const requests = [],
      listeners = new Map()
    let props = { hostId: 'a', projectId: 'p', open: true, onClose() {} }
    let online = true
    const store = {
      isOnline: () => online,
      mayUse: () => true,
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
    requests[2].reject(Error('Actions refused'))
    late.resolve(settings('Late A'))
    await settle()
    assert.ok(nodes(render()).some((node) => String(node.props?.children).includes('Actions refused')))
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
    const store = { isOnline: () => true, chats: [] }
    const { ProjectActionsSheet } = load('components/ChatActions.tsx', os, {
      react: hooks.react,
      '../runtime/store': { useStore: () => store },
      '../i18n': { useT: () => actionSettingsCopy },
      './ProjectCommandSettings': { ProjectCommandSettings: 'ProjectCommandSettings' },
      './SheetOptions': { SheetGroup: 'SheetGroup', SheetOption: 'SheetOption' },
      '../runtime/groupRuns': { runsBy },
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
      .find((node) => node.type === 'SheetOption' && node.props.title === 'Manage actions')
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
    const hooks = hookHarness(),
      listeners = new Set(),
      calls = []
    let props = { host: 'a', project: 'a:p', key: 'a:new:a:p', base: modelBase }
    let latest = modelRepository,
      online = true
    const store = {
      drafts: {},
      isOnline: () => online,
      mayUse: () => true,
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
    const hooks = hookHarness(),
      calls = []
    let props = { host: 'a', project: 'a:p', key: 'a:new:a:p' },
      latest = modelRepository,
      waiting
    const store = {
      drafts: {},
      isOnline: () => true,
      mayUse: () => true,
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

  test(`${os} unknown saved model formats require an explicit model`, async () => {
    const hooks = hookHarness()
    const store = {
      drafts: { 'a:new:a:p:agent': '{"version":99}' },
      isOnline: () => true,
      mayUse: () => true,
      subscribe: () => () => {},
      setDraft: (key, value) => {
        store.drafts[key] = value
      },
      invoke: async () => {
        throw Error('Defaults refused')
      },
    }
    const { useAgentDraft } = load('runtime/useAgentDraft.ts', os, {
      react: hooks.react,
      './store': { useStore: () => store },
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
    hooks.dispose()
  })
}

for (const os of ['ios', 'android']) {
  test(`${os} New thread queues the reviewed repository model and preserves its draft when the preference changes before send`, async () => {
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
      mayUse: () => true,
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
      '../components/Keyboard': {
        useKeyboardInset: () => 0,
        useKeyboardOpen: () => 0 > 0,
        KeyboardPadding: 'KeyboardPadding',
      },
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
    const hooks = hookHarness()
    const store = {
      drafts: {},
      isOnline: () => false,
      mayUse: () => true,
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
    const hooks = hookHarness(),
      requests = []
    let listener
    const store = {
      drafts: {},
      isOnline: () => true,
      mayUse: () => true,
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
      useRef(initial) {
        const at = cursor++
        if (!(at in states)) states[at] = { current: initial }
        return states[at]
      },
      useEffect() {},
      useContext: () => () => {},
    },
    '../runtime/store': { useStore: () => store },
    '@ramu/shared/i18n': { translate: (_language, text) => text },
    '../i18n': { useT: () => ({}), fill: (text) => text },
    './ui': { ...components, tap() {}, T: 'T', Card: 'Card' },
    './Motion': { Collapse: 'Collapse', Disclosure: 'Disclosure', Breathe: 'Breathe', Arrive: 'Arrive' },
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
  const tools = [
    { kind: 'tool', id: 'first', tool: 'read', verb: 'Read', subject: 'a.ts', status: 'completed' },
    { kind: 'tool', id: 'second', tool: 'execute', verb: 'Bash', subject: 'tests', status: 'in_progress' },
  ]
  const item = { kind: 'tools', id: 'first', tools, entries: tools }
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
      mayUse: () => true,
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
      (node) => node.type === 'ActivityPill' && node.props.accessibilityLabel === 'Background terminals',
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
}

for (const os of ['ios', 'android']) {
  test(`${os} ordinary terminal tabs never adopt managed command records`, async () => {
    const hooks = hookHarness(),
      calls = []
    const store = {
      mayUse: () => true,
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
      watch: () => () => {},
    }
    const { TerminalScreen } = load('components/TerminalScreen.tsx', os, {
      '../runtime/terminalGesture': { terminalFontSize: () => 13 },
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
    const providers = load('../../../packages/shared/src/chat/threadProviders.ts', os)
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
      '@ramu/shared/chat/threadProviders': providers,
      '../i18n': { useT: () => strings, ago: () => 'now' },
      '../runtime/store': {
        useStore: () => ({ isOnline: () => online, inbox: { a: [{ kind: 'done', sessionId: 's' }] } }),
      },
      './ChatActions': { useChatCommands: () => ({}), ChatActionsSheet: 'ChatActionsSheet' },
      './SwipeRow': { SwipeRow: 'SwipeRow' },
      './ui': { Row: 'Row', T: 'T', Divider: 'Divider', Pill: 'Pill', ROW_INSET: 44 },
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
    // The desktop sidebar's trailing mark, named in full; the detail line says what the approval is for.
    assert.ok(
      nodes(tree).some((node) => node.props?.label === 'Approval needed' && node.props.status?.kind === 'approval'),
    )
    assert.ok(nodes(tree).some((node) => node.props?.tone === 'warn' && node.props.children === 'Approval'))
    find(tree, 'Row').props.onPress()
    assert.deepEqual(JSON.parse(JSON.stringify(destination)), { pathname: '/chat/[id]', params: { id: 'a:t' } })
    // A finished thread with nothing to report shows how its latest reply began, not a lone title.
    const reply = 'Fixed the login bug and added a test.'
    tree = ChatRow({ chat: { ...chat, inputSummary: undefined, lastReply: reply } })
    assert.ok(nodes(tree).some((node) => node.type === 'T' && node.props.children === reply))
    assert.match(find(tree, 'Row').props.accessibilityLabel, /Fixed the login bug/)
    // What the thread needs from the person comes first; its reply waits.
    tree = ChatRow({ chat: { ...chat, lastReply: reply } })
    assert.ok(!nodes(tree).some((node) => node.props?.children === reply))
    online = false
    tree = ChatRow({ chat })
    assert.match(find(tree, 'Row').props.accessibilityLabel, /Offline · last-known activity/)
    // Offline is a named fact on the detail line, so the host's state is not mistaken for the thread's.
    assert.ok(nodes(tree).some((node) => node.props?.label === 'Offline'))
    // A thread handed from Claude to Codex keeps both agents, the leading one last.
    tree = ChatRow({ chat: { ...chat, providers: ['claude-code', 'codex'] } })
    assert.ok(nodes(tree).some((node) => JSON.stringify(node.props?.agents) === '["claude-code","codex"]'))
    tree = ChatRow({ chat: { ...chat, status: 'needs-input', inputSummary: undefined } })
    assert.match(find(tree, 'Row').props.accessibilityLabel, /Waiting for your input/)
    assert.ok(!nodes(tree).some((node) => node.props?.tone === 'warn' && node.props.children === 'Approval'))
  })
}

test('Threads, Inbox and Schedules use native scroll edges without stacking a blur effect', () => {
  const screen = load('components/Screen.tsx', 'ios')
  for (const title of ['Threads', 'Inbox', 'Schedules']) {
    const tree = screen.Header({ title, large: true, back: false })
    assert.ok(nodes(tree).some((node) => node.props?.transparent === true))
    assert.ok(
      nodes(tree).some(
        (node) => node.props?.blurEffect === undefined && node.props?.largeStyle?.backgroundColor === 'transparent',
      ),
    )
    assert.equal(find(tree, 'StackScreen').props.options.scrollEdgeEffects.top, 'soft')
  }
})

test('native scroll-edge surfaces use the screen background and preserve list layout styles', () => {
  const screen = load('components/Screen.tsx', 'ios', { 'react-native': { FlatList: 'FlatList' } })
  const list = screen.PageFlatList({ data: [], style: { flex: 1 } })
  const view = find(list, 'FlatList')
  assert.equal(view.props.style[0].backgroundColor, 'window')
  assert.equal(view.props.style[1].flex, 1)
})

test('the project picker uses the centered native title and menu actions preserve icons', () => {
  const screen = load('components/Screen.tsx', 'ios')
  const centered = screen.Header({ title: 'Choose a project', align: 'center' })
  assert.equal(find(centered, 'StackScreen').props.options.headerTransparent, false)
  assert.ok(!nodes(centered).some((node) => node.type === 'ToolbarView'))
  assert.ok(nodes(centered).some((node) => node.props?.children === 'Choose a project'))
  const menu = require('react/jsx-runtime').jsx(screen.HeaderMenu, {
    label: 'Actions',
    onPress() {},
    actions: [{ label: 'Usage', icon: 'chart.bar', onPress() {} }],
  })
  const tree = screen.Header({ title: 'Thread', right: menu })
  assert.equal(find(tree, 'ToolbarMenuAction').props.icon, 'chart.bar')
})

for (const accepted of [true, false]) {
  test(`composer retains visible text and the recovery draft until local acceptance (accepted: ${accepted})`, async () => {
    const hooks = hookHarness()
    let acknowledge,
      nativeClears = 0,
      cleared = 0
    const store = {
      selected: 'a',
      computers: [{ id: 'a', status: 'online' }],
      projects: [],
      chats: [],
      missingMethods: {},
      appPreferences: {},
      drafts: { 'a:chat:one': 'Do the work' },
      isOnline: () => true,
      mayUse: () => true,
      setDraft(key, value) {
        store.drafts[key] = value
      },
      clearComposerDraft() {
        cleared++
        return true
      },
    }
    const { Composer } = load('components/Composer.tsx', 'ios', {
      react: hooks.react,
      './ui': new Proxy({}, { get: (_, key) => (key === 'tap' ? () => {} : String(key)) }),
      '@ramu/shared/chat/composerDraft': {
        composerDraft: (text) => ({ chips: [], segments: [{ kind: 'text', source: text }] }),
      },
      '../runtime/store': { useStore: () => store },
      '../i18n': { useT: () => ({ queue: 'Queue', steer: 'Steer' }) },
      '../runtime/goalVerify': { canEditVerify: () => false },
      './ComposerSuggest': { useComposerSuggest: () => ({ visible: false }) },
    })
    const render = () =>
      hooks.render(() =>
        Composer({
          computerId: 'a',
          draftKey: 'a:chat:one',
          running: true,
          model: { provider: 'claude-code', model: 'opus' },
          onModel() {},
          onSend: () =>
            new Promise((resolve) => {
              acknowledge = resolve
            }),
        }),
      )
    const tree = render()
    find(tree, 'TextInput').props.ref.current = {
      clear() {
        nativeClears++
      },
    }
    const steer = nodes(tree).find((node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Steer')
    assert.ok(steer)
    assert.ok(nodes(tree).some((node) => node.type === 'IconButton' && node.props.label === 'Queue'))
    assert.ok(!nodes(tree).some((node) => node.type === 'ThreadUsageChip'))
    steer.props.onPress()
    await settle()
    assert.equal(nativeClears, 0)
    assert.equal(store.drafts['a:chat:one'], 'Do the work')
    assert.equal(find(render(), 'TextInput').props.editable, false)
    acknowledge(accepted)
    await settle()
    assert.equal(nativeClears, accepted ? 1 : 0)
    if (!accepted)
      assert.ok(JSON.stringify(nodes(render()).map((node) => node.props?.children)).includes('Do the work'))
    assert.equal(cleared, accepted ? 1 : 0)
    hooks.dispose()
  })
}

test('mobile composer tools remain reachable in a horizontal row without a generic Working action', () => {
  const hooks = hookHarness()
  const { ThreadActivity } = load('components/ThreadActivity.tsx', 'ios', {
    react: hooks.react,
    '../runtime/store': { useStore: () => ({ language: 'en', isOnline: () => true }) },
    '../runtime/threadActivity': {
      mobileThreadActivity: () => ({
        model: { primary: 'working', secondary: [], counts: { active: 0 } },
        requests: [],
        groups: [],
        helpers: [],
        advisors: [],
      }),
    },
  })
  let opened = ''
  const tree = hooks.render(() =>
    ThreadActivity({
      chat: { computerId: 'a', queue: [] },
      actions: [
        {
          label: 'Browser',
          icon: 'Globe',
          onPress: () => {
            opened = 'browser'
          },
        },
        { label: 'Computer', icon: 'Monitor', onPress() {} },
      ],
    }),
  )
  assert.equal(find(tree, 'ScrollView').props.horizontal, true)
  assert.ok(!nodes(tree).some((node) => node.props?.children === 'Working'))
  const browser = nodes(tree).find((node) => node.props?.accessibilityLabel === 'Browser')
  browser.props.onPress()
  assert.equal(opened, 'browser')
  assert.ok(nodes(tree).some((node) => node.props?.accessibilityLabel === 'Computer'))
  hooks.dispose()
})

test('compact native headers reserve an opaque surface even when scroll underlap was requested', () => {
  const screen = load('components/Screen.tsx', 'ios')
  const tree = screen.Header({ title: 'Chat', scrollEdge: true })
  assert.equal(find(tree, 'StackScreen').props.options.headerTransparent, false)
  const appearance = nodes(tree).find((node) => node.props?.largeStyle?.backgroundColor === 'window')
  assert.ok(appearance)
  assert.equal(appearance.props.transparent, false)
  assert.equal(appearance.props.style.backgroundColor, 'window')
  assert.equal(appearance.props.blurEffect, undefined)
})

test('compact thread titles use the available width, wrap, and reveal the complete title on tap', () => {
  const opened = []
  const screen = load('components/Screen.tsx', 'ios', {
    'react-native': { Alert: { alert: (title) => opened.push(title) } },
  })
  const { jsx, jsxs } = require('react/jsx-runtime')
  const title = 'Try Using the Computer to Finish the Requested Task'
  const tree = screen.Header({
    title,
    subtitle: 'ramu',
    right: jsxs(require('react').Fragment, {
      children: [
        jsx(screen.HeaderButton, { icon: 'GitBranch', label: 'Source Control' }),
        jsx(screen.HeaderMenu, { label: 'Thread actions', actions: [], onPress() {} }),
      ],
    }),
  })
  const leading = nodes(tree).find((node) => node.type === 'Pressable' && node.props.accessibilityLabel === title)
  // Back button (56) and both trailing actions (2 × 52) plus the window margins keep their room beside the title.
  assert.ok(leading.props.style.width >= 140, 'a 400-point screen leaves at least 140 points for the title')
  assert.ok(leading.props.style.width <= 400 - 96 - 56 - 2 * 52, 'the title never pushes a trailing action off the bar')
  assert.equal(nodes(tree).find((node) => node.props?.children === title).props.numberOfLines, 2)
  leading.props.onPress()
  assert.deepEqual(opened, [title])
})

test('tool activity shortcuts follow actual tabs and sessions and ignore late reads after navigation', async () => {
  const hooks = hookHarness()
  let browser = false,
    computer = false,
    terminal = false,
    update
  const store = {
    isOnline: () => true,
    mayUse: () => true,
    invoke: async (_host, method) => {
      if (method === 'hostBrowser.status') return { enabled: true }
      if (method === 'hostBrowser.list') return browser ? [{ id: 'tab' }] : []
      if (method === 'computer.session') return computer ? { target: { id: 'app:Chrome' } } : null
      if (method === 'agent.context') return computer ? { percent: 31 } : null
      if (method === 'term.list') return terminal ? [{ exited: false }] : []
    },
    subscribe: (_host, listener) => {
      update = listener
      return () => {}
    },
    watch: () => () => {},
  }
  const { useThreadToolActivity } = load(
    'runtime/useThreadToolActivity.ts',
    'ios',
    {
      react: hooks.react,
      './store': { useStore: () => store },
    },
    { setInterval: () => 1, clearInterval() {} },
  )
  let chat = { computerId: 'a', taskId: 'one', sessionId: 'session' }
  const render = () => hooks.render(() => useThreadToolActivity(chat, true))
  render()
  await settle()
  let state = render()
  assert.equal(state.browser, false)
  assert.equal(state.computer, false)
  assert.equal(state.terminal, false)
  assert.equal(state.usage, false)
  browser = computer = terminal = true
  update('hostBrowser:changed')
  await settle()
  state = render()
  assert.equal(state.browser, true)
  assert.equal(state.computer, true)
  assert.equal(state.terminal, true)
  assert.equal(state.usage, true)
  browser = computer = terminal = false
  update('term:changed')
  await settle()
  state = render()
  assert.equal(state.browser, false)
  assert.equal(state.computer, false)
  assert.equal(state.terminal, false)
  assert.equal(state.usage, false)
  chat = { computerId: 'b', taskId: 'two', sessionId: 'other' }
  assert.equal(render().browser, false)
  hooks.dispose()
})

test('iOS 26 large titles retain the transparent native surface required by UIKit', () => {
  const screen = load('components/Screen.tsx', 'ios', { 'react-native': { Platform: { OS: 'ios', Version: 26 } } })
  const home = screen.Header({ title: 'Threads', large: true, back: false })
  assert.equal(find(home, 'StackScreen').props.options.headerStyle.backgroundColor, 'transparent')
  const chat = screen.Header({ title: 'Thread', scrollEdge: true })
  assert.equal(find(chat, 'StackScreen').props.options.headerStyle.backgroundColor, 'window')
})

test('unchanged computer-use polls preserve context identity and do not notify consumers with new state', async () => {
  const hooks = hookHarness()
  let poll,
    rows = [{ threadId: 'one', target: { name: 'Chrome' }, controller: { kind: 'agent' } }]
  const store = { computers: [{ id: 'a', status: 'online' }], invoke: async () => JSON.parse(JSON.stringify(rows)) }
  const { ComputerUseProvider } = load(
    'runtime/computerUse.tsx',
    'ios',
    {
      react: { ...require('react'), ...hooks.react },
      './store': { useStore: () => store },
      'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
    },
    {
      setInterval: (callback) => {
        poll = callback
        return 1
      },
      clearInterval() {},
    },
  )
  const render = () => hooks.render(() => ComputerUseProvider({ children: 'threads' }))
  render()
  await settle()
  const before = render().props.value
  await poll()
  await settle()
  assert.equal(render().props.value, before)
  rows = []
  await poll()
  await settle()
  assert.notEqual(render().props.value, before)
  assert.equal(render().props.value.sessions.a.length, 0)
  hooks.dispose()
})

test('computer-use stop revokes only the displayed thread and refreshes the shared indicator', async () => {
  const hooks = hookHarness(),
    calls = []
  let refreshed = 0,
    stoppedPropagation = false
  const { ComputerUseNotice } = load('components/ComputerUseNotice.tsx', 'ios', {
    react: hooks.react,
    '../runtime/store': {
      useStore: () => ({ language: 'en', isOnline: () => true, invoke: async (...args) => calls.push(args) }),
    },
    '../runtime/useDictation': {
      useVoiceSettings: () => [{}],
      useVoiceCapability: () => ({}),
      useMicControl: () => ({ kind: 'hidden' }),
      useDictation: () => ({ snapshot: { state: { phase: 'idle' } }, session: { cancel() {} } }),
    },
    '@ramu/shared/voice/dictation': { dictationBusy: () => false },
    '@ramu/shared/sharedFields': { sharedValue: () => undefined },
    '../runtime/busyMode': {
      BUSY_MODE_DEVICE_KEY: 'pref-device:queueWhileBusy',
      resolveBusyMode: () => ({ mode: 'steer', source: 'default' }),
      otherBusyMode: () => 'queue',
    },
    '../runtime/computerUse': {
      useComputerUse: () => ({
        session: { target: { name: 'Chrome' }, controller: { kind: 'agent' }, paused: false },
        refresh: async () => {
          refreshed++
        },
      }),
    },
  })
  let opened = 0
  const tree = hooks.render(() =>
    ComputerUseNotice({
      chat: { computerId: 'a', taskId: 'one' },
      onOpen: () => {
        opened++
      },
    }),
  )
  // The pill shows the target and opens the computer; its Stop control sits inside it.
  const pill = nodes(tree).find((node) => node.props?.accessibilityLabel?.startsWith('Open computer'))
  assert.match(pill.props.label, /Chrome/)
  pill.props.onPress()
  assert.equal(opened, 1)
  nodes(pill.props.trailing)
    .find((node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Stop computer use')
    .props.onPress({
      stopPropagation() {
        stoppedPropagation = true
      },
    })
  await settle()
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['a', 'computer.revoke', 'one']])
  assert.equal(refreshed, 1)
  assert.equal(stoppedPropagation, true)
  hooks.dispose()
})

test('tab and Settings stacks have blank initial titles and no generated back labels', () => {
  for (const layout of ['(tabs)/(threads)', '(tabs)/inbox', '(tabs)/schedules', '(tabs)/compose', 'settings']) {
    const { default: Layout } = load('app/' + layout + '/_layout.tsx', 'ios')
    const options = Layout().props.screenOptions
    assert.equal(options.title, '')
    assert.equal(options.headerBackButtonDisplayMode, 'minimal')
    assert.equal(options.headerStyle.backgroundColor, 'window')
  }
})

for (const os of ['ios', 'android']) {
  test(`${os} viewer and offline schedule rows remain readable without mutation gestures`, () => {
    const computer = { id: 'a', status: 'online', access: 'owner' }
    const opened = []
    const { ScheduleRow } = load('components/ScheduleRow.tsx', os, {
      './ui': { Row: 'Row', T: 'T', tap() {} },
      '../runtime/store': { useStore: () => ({ computers: [computer], language: 'en' }) },
      '../runtime/automation': { useAutomation: () => ({}) },
      '../runtime/scheduleModel': scheduleModel,
      '../i18n': { useT: () => ({ resume: 'Resume', pause: 'Pause', runNow: 'Run now', delete: 'Delete' }) },
      'expo-router': { useRouter: () => ({ push: (route) => opened.push(route) }) },
    })
    const schedule = { ...scheduleModel.defaultInput({}), id: 'schedule', state: 'active' }
    const render = () => ScheduleRow({ computerId: 'a', schedule })
    assert.equal(find(render(), 'SwipeRow').props.actions.length, 3)
    computer.access = 'viewer'
    assert.equal(find(render(), 'SwipeRow').props.actions.length, 0)
    find(render(), 'Row').props.onPress()
    assert.equal(opened[0].params.id, 'schedule')
    computer.access = 'owner'
    computer.status = 'offline'
    assert.equal(find(render(), 'SwipeRow').props.actions.length, 0)
  })

  test(`${os} a schedule edit deep link becomes read-only without losing its local draft`, () => {
    const hooks = hookHarness()
    const computer = { id: 'a', status: 'online', access: 'owner', name: 'Host' }
    const store = { computers: [computer], selected: 'a', defaults: {}, projects: [], language: 'en' }
    const { default: ScheduleEdit } = load('app/schedule-edit.tsx', os, {
      react: { ...hooks.react, useEffect() {} },
      '../runtime/store': { useStore: () => store, scoped: (host, id) => `${host}:${id}` },
      '../runtime/automation': { useAutomation: () => ({}) },
      '../runtime/scheduleModel': scheduleModel,
      '../i18n': { useT: () => ({ newSchedule: 'New schedule', save: 'Save' }) },
      'expo-router': { useLocalSearchParams: () => ({ computer: 'a' }) },
    })
    const render = () => hooks.render(() => ScheduleEdit())
    nodes(render())
      .find((node) => node.type === 'TextField' && node.props.maxLength === 200)
      .props.onChangeText('Keep my draft')
    computer.access = 'viewer'
    const readOnly = render()
    assert.equal(find(readOnly, 'TextField'), undefined)
    assert.equal(find(readOnly, 'GlassButton'), undefined)
    assert.ok(nodes(readOnly).some((node) => node.props.children === scheduleModel.VIEW_ONLY_SCHEDULE_NOTICE.en))
    computer.access = 'owner'
    assert.equal(
      nodes(render()).find((node) => node.type === 'TextField' && node.props.maxLength === 200).props.value,
      'Keep my draft',
    )
    hooks.dispose()
  })
}

test('schedule callbacks recheck the current host role before every RPC, including delayed callbacks', async () => {
  const hooks = hookHarness()
  const calls = []
  const computer = { id: 'a', status: 'online', access: 'owner' }
  const store = {
    computers: [computer],
    chats: [],
    appPreferences: {},
    language: 'en',
    invoke: async (host, method) => {
      calls.push([host, method])
      return []
    },
    refresh: async () => {},
  }
  const { AutomationProvider } = load('runtime/automation.tsx', 'ios', {
    react: { ...require('react'), ...hooks.react, useEffect() {} },
    './store': { useStore: () => store },
    './scheduleModel': scheduleModel,
    './inbox': { buildInbox: () => null },
    '../storage': { readLastVisit: () => 0, readFailuresSeen: () => ({}) },
  })
  const render = () => hooks.render(() => AutomationProvider({ children: null })).props.value
  const original = render()
  const actions = [
    () => original.saveSchedule('a', {}),
    () => original.pauseSchedule('a', 'schedule', true),
    () => original.deleteSchedule('a', 'schedule'),
    () => original.runScheduleNow('a', 'schedule'),
    () => original.previewRule('a', { kind: 'daily', at: '09:00' }, 'UTC'),
  ]
  computer.access = 'viewer'
  render()
  for (const action of actions) await assert.rejects(action, /view schedules/)
  assert.equal(calls.length, 0)
  computer.access = 'owner'
  computer.status = 'offline'
  render()
  for (const action of actions) await assert.rejects(action, /Connect to this host/)
  assert.equal(calls.length, 0)
  computer.status = 'online'
  render()
  await original.pauseSchedule('a', 'schedule', true)
  assert.equal(calls[0][1], 'schedules.pause')
  assert.ok(calls.some((call) => call[1] === 'schedules.list'))
  hooks.dispose()
})

test('tabs can suppress their default Search action while keeping Settings', () => {
  const { useTabActions } = load('components/Overlays.tsx', 'ios', {
    '../runtime/store': { useStore: () => ({ computers: [], selected: 'a' }) },
    '../i18n': { useT: () => ({ settings: 'Settings', searchTab: 'Search' }) },
  })
  assert.deepEqual(
    nodes(useTabActions(null))
      .filter((node) => node.type === 'HeaderButton')
      .map((node) => node.props.label),
    ['Settings'],
  )
  assert.deepEqual(
    nodes(useTabActions())
      .filter((node) => node.type === 'HeaderButton')
      .map((node) => node.props.label),
    ['Search', 'Settings'],
  )
})

for (const os of ['ios', 'android']) {
  test(`${os} viewer schedule lists suppress creation and explain the role`, () => {
    const hooks = hookHarness()
    const store = { selected: 'a', language: 'en', computers: [{ id: 'a', status: 'online', access: 'viewer' }] }
    let primary = 'unset'
    const { default: SchedulesScreen } = load('app/(tabs)/schedules/index.tsx', os, {
      react: hooks.react,
      '../../../runtime/store': { useStore: () => store },
      '../../../runtime/scheduleModel': scheduleModel,
      '../../../runtime/automation': {
        useAutomation: () => ({ of: () => ({ schedules: [], runs: [], loaded: true }) }),
      },
      '../../../components/Overlays': {
        useTabActions: (action) => {
          primary = action
          return null
        },
      },
      '../../../components/Screen': {
        Screen: 'Screen',
        Header: 'Header',
        LargeTitle: 'LargeTitle',
        PageScrollView: 'PageScrollView',
        useScrolledUnderBar: () => ({ scrolled: false }),
      },
      '../../../i18n': { useT: () => ({ schedules: 'Schedules', newSchedule: 'New schedule' }) },
      'react-native': { RefreshControl: 'RefreshControl' },
    })
    const tree = hooks.render(() => SchedulesScreen())
    assert.equal(primary, null)
    assert.equal(find(tree, 'GlassButton'), undefined)
    assert.ok(nodes(tree).some((node) => node.props.children === scheduleModel.VIEW_ONLY_SCHEDULE_NOTICE.en))
    hooks.dispose()
  })
}

for (const os of ['ios', 'android']) {
  test(`${os} viewer helper controls preserve drafts and refuse retained send/stop callbacks`, async () => {
    const helpers = await import('../../../packages/shared/src/chat/helperPresentation.ts')
    const hooks = hookHarness(),
      calls = [],
      confirmations = []
    let store = {
      language: 'en',
      computers: [{ id: 'host', status: 'online', access: 'owner' }],
      isOnline: () => true,
      mayUse: () => true,
      invoke: async (...args) => {
        calls.push(args)
      },
    }
    const { HelperDetails } = load('components/Helpers.tsx', os, {
      react: hooks.react,
      '../runtime/store': { useStore: () => store },
      '@ramu/shared/chat/helperPresentation': helpers,
      'react-native': { Alert: { alert: (...args) => confirmations.push(args) } },
    })
    const task = { agentId: 'helper', name: 'Helper', status: 'running', canMessage: true, canStop: true }
    const render = () =>
      hooks.render(() => HelperDetails({ task, chat: { computerId: 'host', sessionId: 'parent' }, onClose() {} }))
    let tree = render()
    find(tree, 'TextInput').props.onChangeText('keep my draft')
    tree = render()
    const send = nodes(tree).find((node) => node.type === 'Button' && node.props.title === 'Send')
    nodes(tree)
      .find((node) => node.type === 'Button' && node.props.title === 'Stop agent')
      .props.onPress()
    store = { ...store, computers: [{ id: 'host', status: 'online', access: 'viewer' }] }
    tree = render()
    assert.equal(find(tree, 'TextInput').props.value, 'keep my draft')
    assert.equal(find(tree, 'TextInput').props.editable, false)
    assert.equal(nodes(tree).find((node) => node.type === 'Button' && node.props.title === 'Send').props.disabled, true)
    assert.equal(
      nodes(tree).some((node) => node.props.title === 'Stop agent'),
      false,
    )
    send.props.onPress()
    confirmations[0][2].find((item) => item.style === 'destructive').onPress()
    await settle()
    assert.deepEqual(calls, [])
    hooks.dispose()
  })

  test(`${os} viewer side questions stay readable and refuse retained ask/delete callbacks`, async () => {
    const hooks = hookHarness(),
      calls = [],
      confirmations = []
    const chat = { computerId: 'host', sessionId: 'parent', title: 'Parent' }
    let store = {
      language: 'en',
      computers: [{ id: 'host', status: 'online', access: 'owner' }],
      subscribe: () => () => {},
      watch: () => () => {},
      invoke: async (...args) => {
        calls.push(args)
        return [
          {
            id: 'aside',
            quote: 'quote',
            createdAt: 1,
            messages: [{ id: 'm', role: 'user', text: 'existing question' }],
          },
        ]
      },
    }
    const { default: AsideScreen } = load('app/chat/[id]/aside.tsx', os, {
      react: hooks.react,
      'expo-router': { useLocalSearchParams: () => ({ id: 'chat' }) },
      '../../../runtime/store': { useStore: () => store, useChat: () => chat },
      '../../../components/ui': { T: 'T', tap() {} },
      '../../../components/Keyboard': {
        useKeyboardInset: () => 0,
        useKeyboardHeight: () => ({ height: 0 }),
        KeyboardLift: 'KeyboardLift',
        ComposerDock: 'ComposerDock',
      },
      '../../../components/Screen': {
        Screen: 'Screen',
        Header: 'Header',
        HeaderButton: 'HeaderButton',
        PageScrollView: 'ScrollView',
      },
      'react-native': { Alert: { alert: (...args) => confirmations.push(args) } },
    })
    const render = () => hooks.render(() => AsideScreen())
    render()
    await settle()
    let tree = render()
    find(tree, 'TextInput').props.onChangeText('unsent follow-up')
    tree = render()
    const ask = nodes(tree).find((node) => node.props.accessibilityLabel === 'Ask')
    // One side chat per thread: Clear (trash) is the only header action; keep it across the access change.
    find(tree, 'Header').props.right.props.onPress()
    calls.length = 0
    store = { ...store, computers: [{ id: 'host', status: 'online', access: 'viewer' }] }
    tree = render()
    assert.equal(find(tree, 'TextInput').props.value, 'unsent follow-up')
    assert.equal(find(tree, 'TextInput').props.editable, false)
    // A viewer cannot clear; the conversation stays readable.
    assert.equal(find(tree, 'Header').props.right, null)
    assert.ok(nodes(tree).some((node) => node.props.children === 'existing question'))
    ask.props.onPress()
    confirmations[0][2].find((item) => item.style === 'destructive').onPress()
    await settle()
    assert.deepEqual(calls, [])
    hooks.dispose()
  })
}

for (const os of ['ios', 'android']) {
  test(`${os} viewer message menus keep copy/quote and refuse actions from an already open sheet`, () => {
    const calls = [],
      sheets = [],
      hooks = hookHarness()
    let menu = {
      readOnly: false,
      quote: () => calls.push('quote'),
      quoteNew: () => calls.push('new'),
      edit: () => calls.push('edit'),
      undo: () => calls.push('undo'),
      aside: () => calls.push('aside'),
    }
    const component = load('components/Transcript.tsx', os, {
      react: { ...require('react'), ...hooks.react, useContext: () => menu },
      './ui': { ...components, tap() {} },
      'react-native': {
        ActionSheetIOS: {
          showActionSheetWithOptions: (options, select) => sheets.push({ options: options.options, select }),
        },
        Alert: {
          alert: (_title, _body, actions) =>
            sheets.push({
              options: actions.map((action) => action.text),
              select: (index) => actions[index].onPress?.(),
            }),
        },
      },
      'expo-clipboard': { setStringAsync: async () => calls.push('copy') },
    })
    const root = component.TranscriptItemView({
      item: { kind: 'user', seq: 7, text: 'Original request' },
      chat: { id: 'chat' },
    })
    const block = nodes(root).find((node) => node.type?.name === 'TranscriptBlock')
    const action = block.type(block.props)
    const render = () => hooks.render(() => action.type(action.props))
    // A long press selects the text; the selection bar's More opens the rest of the message's actions.
    const openMore = () => {
      find(render(), 'Pressable').props.onLongPress()
      const selecting = render()
      selecting.props.more()
      selecting.props.done()
    }
    openMore()
    assert.ok(sheets[0].options.includes('Edit from here'))
    menu = { ...menu, readOnly: true }
    openMore()
    assert.deepEqual(Array.from(sheets[1].options), ['Copy', 'Quote in reply', 'Quote in new thread', 'Cancel'])
    for (const label of ['Edit from here', 'Undo file changes from here', 'Ask aside about this'])
      sheets[0].select(sheets[0].options.indexOf(label))
    assert.deepEqual(calls, [])
    sheets[1].select(0)
    sheets[1].select(1)
    sheets[1].select(2)
    assert.deepEqual(calls, ['copy', 'quote', 'new'])
    hooks.dispose()
  })
}

for (const os of ['ios', 'android']) {
  test(`${os} viewer thread actions keep copying and refuse retained writes and deletion confirmation`, async () => {
    const hooks = hookHarness(),
      calls = [],
      alerts = []
    let store = {
      language: 'en',
      computers: [{ id: 'host', status: 'online', access: 'owner' }],
      chats: [],
      isOnline: () => true,
      mayUse: () => true,
      invoke: async (...args) => {
        calls.push(args)
        return []
      },
      refresh: async () => {},
    }
    const { ChatActionsSheet } = load('components/ChatActions.tsx', os, {
      react: hooks.react,
      '../runtime/store': { useStore: () => store },
      '../i18n': { useT: () => ({ renameWithAI: 'Rename with AI' }) },
      './SheetOptions': { SheetGroup: 'SheetGroup', SheetOption: 'SheetOption' },
      '../runtime/groupRuns': { runsBy },
      '@ramu/shared/chat/taskRemoval': taskRemoval,
      'react-native': { Alert: { alert: (...args) => alerts.push(args) } },
    })
    const chat = {
      computerId: 'host',
      taskId: 'task',
      title: 'Thread',
      status: 'idle',
      pinnedAt: null,
      mode: 'current',
    }
    const render = () => hooks.render(() => ChatActionsSheet({ chat, open: true, onClose() {} }))
    const row = (tree, label) => nodes(tree).find((node) => node.type === 'SheetOption' && node.props.title === label)
    let tree = render()
    const pin = row(tree, 'Pin to top'),
      rename = row(tree, 'Rename'),
      archive = row(tree, 'Archive')
    row(tree, 'Delete…').props.onPress()
    await settle()
    assert.equal(alerts.length, 1)
    calls.length = 0
    store = { ...store, computers: [{ id: 'host', status: 'online', access: 'viewer' }] }
    tree = render()
    assert.ok(row(tree, 'Copy thread ID'))
    for (const label of ['Pin to top', 'Rename', 'Archive', 'Delete…']) assert.equal(row(tree, label), undefined)
    pin.props.onPress()
    rename.props.onPress()
    archive.props.onPress()
    alerts[0][2].find((item) => item.style === 'destructive').onPress()
    await settle()
    assert.deepEqual(calls, [])
    assert.equal(find(render(), 'TextInput'), undefined)
    hooks.dispose()
  })
}

for (const os of ['ios', 'android']) {
  test(`${os} the mobile store blocks retained viewer writes before transport and preserves permitted request answers`, async () => {
    const hooks = hookHarness(),
      refs = [],
      calls = []
    class HostError extends Error {
      constructor(message, status = 0) {
        super(message)
        this.status = status
      }
    }
    const initial = {
      computers: [{ id: 'a', name: 'Host', status: 'online', access: 'owner' }],
      chats: [{ id: 'a:chat', computerId: 'a', taskId: 'task', sessionId: 'session' }],
      projects: [],
      drafts: {},
      outbox: [],
    }
    const { StoreProvider } = load('runtime/store.tsx', os, {
      './hostConnection': hostConnection,
      react: {
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
        writeLocal() {},
        readSendJournal: () => [],
        readDrafts: () => null,
        writeDrafts: () => {},
        writeSendJournal() {},
      },
      './transport': { HostError, SuspendedError: class extends HostError {} },
      './newChatHost': { newChatHost: () => 'a' },
      './threadActivity': { normalizeHelperGroups: (rows) => rows },
    })
    const render = () => hooks.render(() => StoreProvider({ children: null })).props.value
    const retained = render(),
      current = refs[0]
    refs[1].current.set('a', {
      controller: new AbortController(),
      client: {
        invoke: async (...args) => {
          calls.push(args)
          return []
        },
      },
    })
    current.current.computers[0].access = 'viewer'
    for (const method of ['agent.submit', 'agent.stop', 'agent.goal.control', 'tasks.rename', 'remote.status'])
      await assert.rejects(retained.invoke('a', method), /view-only/)
    await assert.rejects(retained.send('a:chat', 'keep this draft'), /view-only/)
    await assert.rejects(
      retained.createChat({ computerId: 'a', projectId: 'standalone', text: 'new draft' }),
      /view-only/,
    )
    assert.deepEqual(current.current.outbox, [])
    assert.equal(current.current.chats.length, 1)
    for (const method of [
      'agent.replyPermission',
      'agent.replyQuestion',
      'agent.replyElicitation',
      'agent.dismissQuestion',
    ])
      await retained.invoke('a', method)
    assert.deepEqual(
      calls.map(([method]) => method),
      ['agent.replyPermission', 'agent.replyQuestion', 'agent.replyElicitation', 'agent.dismissQuestion'],
    )
    current.current.computers[0].access = 'owner'
    await retained.invoke('a', 'tasks.rename', 'task', 'New title')
    assert.equal(calls.at(-1)[0], 'tasks.rename')
    hooks.dispose()
  })

  test(`${os} a viewer role change during the outbox paint yield keeps the pending message unsent`, async () => {
    const hooks = hookHarness(),
      refs = [],
      calls = []
    class HostError extends Error {}
    const initial = {
      computers: [{ id: 'a', name: 'Host', status: 'online', access: 'owner' }],
      chats: [{ id: 'a:chat', computerId: 'a', taskId: 'task', sessionId: 'session' }],
      projects: [],
      drafts: {},
      outbox: [],
    }
    const { StoreProvider } = load('runtime/store.tsx', os, {
      './hostConnection': hostConnection,
      react: {
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
        writeLocal() {},
        readSendJournal: () => [],
        readDrafts: () => null,
        writeDrafts: () => {},
        writeSendJournal() {},
      },
      './transport': { HostError, SuspendedError: class extends HostError {} },
      './threadActivity': { normalizeHelperGroups: (rows) => rows },
    })
    const store = hooks.render(() => StoreProvider({ children: null })).props.value
    const current = refs[0]
    refs[1].current.set('a', {
      controller: new AbortController(),
      client: {
        invoke: async (...args) => {
          calls.push(args)
          return []
        },
      },
    })
    current.current.computers[0].status = 'online'
    await store.send('a:chat', 'pending text', 'queue')
    current.current.computers[0].access = 'viewer'
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.deepEqual(calls, [])
    assert.equal(current.current.outbox.length, 1)
    assert.equal(current.current.outbox[0].text, 'pending text')
    assert.equal(current.current.outbox[0].state, 'waiting')
    assert.match(current.current.outbox[0].error, /view-only/)
    hooks.dispose()
  })
}

for (const os of ['ios', 'android']) {
  test(`${os} a viewer outbox item explains its paused delivery and keeps local cancellation available`, () => {
    const hooks = hookHarness(),
      alerts = []
    const { PendingBubble } = load('components/Outbox.tsx', os, {
      react: hooks.react,
      '../runtime/store': {
        useStore: () => ({
          language: 'en',
          computers: [{ id: 'a', access: 'viewer' }],
          cancelOutbox: () => 'kept text',
        }),
      },
      '../i18n': { useT: () => ({ branchReviewBases: 'Review bases' }) },
      './ui': { T: 'T', tap() {} },
      'react-native': {
        Alert: { alert: (...args) => alerts.push(args) },
        ActionSheetIOS: { showActionSheetWithOptions: (options) => alerts.push(options) },
      },
    })
    const tree = hooks.render(() =>
      PendingBubble({
        item: { id: 'pending', computerId: 'a', text: 'kept text', state: 'review', mode: 'queue' },
        computer: 'Host',
        onEdit() {},
      }),
    )
    assert.ok(
      nodes(tree).some((node) =>
        [node.props?.children].flat(Infinity).includes(viewerAccess.VIEW_ONLY_WRITE_NOTICE.en),
      ),
    )
    assert.equal(
      nodes(tree).some((node) => node.props.accessibilityLabel === 'Review bases'),
      false,
    )
    find(tree, 'Pressable').props.onPress()
    assert.equal(alerts.length, 1)
    hooks.dispose()
  })
}

for (const os of ['ios', 'android']) {
  test(`${os} viewer project menus keep local actions and block retained removal and delayed navigation`, async () => {
    const hooks = hookHarness(),
      calls = [],
      alerts = [],
      timers = [],
      routes = []
    let store = {
      chats: [],
      language: 'en',
      computers: [{ id: 'a', access: 'owner' }],
      isOnline: () => true,
      mayUse: () => true,
      refresh: async () => {},
      invoke: async (...args) => calls.push(args),
    }
    const { ProjectActionsSheet } = load(
      'components/ChatActions.tsx',
      os,
      {
        react: hooks.react,
        '../runtime/store': { useStore: () => store },
        '../i18n': { useT: () => actionSettingsCopy },
        './SheetOptions': { SheetGroup: 'SheetGroup', SheetOption: 'SheetOption' },
        '../runtime/groupRuns': { runsBy },
        'expo-router': { useRouter: () => ({ push: (route) => routes.push(route) }) },
        'react-native': { Alert: { alert: (...args) => alerts.push(args) } },
      },
      { setTimeout: (run) => timers.push(run) },
    )
    const render = () =>
      hooks.render(() =>
        ProjectActionsSheet({
          project: { id: 'a:p', computerId: 'a', name: 'Project', root: '/project' },
          open: true,
          onClose() {},
        }),
      )
    const row = (tree, label) => nodes(tree).find((node) => node.type === 'SheetOption' && node.props.title === label)
    let tree = render()
    const rename = row(tree, 'Rename'),
      manage = row(tree, 'Manage actions')
    row(tree, 'Open terminal').props.onPress()
    row(tree, 'Remove project…').props.onPress()
    store = { ...store, computers: [{ id: 'a', access: 'viewer' }] }
    tree = render()
    for (const label of [
      'Rename',
      'Manage actions',
      'Names for Auto…',
      'Browse files',
      'Open terminal',
      'Remove project…',
    ])
      assert.equal(row(tree, label), undefined)
    assert.ok(row(tree, 'Copy folder path'))
    assert.ok(row(tree, 'New thread'))
    rename.props.onPress()
    manage.props.onPress()
    alerts[0][2].find((item) => item.style === 'destructive').onPress()
    timers.splice(0).forEach((run) => run())
    await settle()
    assert.deepEqual(calls, [])
    assert.deepEqual(routes, [])
    assert.equal(find(render(), 'TextInput'), undefined)
    row(tree, 'New thread').props.onPress()
    timers.splice(0).forEach((run) => run())
    assert.equal(routes[0].pathname, '/new')
    hooks.dispose()
  })

  test(`${os} project routing preserves its draft and refuses an old save after viewer access or target change`, async () => {
    const hooks = hookHarness(),
      calls = []
    let store = {
      language: 'en',
      computers: [{ id: 'a', access: 'owner' }],
      isOnline: () => true,
      mayUse: () => true,
      refresh: async () => {},
      invoke: async (...args) => calls.push(args),
    }
    let project = { id: 'a:p', computerId: 'a', name: 'Project' }
    const { ProjectRoutingSettings } = load('components/ProjectRoutingSettings.tsx', os, {
      react: hooks.react,
      '../runtime/store': { useStore: () => store },
    })
    const render = () => hooks.render(() => ProjectRoutingSettings({ project, onClose() {} }))
    let tree = render()
    find(tree, 'TextInput').props.onChangeText('Draft alias')
    tree = render()
    const save = nodes(tree).find((node) => node.props.title === 'Save')
    store = { ...store, computers: [{ id: 'a', access: 'viewer' }] }
    tree = render()
    assert.equal(find(tree, 'TextInput').props.value, 'Draft alias')
    assert.equal(find(tree, 'TextInput').props.editable, false)
    save.props.onPress()
    await settle()
    assert.deepEqual(calls, [])
    store = { ...store, computers: [{ id: 'a', access: 'owner' }] }
    project = { ...project, id: 'a:other' }
    render()
    save.props.onPress()
    await settle()
    assert.deepEqual(calls, [])
    hooks.dispose()
  })

  test(`${os} project command management keeps cached commands read-only and blocks retained mutations`, async () => {
    const hooks = hookHarness(),
      calls = []
    const settings = {
      actions: [{ id: 'test', name: 'Test', command: 'pnpm test', source: 'ramu.json' }],
      hiddenIds: [],
      customOrder: false,
    }
    let store = {
      language: 'en',
      computers: [{ id: 'a', access: 'owner' }],
      isOnline: () => true,
      mayUse: () => true,
      subscribe: () => () => {},
      watch: () => () => {},
      invoke: async (...args) => {
        calls.push(args)
        return settings
      },
    }
    const { ProjectCommandSettings } = load('components/ProjectCommandSettings.tsx', os, {
      react: hooks.react,
      '../runtime/store': { useStore: () => store },
      '../i18n': { useT: () => actionSettingsCopy },
    })
    const render = () =>
      hooks.render(() => ProjectCommandSettings({ hostId: 'a', projectId: 'p', open: true, onClose() {} }))
    render()
    await settle()
    let tree = render()
    const mutation = nodes(tree).find(
      (node) => node.type === 'Button' && node.props.accessibilityLabel?.includes('Hide'),
    )
    assert.ok(mutation)
    calls.length = 0
    store = { ...store, computers: [{ id: 'a', access: 'viewer' }] }
    tree = render()
    assert.ok(nodes(tree).some((node) => [node.props?.children].flat(Infinity).includes('Test')))
    assert.ok(
      nodes(tree)
        .filter((node) => node.type === 'Button')
        .every((node) => node.props.disabled),
    )
    mutation.props.onPress()
    await settle()
    assert.deepEqual(calls, [])
    hooks.dispose()
  })
}

for (const os of ['ios', 'android']) {
  test(`${os} a viewer browser entry explains its access without querying forbidden host methods`, async () => {
    const hooks = hookHarness(),
      calls = []
    const store = {
      language: 'en',
      computers: [{ id: 'a', name: 'Host', access: 'viewer' }],
      isOnline: () => true,
      mayUse: () => true,
      invoke: async (...args) => calls.push(args),
    }
    const { BrowserActivity } = load('components/BrowserActivity.tsx', os, {
      react: hooks.react,
      '../runtime/store': { useStore: () => store },
    })
    const tree = hooks.render(() =>
      BrowserActivity({ chat: { computerId: 'a', taskId: 'task' }, open: true, onClose() {} }),
    )
    await settle()
    assert.deepEqual(calls, [])
    assert.ok(nodes(tree).some((node) => node.props.children === viewerAccess.VIEW_ONLY_BROWSER_NOTICE.en))
    assert.equal(find(tree, 'BrowserViewer'), undefined)
    hooks.dispose()
  })

  test(`${os} an open browser preserves its address draft and refuses retained navigation after viewer access`, async () => {
    const hooks = hookHarness(),
      calls = [],
      timers = []
    let listed = []
    let store = {
      language: 'en',
      computers: [{ id: 'a', name: 'Host', access: 'owner' }],
      isOnline: () => true,
      mayUse: () => true,
      invoke: async (...args) => {
        calls.push(args)
        return args[1] === 'hostBrowser.list' ? listed : []
      },
    }
    const { BrowserViewer } = load(
      'components/BrowserViewer.tsx',
      os,
      {
        react: hooks.react,
        '../runtime/store': { useStore: () => store },
        './SheetOptions': {
          SheetGroup: 'SheetGroup',
          SheetOption: 'SheetOption',
          SheetPanelGroup: 'SheetPanelGroup',
          useSheetInputStyle: () => ({}),
        },
        'react-native': {
          AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
          PanResponder: { create: () => ({ panHandlers: {} }) },
        },
      },
      { setTimeout: (run) => timers.push(run), clearTimeout() {} },
    )
    const render = () =>
      hooks.render(() => BrowserViewer({ chat: { computerId: 'a', taskId: 'task' }, embedded: true, onClose() {} }))
    render()
    await settle()
    let tree = render()
    const field = nodes(tree).find((node) => node.props.accessibilityLabel === 'Address')
    field.props.onChangeText('https://kept.example')
    tree = render()
    const retained = nodes(tree).find((node) => node.props.accessibilityLabel === 'Address').props.onSubmitEditing
    store = { ...store, computers: [{ id: 'a', name: 'Host', access: 'viewer' }] }
    tree = render()
    calls.length = 0
    retained()
    timers.splice(0).forEach((run) => run())
    await settle()
    assert.deepEqual(calls, [])
    assert.ok(nodes(tree).some((node) => node.props.children === viewerAccess.VIEW_ONLY_BROWSER_NOTICE.en))
    assert.equal(
      nodes(tree).some((node) => node.props.title === 'Take control'),
      false,
    )
    listed = [
      {
        id: 'tab',
        url: 'https://host.example',
        profileId: 'default',
        controller: 'agent',
        generation: 1,
        paused: false,
      },
    ]
    field.props.onBlur()
    store = { ...store, computers: [{ id: 'a', name: 'Host', access: 'owner' }] }
    render()
    await settle()
    tree = render()
    assert.equal(
      nodes(tree).find((node) => node.props.accessibilityLabel === 'Address').props.value,
      'https://kept.example',
    )
    hooks.dispose()
  })
}

for (const os of ['ios', 'android']) {
  test(`${os} viewers can open an owner-granted computer screen without querying administration`, async () => {
    const hooks = hookHarness(),
      calls = []
    const granted = {
      generation: 1,
      target: { kind: 'display', id: 'display', name: 'Shared display' },
      runtime: { id: 'local' },
      controller: { kind: 'human' },
    }
    const store = {
      language: 'en',
      computers: [{ id: 'a', name: 'Host', access: 'viewer' }],
      isOnline: () => true,
      mayUse: () => true,
      invoke: async (...args) => {
        calls.push(args)
        return granted
      },
    }
    const { ComputerActivity } = load(
      'components/ComputerActivity.tsx',
      os,
      {
        react: hooks.react,
        '../runtime/store': { useStore: () => store },
      },
      { setInterval: () => 1, clearInterval() {} },
    )
    const render = () =>
      hooks.render(() => ComputerActivity({ chat: { computerId: 'a', taskId: 'task' }, open: true, onClose() {} }))
    render()
    await settle()
    const viewer = nodes(render()).find((node) => node.type?.name === 'ComputerViewer')
    assert.ok(viewer)
    assert.equal(viewer.props.session.target.name, 'Shared display')
    assert.deepEqual(
      calls.map(([, method]) => method),
      ['computer.session'],
    )
    hooks.dispose()
  })

  test(`${os} an open computer viewer keeps frames but refuses retained control after a viewer role change`, async () => {
    const control = await import('../../../packages/shared/src/computerControl.ts')
    const parent = hookHarness(),
      calls = [],
      timers = [],
      react = { ...parent.react }
    const granted = {
      generation: 1,
      target: { kind: 'display', id: 'display', name: 'Shared display' },
      runtime: { id: 'local' },
      controller: { kind: 'human' },
      paused: false,
    }
    let store = {
      language: 'en',
      computers: [{ id: 'a', name: 'Host', access: 'viewer' }],
      isOnline: () => true,
      mayUse: () => true,
      invoke: async (...args) => {
        calls.push(args)
        return args[1] === 'computer.frame'
          ? { mimeType: 'image/png', data: 'AA', width: 10, height: 10, capturedAt: Date.now(), generation: 1 }
          : granted
      },
    }
    const { ComputerActivity } = load(
      'components/ComputerActivity.tsx',
      os,
      {
        react,
        '../runtime/store': { useStore: () => store },
        '@ramu/shared/computerControl': control,
        '@ramu/shared/computerBridge': { COMPUTER_FRAME_STALE_MS: 5000 },
        './useComputerVideo': { useComputerVideo: () => ({ status: 'idle' }), webrtc: () => null },
        'react-native': {
          AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
          PanResponder: { create: () => ({ panHandlers: {} }) },
        },
      },
      { setTimeout: (run) => timers.push(run), clearTimeout() {}, setInterval: () => 1, clearInterval() {} },
    )
    const renderParent = () =>
      parent.render(() => ComputerActivity({ chat: { computerId: 'a', taskId: 'task' }, open: true, onClose() {} }))
    renderParent()
    await settle()
    const viewer = nodes(renderParent()).find((node) => node.type?.name === 'ComputerViewer')
    parent.dispose()
    const child = hookHarness()
    Object.assign(react, child.react)
    store = { ...store, computers: [{ id: 'a', name: 'Host', access: 'owner' }] }
    const render = () => child.render(() => viewer.type(viewer.props))
    render()
    await settle()
    let tree = render()
    for (const node of nodes(tree).filter((node) => node.props.onLayout))
      node.props.onLayout({ nativeEvent: { layout: { width: 200, height: 400 } } })
    tree = render()
    const give = find(tree, 'ControlStrip').props.action
    assert.equal(give.title, 'Give back to agent')
    const type = find(tree, 'RemoteKeyboard').props.onKeys
    store = { ...store, computers: [{ id: 'a', name: 'Host', access: 'viewer' }] }
    tree = render()
    calls.length = 0
    give.onPress()
    type([{ kind: 'text', text: 'Kept text' }])
    await settle()
    assert.deepEqual(calls, [])
    assert.ok(find(tree, 'Image'))
    // A viewer has no control action, no keyboard and no Stop in the menu.
    assert.equal(find(tree, 'ControlStrip').props.action, undefined)
    assert.equal(find(tree, 'RemoteKeyboard'), undefined)
    assert.ok(!find(tree, 'ViewerMenu').props.items.some((item) => item.key === 'stop'))
    assert.deepEqual(calls, [])
    render()
    child.dispose()
    assert.deepEqual(calls, [])
  })
}

function interactiveCardHarness(os, cached = true) {
  const hooks = hookHarness()
  let appearance = theme.useTheme()
  let visible = true,
    appListener,
    evict,
    savedState = null
  const reference = { id: 'content', version: 1, sessionId: 'session', title: 'Calculator', summary: 'Compare costs' }
  const document = {
    reference,
    html: '<main>bundled preview</main>',
    preview: null,
    files: [
      { path: 'index.html', content: '<main>Original source</main>' },
      { path: 'calc.js', content: 'globalThis.mustNeverExecute = true' },
      { path: 'logo.png', content: 'secret-binary-base64', encoding: 'base64' },
    ],
  }
  const calls = [],
    shares = [],
    asks = [],
    leases = []
  const cache = {
    document: () => (cached ? document : null),
    state: () => savedState,
    scenarios: () => [],
    saveDocument() {},
    saveState: (_id, _version, state) => {
      savedState = state
    },
  }
  const store = {
    language: 'en',
    isOnline: () => true,
    mayUse: () => true,
    invoke: async (...args) => {
      calls.push(args)
      return document
    },
  }
  const { InteractiveDocumentCard } = load('components/InteractiveContent.tsx', os, {
    react: { ...hooks.react, useContext: () => visible },
    'react-native': {
      AppState: {
        currentState: 'active',
        addEventListener: (_event, callback) => {
          appListener = callback
          return {
            remove() {
              appListener = undefined
            },
          }
        },
      },
    },
    '../theme': { ...theme, useTheme: () => appearance },
    '../runtime/store': { useStore: () => store },
    '../storage': { contentStorage: {} },
    '@ramu/shared/interactiveStorage': { interactiveStorage: () => cache },
    '@ramu/shared/interactiveTheme': { interactiveThemeVariables: (colors) => ({ '--background': colors.background }) },
    '@ramu/shared/interactiveLease': {
      claimInteractive: (stop, limit) => {
        evict = stop
        leases.push(limit)
        return () => {}
      },
    },
    '@ramu/shared/interactive': {
      interactiveHtml: (html, instance, state, theme) => JSON.stringify({ html, instance, state, theme }),
      readInteractiveState: (state) => (state?.controls ? state : null),
      interactiveFollowup: (_reference, state) => JSON.stringify(state),
    },
    './InteractiveFrame': { default: 'InteractiveFrame' },
    // A share exports the document with the captured scenario, then hands the file to the share sheet.
    '@ramu/shared/interactiveExport': {
      interactiveExport: (...args) => {
        shares.push(args)
        return { name: 'export.html', html: '', mimeType: 'text/html' }
      },
      kindExports: () => [],
      hostExportFormats: () => [],
    },
    '@ramu/shared/artifacts': { artifactKind: (kind) => kind ?? 'app' },
    './interactiveShare': { shareFile: async () => {} },
  })
  return {
    render: () =>
      hooks.render(() =>
        InteractiveDocumentCard({ reference, chat: { computerId: 'host' }, onAsk: (text) => asks.push(text) }),
      ),
    visible: (value) => {
      visible = value
    },
    app: (value) => appListener(value),
    evict: () => evict(),
    state: () => savedState,
    document,
    theme: (scheme, window, canvas) => {
      appearance = {
        scheme,
        c: new Proxy({ window, canvas }, { get: (colors, key) => (key in colors ? colors[key] : palette[key]) }),
      }
    },
    calls,
    shares,
    asks,
    leases,
    dispose: () => hooks.dispose(),
  }
}
for (const os of ['ios', 'android']) {
  test(`${os} interactive cards run on screen, retain declared state and stop offscreen or in background`, async () => {
    const card = interactiveCardHarness(os)
    card.render()
    await settle()
    let tree = card.render()
    let frame = find(tree, 'InteractiveFrame')
    assert.ok(frame)
    assert.equal(
      nodes(tree).some((node) => ['Open interactive', 'Pause'].includes(node.props?.title)),
      false,
    )
    assert.deepEqual(card.leases, [3])
    const state = { controls: [{ key: 'cost', value: '42', checked: false }], custom: null }
    frame.props.onMessage({ ramuInteractive: 1, instance: frame.props.instance, type: 'state', value: state })
    const original = frame.props.instance
    const retainedFrame = frame
    card.visible(false)
    assert.equal(find(card.render(), 'InteractiveFrame'), undefined)
    retainedFrame.props.onMessage({
      ramuInteractive: 1,
      instance: original,
      type: 'state',
      value: { controls: [], custom: 'late' },
    })
    assert.deepEqual(card.state(), state)
    card.visible(true)
    card.render()
    retainedFrame.props.onStop()
    tree = card.render()
    frame = find(tree, 'InteractiveFrame')
    assert.notEqual(frame.props.instance, original)
    assert.deepEqual(JSON.parse(frame.props.html).state, state)
    card.app('background')
    assert.equal(find(card.render(), 'InteractiveFrame'), undefined)
    card.app('active')
    tree = card.render()
    assert.ok(find(tree, 'InteractiveFrame'))
    nodes(tree)
      .find((node) => node.type === 'IconButton' && node.props.label === 'Expand')
      .props.onPress()
    tree = card.render()
    frame = find(tree, 'InteractiveFrame')
    frame.props.onMessage({
      ramuInteractive: 1,
      instance: frame.props.instance,
      type: 'state',
      requestId: frame.props.snapshot,
      value: state,
    })
    tree = card.render()
    assert.equal(nodes(tree).filter((node) => node.type === 'InteractiveFrame').length, 1)
    const expanded = nodes(tree).find(
      (node) => node.type === 'Sheet' && node.props.presentation === 'screen' && node.props.title !== 'Content actions',
    )
    assert.equal(expanded.props.open, true)
    assert.deepEqual(JSON.parse(find(tree, 'InteractiveFrame').props.html).state, state)
    expanded.props.onClose()
    tree = card.render()
    frame = find(tree, 'InteractiveFrame')
    frame.props.onMessage({
      ramuInteractive: 1,
      instance: frame.props.instance,
      type: 'state',
      requestId: frame.props.snapshot,
      value: state,
    })
    tree = card.render()
    assert.equal(nodes(tree).filter((node) => node.type === 'InteractiveFrame').length, 1)
    assert.equal(
      nodes(tree).find(
        (node) =>
          node.type === 'Sheet' && node.props.presentation === 'screen' && node.props.title !== 'Content actions',
      ).props.open,
      false,
    )
    card.dispose()
  })
  test(`${os} interactive code captures current controls and shows exact text files without executing binary or script source`, async () => {
    const card = interactiveCardHarness(os)
    let tree = card.render()
    await settle()
    tree = card.render()
    const press = (title) =>
      nodes(tree)
        .find((node) => (node.type === 'Button' || node.type?.name === 'ContentAction') && node.props.title === title)
        .props.onPress()
    press('Code')
    tree = card.render()
    let frame = find(tree, 'InteractiveFrame')
    assert.ok(frame, 'wait for a snapshot before unmounting the interactive document')
    const state = { controls: [{ key: 'cost', value: '77', checked: false }], custom: null }
    frame.props.onMessage({
      ramuInteractive: 1,
      instance: 'stale',
      type: 'state',
      requestId: frame.props.snapshot,
      value: state,
    })
    assert.equal(card.state(), null)
    frame.props.onMessage({
      ramuInteractive: 1,
      instance: frame.props.instance,
      type: 'state',
      requestId: frame.props.snapshot,
      value: state,
    })
    tree = card.render()
    assert.equal(find(tree, 'InteractiveFrame'), undefined)
    assert.ok(nodes(tree).some((node) => node.type === 'T' && node.props.children === '<main>Original source</main>'))
    press('calc.js')
    tree = card.render()
    assert.ok(
      nodes(tree).some((node) => node.type === 'T' && node.props.children === 'globalThis.mustNeverExecute = true'),
    )
    assert.equal(globalThis.mustNeverExecute, undefined)
    press('logo.png')
    tree = card.render()
    assert.equal(
      nodes(tree).some((node) => node.props?.children === 'secret-binary-base64'),
      false,
    )
    assert.ok(nodes(tree).some((node) => node.props?.children === 'Binary file'))
    press('Share HTML')
    await settle()
    assert.deepEqual(card.shares[0][1], state)
    press('Ask about this')
    assert.deepEqual(JSON.parse(card.asks[0]), state)
    press('Preview')
    frame = find(card.render(), 'InteractiveFrame')
    assert.deepEqual(JSON.parse(frame.props.html).state, state)
    assert.equal(
      card.calls.some((call) => call[1] !== 'interactive.get'),
      false,
    )
    card.dispose()
  })
  test(`${os} stopped or evicted interactive cards wait for reload and uncached documents load without an Open step`, async () => {
    const card = interactiveCardHarness(os, false)
    assert.equal(find(card.render(), 'InteractiveFrame'), undefined)
    await settle()
    let tree = card.render()
    assert.ok(find(tree, 'InteractiveFrame'))
    card.evict()
    tree = card.render()
    assert.equal(find(tree, 'InteractiveFrame'), undefined)
    assert.equal(find(card.render(), 'InteractiveFrame'), undefined, 'rendering cannot reclaim an evicted lease')
    nodes(tree)
      .find((node) => node.props?.title === 'Reload')
      .props.onPress()
    tree = card.render()
    find(tree, 'InteractiveFrame').props.onStop()
    tree = card.render()
    assert.equal(find(tree, 'InteractiveFrame'), undefined)
    assert.ok(nodes(tree).some((node) => node.props?.title === 'Reload'))
    card.dispose()
  })
}

for (const os of ['ios', 'android']) {
  test(`${os} browser drags scroll during movement and retain deltas behind pending input`, async () => {
    const hooks = hookHarness(),
      calls = [],
      timers = []
    let pan, finish
    const tab = {
      id: 'tab',
      generation: 1,
      controller: 'human',
      profileId: 'default',
      inputReady: true,
      url: 'https://site.example',
    }
    const store = {
      language: 'en',
      computers: [{ id: 'a', name: 'Host', access: 'owner' }],
      isOnline: () => true,
      mayUse: () => true,
      invoke: async (...args) => {
        calls.push(args)
        if (args[1] === 'hostBrowser.list') return [tab]
        if (args[1] === 'hostBrowser.take') return tab
        if (args[1] === 'hostBrowser.nextFrame')
          return { mimeType: 'image/jpeg', data: 'frame', width: 400, height: 300, sequence: 1 }
        if (args[1] === 'hostBrowser.input')
          return new Promise((resolve) => {
            finish = resolve
          })
        return null
      },
    }
    const { BrowserViewer } = load(
      'components/BrowserViewer.tsx',
      os,
      {
        react: hooks.react,
        '../runtime/store': { useStore: () => store },
        './SheetOptions': {
          SheetGroup: 'SheetGroup',
          SheetOption: 'SheetOption',
          SheetPanelGroup: 'SheetPanelGroup',
          useSheetInputStyle: () => ({}),
        },
        'react-native': {
          AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
          PanResponder: {
            create: (config) => {
              pan ??= config
              return { panHandlers: {} }
            },
          },
        },
      },
      { setTimeout: (run) => timers.push(run), clearTimeout() {} },
    )
    const render = () =>
      hooks.render(() => BrowserViewer({ chat: { computerId: 'a', taskId: 'task' }, embedded: true, onClose() {} }))
    render()
    await settle()
    render()
    await settle()
    let tree = render()
    // The page area is measured first; the touch surface is then sized to the drawn frame.
    for (const node of nodes(tree).filter((node) => node.props.onLayout))
      node.props.onLayout({ nativeEvent: { layout: { width: 200, height: 400 } } })
    tree = render()
    assert.equal(find(tree, 'ControlStrip').props.action.title, 'Take control')
    find(tree, 'ControlStrip').props.action.onPress()
    await settle()
    render()
    await settle()
    render()
    assert.equal(pan.onStartShouldSetPanResponder(), true)
    pan.onPanResponderGrant({ nativeEvent: { locationX: 40, locationY: 40 } })
    pan.onPanResponderMove({}, { dx: 0, dy: -20 })
    assert.equal(calls.filter((call) => call[1] === 'hostBrowser.input').length, 1, 'scroll is sent before release')
    pan.onPanResponderMove({}, { dx: 0, dy: -35 })
    pan.onPanResponderRelease({ nativeEvent: { locationX: 40, locationY: 40 } }, { dx: 0, dy: -50 })
    finish()
    await settle()
    const inputs = calls.filter((call) => call[1] === 'hostBrowser.input').map((call) => call.at(-1))
    assert.deepEqual(
      inputs.map((input) => input.kind),
      ['scroll', 'scroll'],
    )
    assert.equal(
      inputs.reduce((total, input) => total + input.y, 0),
      100,
    )
    finish()
    await settle()
    // Release events can report coordinates from a nested native target. Only the original
    // surface-local touch plus its displacement may determine the browser click.
    tree = render()
    const image = nodes(tree).find((node) => node.props?.source?.uri?.includes('frame'))
    assert.equal(image.props.pointerEvents, 'none')
    assert.ok(nodes(tree).some((node) => node.props.pointerEvents === 'box-only' && node.props.collapsable === false))
    pan.onPanResponderGrant({ nativeEvent: { locationX: 50, locationY: 60 } })
    pan.onPanResponderRelease({ nativeEvent: { locationX: 999, locationY: 999 } }, { dx: 0, dy: 0 })
    const click = calls
      .filter((call) => call[1] === 'hostBrowser.input')
      .at(-1)
      .at(-1)
    assert.equal(click.kind, 'click')
    assert.equal(click.x, 0.25)
    assert.equal(click.y, 0.4)
    finish()
    await settle()
    pan.onPanResponderGrant({ nativeEvent: { locationX: 150, locationY: 60 } })
    pan.onPanResponderRelease({ nativeEvent: { locationX: 0, locationY: 0 } }, { dx: 0, dy: 0 })
    const nextClick = calls
      .filter((call) => call[1] === 'hostBrowser.input')
      .at(-1)
      .at(-1)
    assert.equal(nextClick.x, 0.75)
    assert.equal(nextClick.clickCount, 1, 'rapid taps on different targets are separate clicks')
    finish()
    await settle()
    const count = calls.filter((call) => call[1] === 'hostBrowser.input').length
    pan.onPanResponderGrant({ nativeEvent: { locationX: 50, locationY: 60 } })
    nodes(tree)
      .find((node) => node.props.onLayout)
      .props.onLayout({ nativeEvent: { layout: { width: 300, height: 400 } } })
    render()
    pan.onPanResponderRelease({ nativeEvent: { locationX: 50, locationY: 60 } }, { dx: 0, dy: 0 })
    assert.equal(
      calls.filter((call) => call[1] === 'hostBrowser.input').length,
      count,
      'rotation cancels an old-frame tap',
    )
  })
}

for (const os of ['ios', 'android']) {
  test(`${os} reference chips match desktop accent links and inherit surrounding type`, () => {
    const { ReferenceBadge } = load('components/ReferenceChip.tsx', os)
    let opened = 0
    const chip = { kind: 'file', label: 'app.ts:12', title: '/workspace/src/app.ts:12' }
    const tree = ReferenceBadge({ chip, onPress: () => opened++ })
    assert.equal(tree.props.accessibilityRole, 'link')
    assert.equal(tree.props.accessibilityLabel, chip.title)
    assert.equal(tree.props.style.color, palette.accent)
    assert.equal(tree.props.style.fontWeight, chatPresentation.REFERENCE_APPEARANCE.fontWeight)
    assert.equal(tree.props.style.backgroundColor, undefined)
    assert.equal(tree.props.style.fontSize, undefined)
    assert.equal(tree.props.style.fontFamily, undefined)
    tree.props.onPress()
    assert.equal(opened, 1)
    assert.ok(tree.props.children.includes('app.ts:12'))
  })
}

for (const os of ['ios', 'android']) {
  test(`${os} notification routing waits for hydration and opens a cold/live tap only once`, async () => {
    const hooks = hookHarness()
    let now = 1000
    const navigations = [],
      selected = []
    let reads = 0,
      cleared = 0,
      listener
    const response = {
      actionIdentifier: 'default',
      notification: {
        request: { identifier: 'notification-1', content: { data: { computerId: 'host', taskId: 'task' } } },
      },
    }
    const store = {
      ready: false,
      computers: [],
      select: (id) => selected.push(id),
      refresh: async () => {},
      resolveChat: (host, task) => `${host}:${task}`,
    }
    const { PushRouting } = load(
      'components/PushRouting.tsx',
      os,
      {
        react: hooks.react,
        'expo-constants': { default: { appOwnership: 'standalone' } },
        'expo-notifications': {
          setNotificationHandler() {},
          addNotificationResponseReceivedListener: (callback) => {
            listener = callback
            return { remove() {} }
          },
          getLastNotificationResponseAsync: async () => {
            reads++
            return response
          },
          clearLastNotificationResponseAsync: async () => {
            cleared++
          },
        },
        'expo-router': { useRouter: () => ({ push: (path) => navigations.push(path) }) },
        '../runtime/store': { useStore: () => store },
        '../runtime/pushTarget': {
          pushTarget: (data, known) => (known.includes(data.computerId) ? { kind: 'thread', ...data } : null),
        },
      },
      { Date: { now: () => now } },
    )
    hooks.render(PushRouting)
    await settle()
    assert.equal(reads, 0, 'do not consume a notification before saved pairings are restored')
    store.ready = true
    store.computers = [{ id: 'host' }]
    hooks.render(PushRouting)
    await settle()
    listener(response)
    await settle()
    assert.equal(reads, 1)
    assert.equal(cleared, 1)
    assert.equal(navigations.length, 1)
    assert.deepEqual(selected, ['host'])
    assert.equal(navigations[0].params.id, 'host:task')
    now += 3000
    listener(response)
    await settle()
    assert.equal(navigations.length, 2, 'a deliberate later tap on the same notification can reopen its thread')
    hooks.dispose()
  })

  test(`${os} shared action labels scale and their controls can grow with large text`, () => {
    const scaledTheme = { ...theme, TEXT_SCALE: { large: 1.3 }, useTheme: () => ({ c: palette, textSize: 'large' }) }
    const ui = load('components/ui.tsx', os, { '../theme': scaledTheme })
    const button = ui.Button({ title: 'A long translated action' })
    const label = find(button, 'Text')
    assert.equal(label.props.style.fontSize, (theme.font.control + 1) * 1.3)
    const style = Object.assign({}, ...button.props.style({ pressed: false }).flat(Infinity).filter(Boolean))
    assert.equal(style.height, undefined, 'fixed heights clip wrapped or enlarged labels')
    assert.ok(style.minHeight >= 44)
    assert.equal(label.props.style.flexShrink, 1)
    const screen = load('components/Screen.tsx', os)
    const glass = screen.GlassButton({ title: 'Pair', disabled: true })
    if (os === 'ios') {
      assert.equal(glass.props.accessibilityState.disabled, true)
      assert.equal(glass.props.accessibilityLabel, 'Pair')
      const surface = find(glass, 'Glass')
      assert.equal(surface.props.style.height, undefined)
      assert.equal(surface.props.style.minHeight, 48)
    } else {
      const style = Object.assign({}, ...glass.props.style.flat())
      assert.equal(style.height, undefined)
      assert.equal(style.minHeight, 48)
    }
    const segments = ui.Segmented({ value: 'a', onChange() {}, options: [{ key: 'a', label: 'Translated tab' }] })
    assert.equal(find(segments, 'Pressable').props.style.height, undefined)
    assert.ok(find(segments, 'Pressable').props.style.minHeight >= 44)
  })
}

test('Android reopening a closing sheet keeps the new sheet visible and ignores old dismissal', async () => {
  const hooks = hookHarness(),
    hiding = deferred()
  let closed = 0
  const { MaterialSheet } = load('components/MaterialSheet.android.tsx', 'android', {
    react: hooks.react,
    '@expo/ui/jetpack-compose': { Host: 'Host', ModalBottomSheet: 'MaterialBottomSheet', RNHostView: 'RNHostView' },
  })
  let open = true
  const render = () => hooks.render(() => MaterialSheet({ open, onClose: () => closed++, children: 'form' }))
  const original = find(render(), 'MaterialBottomSheet')
  original.props.ref.current = { hide: () => hiding.promise }
  open = false
  render()
  open = true
  render()
  const reopened = find(render(), 'MaterialBottomSheet')
  assert.notEqual(reopened.key, original.key, 'a hiding native sheet must be recreated on reopen')
  original.props.onDismissRequest()
  assert.equal(closed, 0)
  hiding.resolve()
  await settle()
  assert.ok(find(render(), 'MaterialBottomSheet'), 'the old hide completion cannot remove a reopened sheet')
  reopened.props.onDismissRequest()
  assert.equal(closed, 1)
  hooks.dispose()
})

test('mobile web startup applies its theme without calling a native-only Appearance API', () => {
  const hooks = hookHarness()
  const { ThemeProvider } = load('theme/index.tsx', 'web', {
    react: { ...hooks.react, createContext: () => ({ Provider: 'ThemeProvider' }) },
    'react-native': { Appearance: {}, useColorScheme: () => 'light' },
    '@ramu/shared/theme': { DEFAULT_THEME: { id: 'default' } },
    '@ramu/shared/themePresets': { themePreset: () => undefined, THEME_PRESETS: [] },
    '../storage': {
      readAppearance: () => 'dark',
      readTextSize: () => 'normal',
      readSelectedThemeId: () => '',
      readThemeLibraryText: () => '[]',
    },
  })
  const tree = hooks.render(() => ThemeProvider({ children: 'app' }))
  assert.equal(tree.props.value.scheme, 'dark')
  assert.equal(tree.props.children, 'app')
  hooks.dispose()
})

for (const os of ['ios', 'android']) {
  test(`${os} Settings sections opt into the centered native title`, () => {
    const { default: Section } = load('app/settings/[section].tsx', os, {
      'expo-router': { useLocalSearchParams: () => ({ section: 'about' }) },
      '../../runtime/settingsModel': settingsModel,
      '../../runtime/store': {
        useStore: () => ({ language: 'en', selected: null, computers: [], mayUse: () => true }),
      },
      '../../runtime/useHostSettings': { useHostSettings: () => ({ state: { status: 'offline' } }) },
    })
    const header = find(Section(), 'Header')
    assert.equal(header.props.align, 'center')
    const screen = load('components/Screen.tsx', os, {
      'expo-router': { Stack: { ...Stack, Title: 'NativeTitle', Header: 'NativeHeader' } },
    })
    const native = screen.Header({ ...header.props, modal: true })
    assert.equal(find(native, 'StackScreen').props.options.headerTitleAlign, 'center')
    if (os === 'ios') {
      assert.equal(find(native, 'NativeTitle').props.children, header.props.title)
      assert.ok(find(native, 'ToolbarButton'), 'the native Close action remains available')
    }
  })
}

test('native profile saves serialize async writes, freeze snapshots, and recover after a failed save', async () => {
  const files = new Map(),
    pending = deferred()
  let writes = 0,
    fail = false
  class File {
    constructor(...parts) {
      this.path = parts.join('/')
    }
    get exists() {
      return files.has(this.path)
    }
    textSync() {
      return files.get(this.path)
    }
    async text() {
      return this.textSync()
    }
    async write(text) {
      if (++writes === 1) await pending.promise
      if (fail) throw Error('disk unavailable')
      files.set(this.path, text)
    }
    delete() {
      files.delete(this.path)
    }
  }
  const storage = load('storage/index.ts', 'ios', {
    'expo-file-system': { File, Paths: { document: 'document' } },
    './localCommit': localCommitStorage,
  })
  const first = { drafts: { text: 'first' } }
  const saving = storage.writeLocal(first)
  const newer = storage.writeLocal({ drafts: { text: 'newer' } })
  first.drafts.text = 'mutated after save request'
  await settle()
  assert.equal(writes, 1, 'the second commit cannot run while the first native write is pending')
  pending.resolve()
  await Promise.all([saving, newer])
  assert.equal(storage.readLocal({}).drafts.text, 'newer')
  assert.ok([...files.values()].some((text) => text.includes('first')))
  fail = true
  await assert.rejects(storage.writeLocal({ drafts: {} }), /disk unavailable/)
  assert.equal(storage.readLocal({}).drafts.text, 'newer')
  fail = false
  await storage.writeLocal({ drafts: { text: 'retry' } })
  assert.equal(storage.readLocal({}).drafts.text, 'retry')
})

for (const os of ['ios', 'android']) {
  test(`${os} thread settings show one phone control for busy messages and one model warning`, () => {
    const drafts = {},
      writes = []
    const store = {
      mayUse: () => true,
      selected: 'host',
      language: 'en',
      computers: [],
      drafts,
      mobileLayers: {},
      appPreferences: { host: { busyMessageAction: 'queue', warnModelChange: false } },
      setDraft: (key, value) => {
        drafts[key] = value
        writes.push([key, value])
      },
    }
    const { default: Section } = load('app/settings/[section].tsx', os, {
      'expo-router': { useLocalSearchParams: () => ({ section: 'chats' }) },
      '../../runtime/settingsModel': settingsModel,
      '../../runtime/store': { useStore: () => store },
      '../../runtime/useHostSettings': { useHostSettings: () => ({ state: { status: 'offline' } }) },
      '../../runtime/busyMode': phoneBehavior,
      '../../i18n': { useT: () => new Proxy({}, { get: (_, key) => key }) },
    })
    const component = nodes(Section()).find(
      (node) => typeof node.type === 'function' && node.type.name === 'BusyBehavior',
    )
    const render = () => component.type(component.props)
    const controls = nodes(render()).filter((node) => node.type === 'Segmented')
    assert.equal(controls.length, 2)
    assert.equal(controls[0].props.value, 'queue')
    assert.equal(controls[1].props.value, 'off')
    controls[0].props.onChange('steer')
    controls[1].props.onChange('on')
    assert.equal(drafts[phoneBehavior.BUSY_MODE_DEVICE_KEY], 'steer')
    assert.equal(drafts[phoneBehavior.MODEL_WARNING_DEVICE_KEY], 'on')
    assert.equal(store.appPreferences.host.busyMessageAction, 'queue', 'phone choices never change the host default')
    assert.equal(writes.length, 2)
    const paths = settingsModel.SETTINGS_ROWS.chats.flatMap((group) => group.rows.map((row) => row.path))
    assert.ok(!paths.includes('busyMessageAction') && !paths.includes('warnModelChange'))
    assert.equal(settingsModel.searchSettings('steer', []).length, 1)
  })
}

test('plan usage uses a full-screen settings surface and groups windows under readable account names', async () => {
  const presentation = await import('../../../packages/shared/src/usage/presentation.ts')
  const providers = await import('../../../packages/shared/src/providers/providers.ts')
  const hooks = hookHarness()
  const account = 'ce55402d-b25f-41ee-98f0-6eb5c5b7462f'
  const readings = ['default', account].flatMap((accountId) =>
    ['five_hour', 'weekly'].map((window) => ({
      provider: 'claude-code',
      accountId,
      window,
      usedPercent: 12,
      status: 'ok',
      updatedAt: Date.now(),
    })),
  )
  const store = {
    language: 'en',
    computers: [{ id: 'host', name: 'Laptop' }],
    appPreferences: {},
    usage: { host: readings },
    drafts: {},
    setDraft: (key, value) => {
      store.drafts[key] = value
    },
    isOnline: () => false,
    mayUse: () => true,
  }
  const { PlanUsageSheet, PlanUsageReading } = load('components/PlanUsage.tsx', 'ios', {
    react: hooks.react,
    '@ramu/shared/usage/presentation': presentation,
    '@ramu/shared/providers/providers': providers,
    '../runtime/store': { useStore: () => store },
    '../runtime/types': { providerNames: { 'claude-code': 'Claude Code' } },
    '../runtime/useAccountLogins': {
      useAccountLogins: () => ({ host: { 'claude-code': { [account]: { email: 'me@work.com', apiKey: true } } } }),
    },
  })
  const render = () => hooks.render(() => PlanUsageSheet({ hosts: ['host'], open: true, onClose() {} }))
  const tree = render()
  assert.equal(find(tree, 'Sheet').props.presentation, 'screen')
  const headings = nodes(tree)
    .filter((node) => node.type === 'T' && node.props.weight === '600')
    .map((node) => [node.props.children].flat().join(''))
  assert.deepEqual(headings, ['Claude Code · Default CLI account', 'Claude Code · me@work.com · API key'])
  assert.equal(
    nodes(tree).filter((node) => node.type === PlanUsageReading).length,
    4,
    'every quota window remains visible',
  )
  assert.equal(
    nodes(tree).filter((node) => node.type === 'T' && node.props.weight === '600').length,
    2,
    'one heading per account',
  )
  assert.ok(
    !nodes(tree).some((node) => node.props?.children === account),
    'opaque IDs stay out of the normal reading flow',
  )
  assert.ok(!nodes(tree).some((node) => node.type === 'Toggle'), 'account details show on the plan, with no toggle')
  hooks.dispose()
})

test('combined file changes have no All tab and an empty diff explains that there are no changes', async () => {
  const hooks = hookHarness(),
    calls = []
  const store = {
    computers: [{ id: 'host', access: 'full' }],
    chats: [],
    projects: [],
    drafts: {},
    isOnline: () => true,
    mayUse: () => true,
    invoke: async (...args) => {
      calls.push(args)
      if (args[1] === 'files.explorerBindings') return [{ repoId: 'repo', setupState: 'ready', repoName: 'Repo' }]
      if (args[1] === 'git.diff') return { original: 'same', modified: 'same' }
      throw Error(`Unexpected ${args[1]}`)
    },
  }
  const { FileViewer } = load('components/FileViewer.tsx', 'ios', {
    react: hooks.react,
    '../runtime/store': { useStore: () => store },
    '../runtime/useWorkspaces': { useWorkspaces: () => ({ host: 'host', rows: [] }) },
    '../i18n': { useT: () => ({ fileNoChanges: 'No changes in this file.' }) },
  })
  const render = () =>
    hooks.render(() =>
      FileViewer({ computerId: 'host', contextId: 'project:p', repoId: 'repo', path: 'readme.md', initial: 'all' }),
    )
  render()
  await settle()
  render()
  await settle()
  const tree = render()
  assert.deepEqual(
    Array.from(find(tree, 'Segmented').props.options, (option) => option.key),
    ['file', 'changes', 'staged'],
  )
  assert.equal(find(tree, 'Segmented').props.value, 'changes')
  assert.equal(calls.find((call) => call[1] === 'git.diff').at(-1), 'all')
  assert.ok(nodes(tree).some((node) => node.props?.children === 'No changes in this file.'))
  assert.ok(!nodes(tree).some((node) => node.props?.children === 'all'))
  hooks.dispose()
})

test('native sharing waits for the asynchronous file write before opening the system share sheet', async () => {
  const writing = deferred(),
    shared = []
  class File {
    exists = false
    uri = 'file:///cache/shared.txt'
    create() {}
    write() {
      return writing.promise
    }
  }
  const { shareDownloadedFile } = load('runtime/explorerShare.ts', 'ios', {
    'expo-file-system': { File, Paths: { cache: 'cache' } },
    'expo-sharing': { isAvailableAsync: async () => true, shareAsync: async (uri) => shared.push(uri) },
  })
  const pending = shareDownloadedFile('file.txt', 'content')
  await settle()
  assert.deepEqual(shared, [])
  writing.resolve()
  assert.equal(await pending, true)
  assert.deepEqual(shared, ['file:///cache/shared.txt'])
})

for (const os of ['ios', 'android']) {
  test(`${os} content actions use grouped full-screen rows with one primary save action`, async () => {
    const card = interactiveCardHarness(os)
    card.render()
    await settle()
    const sheet = nodes(card.render()).find((node) => node.type === 'Sheet' && node.props.title === 'Content actions')
    assert.equal(sheet.props.presentation, 'screen')
    const actions = nodes(sheet).filter((node) => node.type?.name === 'ContentAction')
    assert.ok(actions.length >= 5)
    for (const action of actions) {
      const row = action.type(action.props)
      assert.equal(row.props.accessibilityRole, 'button')
      assert.equal(row.props.accessibilityLabel, action.props.title)
    }
    const primary = nodes(sheet).filter(
      (node) => node.type === 'Button' && (!node.props.kind || node.props.kind === 'primary'),
    )
    assert.equal(primary.length, 1)
    assert.equal(primary[0].props.title, 'Save scenario')
    card.dispose()
  })
}

function deliveryStoreHarness() {
  const hooks = hookHarness()
  const refs = []
  const calls = []
  const bindingRead = deferred()
  const threadStart = { current: null }
  let holdBindings = true
  const initial = {
    computers: [{ id: 'a', name: 'Host', status: 'online' }],
    chats: [
      { id: 'a:chat', computerId: 'a', taskId: 'task', sessionId: 'session', items: [], queue: [], status: 'running' },
    ],
    projects: [],
    drafts: {},
    outbox: [],
  }
  const snapshot = {
    reset: true,
    cursor: 5,
    revision: 5,
    events: [
      { seq: 1, event: { kind: 'user', text: 'Go', at: 1 } },
      { seq: 2, event: { kind: 'text', text: 'Finished while the phone was away.' } },
      { seq: 3, event: { kind: 'state', state: 'idle' } },
    ],
  }
  const invoke = async (method, ...args) => {
    calls.push([method, ...args])
    if (method === 'tasks.list') return [{ id: 'task', projectId: 'no-project', status: 'ready-for-review' }]
    if (method === 'agent.all') return [{ id: 'session', taskId: 'task', createdAt: 1, state: 'idle', settings: {} }]
    if (method === 'agent.changes') return snapshot
    if (method === 'agent.tail') return { complete: true, events: snapshot.events }
    if (method === 'tasks.bindings') return holdBindings ? bindingRead.promise : []
    if (method === 'agent.goal' || method === 'settings.models.get') return null
    if (method === 'preferences.layers.get') return { mobile: null }
    if (method === 'settings.app.get') return {}
    if (method === 'thread.start')
      return threadStart.current
        ? threadStart.current()
        : { task: { id: 'new-task', workspaceId: 'w', projectId: 'no-project' }, session: { id: 'new-session' } }
    if (method === 'tasks.create') return { id: 'new-task', workspaceId: 'w', projectId: 'no-project' }
    if (method === 'agent.start') return { id: 'new-session' }
    return []
  }
  const { StoreProvider } = load('runtime/store.tsx', 'ios', {
    './hostConnection': hostConnection,
    react: {
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
      writeLocal: async () => {},
      readSendJournal: () => [],
      readDrafts: () => null,
      writeDrafts: () => {},
      writeSendJournal() {},
    },
    './refreshDepth': load('runtime/refreshDepth.ts', 'ios'),
    './threadActivity': { normalizeHelperGroups: (rows) => rows },
    './newChatHost': { newChatHost: () => 'a' },
    './workspaces': workspaceChoices,
    './transport': (() => {
      class HostError extends Error {}
      return { HostError, SuspendedError: class extends HostError {} }
    })(),
    './transcript': mobileTranscript,
    '@ramu/shared/chat/agentActivity': {
      agentActivityLabel: () => null,
      currentStep: () => null,
      turnSteps: () => [],
      turnStartedAt: () => null,
    },
    '@ramu/shared/chat/inputSummary': { inputSummary: () => null },
    '@ramu/shared/chat/compaction': { isCompacting: () => false },
    '@ramu/shared/chat/helperPresentation': { runningCommands: () => [] },
    '@ramu/shared/chat/threadStatus': { newerTaskSnapshot: (_, next) => next },
  })
  const render = () => hooks.render(() => StoreProvider({ children: null })).props.value
  render()
  const state = refs[0]
  const connections = refs[1]
  const attach = () => {
    const connection = { controller: new AbortController(), client: { invoke } }
    connections.current.set('a', connection)
    state.current.computers[0].status = 'online'
    return connection
  }
  return {
    render,
    state,
    calls,
    threadStart,
    attach,
    release() {
      holdBindings = false
      bindingRead.resolve([])
    },
    dispose: () => hooks.dispose(),
  }
}

test('an acknowledged send never leaves an empty transcript during the host snapshot handoff', async () => {
  const h = deliveryStoreHarness()
  h.attach()
  await h.render().send('a:chat', 'Go', 'send')
  await settle()
  assert.equal(h.state.current.outbox[0].state, 'accepted')
  assert.equal(h.state.current.outbox[0].text, 'Go')
  assert.equal(h.state.current.chats[0].items.length, 0)
  h.release()
  await settle()
  assert.equal(h.state.current.outbox.length, 0)
  assert.equal(h.state.current.chats[0].items[0].text, 'Go')
  assert.equal(h.calls.filter(([method]) => method === 'agent.submit').length, 1)
  h.dispose()
})

test('a new thread is created and started with one host call, without a plan or setup on the current checkout', async () => {
  const h = deliveryStoreHarness()
  h.attach()
  await h.render().createChat({
    computerId: 'a',
    projectId: 'no-project',
    text: 'Hi',
    mode: 'current',
    provider: 'claude-code',
    model: '',
    effort: '',
  })
  await settle()
  const order = h.calls
    .map(([method]) => method)
    .filter((method) => /^(repos|tasks)\.(plan|create|setup)$|^agent\.start$|^thread\.start$/.test(method))
  assert.deepEqual(order, ['thread.start'], 'one host call creates the thread and starts the agent')
  assert.equal(h.state.current.chats.find((chat) => chat.taskId === 'new-task').sessionId, 'new-session')
  h.dispose()
})

const newThread = {
  computerId: 'a',
  projectId: 'no-project',
  text: 'Hi',
  mode: 'current',
  provider: 'claude-code',
  model: '',
  effort: '',
}

test('a thread whose start failed on the host is kept, so the retry starts it instead of creating another', async () => {
  const h = deliveryStoreHarness()
  h.attach()
  h.threadStart.current = () => ({
    task: { id: 'new-task', workspaceId: 'w' },
    session: null,
    error: 'Provider unavailable',
  })
  await h.render().createChat(newThread)
  await settle()
  const [item] = h.state.current.outbox
  assert.equal(item.state, 'uncertain')
  assert.equal(item.error, 'Provider unavailable')
  const chat = h.state.current.chats.find((c) => c.taskId === 'new-task')
  assert.ok(chat, 'the host thread is adopted')
  assert.equal(chat.sessionId, null)
  h.dispose()
})

test('a refresh interrupted mid-stream recovers all missed text on the next connection', async () => {
  const h = deliveryStoreHarness()
  const old = h.attach()
  const first = h.render().refresh('a', true)
  await settle()
  old.controller.abort()
  h.attach()
  h.release()
  await first
  assert.equal(h.state.current.chats[0].items.length, 0, 'an old connection cannot replace the visible transcript')
  await h.render().refresh('a', true)
  assert.equal(
    h.state.current.chats[0].items.find((row) => row.kind === 'text').text,
    'Finished while the phone was away.',
  )
  assert.equal(h.state.current.chats[0].executionState, 'idle')
  assert.deepEqual(
    h.calls.filter(([method]) => method === 'agent.changes').map((call) => call[2]),
    [],
    'a thread nobody has open reads its tail, with no catch-up cursor to consume',
  )
  h.dispose()
})

test('the top toolbar Search action opens the root search screen', () => {
  const pushed = []
  const { useTabActions } = load('components/Overlays.tsx', 'ios', {
    'expo-router': { useRouter: () => ({ push: (path) => pushed.push(path) }) },
    '../i18n': { useT: () => ({ settings: 'Settings', searchTab: 'Search' }) },
  })
  const action = nodes(useTabActions()).find((node) => node.type === 'HeaderButton' && node.props.label === 'Search')
  assert.equal(action.props.systemIcon, 'magnifyingglass')
  action.props.onPress()
  assert.deepEqual(pushed, ['/search'])
})

for (const status of ['online', 'offline', 'revoked', null]) {
  test(`New thread tab ${status ?? 'unpaired'} reuses the composer or provides pairing`, () => {
    const pushed = []
    const ComposerScreen = () => null
    const { default: NewThreadTab } = load('app/(tabs)/compose/index.tsx', 'ios', {
      '../../new': { default: ComposerScreen },
      '../../../runtime/store': { useStore: () => ({ selected: 'a', computers: status ? [{ id: 'a', status }] : [] }) },
      '../../../i18n': { useT: () => ({ newChat: 'New thread', pair: 'Pair host' }) },
      'expo-router': { useRouter: () => ({ push: (path) => pushed.push(path) }) },
    })
    const tree = NewThreadTab()
    if (status === 'online' || status === 'offline') {
      assert.equal(tree.type, ComposerScreen)
      assert.equal(tree.props.asTab, true)
      assert.equal(tree.key, 'a')
    } else {
      const pair = nodes(tree).find((node) => node.type === 'Button' && node.props.title === 'Pair host')
      pair.props.onPress()
      assert.deepEqual(pushed, ['/pair'])
      assert.equal(find(tree, 'Header').props.back, false)
    }
  })
}

test('iOS dialogs use a native sheet, navigation stack, close action and scroll-edge surface', () => {
  const native = {
    Host: 'SwiftHost',
    BottomSheet: 'SwiftSheet',
    NavigationStack: 'SwiftStack',
    RNHostView: 'RNHost',
    ScrollView: 'SwiftScroll',
    Button: 'SwiftButton',
    ToolbarItem: 'SwiftToolbarItem',
    Toolbar: Object.assign(() => null, { Content: 'SwiftToolbarContent' }),
  }
  const modifiers = new Proxy(
    {},
    {
      get:
        (_, name) =>
        (...args) => ({ name, args }),
    },
  )
  const { NativeSheet } = load('components/NativeSheet.ios.tsx', 'ios', {
    '@expo/ui/swift-ui': native,
    '@expo/ui/swift-ui/modifiers': modifiers,
  })
  let closed = 0
  const tree = NativeSheet({ open: true, title: 'Plan usage', onClose: () => closed++, children: 'Readings' })
  assert.equal(find(tree, 'SwiftSheet').props.isPresented, true)
  assert.equal(find(tree, 'SwiftScroll').props.modifiers[0].name, 'scrollEdgeEffectStyle')
  const stack = find(tree, 'SwiftStack')
  assert.equal(stack.props.modifiers.find((m) => m.name === 'presentationBackground').args[0], 'window')
  assert.deepEqual(
    JSON.parse(JSON.stringify(stack.props.modifiers.find((m) => m.name === 'presentationDetents').args[0])),
    ['medium', 'large'],
  )
  const toolbar = nodes(tree).find((node) => node.type === native.Toolbar)
  assert.equal(toolbar.props.modifiers.find((m) => m.name === 'navigationTitle').args[0], 'Plan usage')
  assert.equal(find(tree, 'SwiftButton').props.role, 'close')
  find(tree, 'SwiftButton').props.onPress()
  assert.equal(closed, 1)
  find(tree, 'SwiftSheet').props.onIsPresentedChange(false)
  assert.equal(closed, 2)
  const large = NativeSheet({
    open: true,
    title: 'Questions',
    presentation: 'screen',
    scroll: false,
    onClose() {},
    children: 'Form',
  })
  assert.equal(find(large, 'SwiftScroll'), undefined, 'self-scrolling content has no nested scroll view')
  assert.equal(find(large, 'RNHost').props.matchContents, false)
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(find(large, 'SwiftStack').props.modifiers.find((m) => m.name === 'presentationDetents').args[0]),
    ),
    ['large'],
  )
})

test('the shared Sheet routes every iOS dialog, including full workflows, through native navigation', () => {
  for (const presentation of [undefined, 'screen']) {
    const hooks = hookHarness()
    const ui = load('components/ui.tsx', 'ios', {
      react: { ...require('react'), ...hooks.react },
      './NativeSheet': { NativeSheet: 'NativeSheet' },
    })
    const lazy = ui.Sheet({ open: true, title: 'Choose a project', children: 'Projects', onClose() {}, presentation })
    const tree = hooks.render(() => lazy.type(lazy.props))
    assert.equal(tree.type, 'NativeSheet')
    assert.equal(tree.props.title, 'Choose a project')
    assert.equal(tree.props.presentation, presentation)
  }
})

test('an iOS sheet that has never opened renders nothing, so screen updates do not redraw it', () => {
  const hooks = hookHarness()
  const ui = load('components/ui.tsx', 'ios', {
    react: { ...require('react'), ...hooks.react },
    './NativeSheet': { NativeSheet: 'NativeSheet' },
  })
  const lazy = ui.Sheet({ open: false, title: 'Usage', children: 'Readings', onClose() {} })
  assert.equal(
    hooks.render(() => lazy.type(lazy.props)),
    null,
  )
})

test('Settings uses a native scroll edge and gains a raised background after content scrolls underneath', () => {
  const screen = load('components/Screen.tsx', 'ios', { 'react-native': { Platform: { OS: 'ios', Version: 26 } } })
  const atTop = screen.Header({ title: 'Settings', align: 'center', scrollEdge: true, scrolled: false })
  const scrolled = screen.Header({ title: 'Settings', align: 'center', scrollEdge: true, scrolled: true })
  assert.equal(find(atTop, 'StackScreen').props.options.headerTransparent, true)
  assert.equal(find(atTop, 'StackScreen').props.options.headerStyle.backgroundColor, 'transparent')
  assert.equal(find(scrolled, 'StackScreen').props.options.headerStyle.backgroundColor, 'raised2')
  assert.equal(find(scrolled, 'StackScreen').props.options.scrollEdgeEffects.top, 'soft')
})

test('Threads uses native toolbar buttons and its usage action opens the shared dialog', () => {
  const hooks = hookHarness()
  const react = { ...require('react'), ...hooks.react }
  const screen = load('components/Screen.tsx', 'ios', {
    react,
    './ui': new Proxy({ tap() {} }, { get: (target, key) => (key in target ? target[key] : String(key)) }),
    'react-native': { Platform: { OS: 'ios', Version: 26 }, UIManager: { hasViewManagerConfig: () => true } },
  })
  const { jsx, jsxs } = require('react/jsx-runtime')
  const actions = jsxs(require('react').Fragment, {
    children: [
      jsx(screen.HeaderButton, { icon: 'Search', label: 'Search', systemIcon: 'magnifyingglass', onPress() {} }),
      jsx(screen.HeaderButton, { icon: 'Settings', label: 'Settings', systemIcon: 'gearshape', onPress() {} }),
    ],
  })
  const { default: Threads } = load('app/(tabs)/(threads)/index.tsx', 'ios', {
    react,
    '../../../runtime/store': {
      useStore: () => ({
        chats: [],
        projects: [],
        selected: 'a',
        computers: [{ id: 'a', name: 'Host', status: 'online' }],
        outbox: [],
        appPreferences: {},
        inbox: {},
        language: 'en',
      }),
    },
    '../../../i18n': { useT: () => ({ chats: 'Threads' }) },
    '../../../components/Screen': screen,
    '../../../components/Overlays': { useTabActions: () => actions },
    '../../../components/PlanUsage': { PlanUsageSheet: 'PlanUsageSheet' },
  })
  const render = () => hooks.render(() => Threads())
  const tree = render()
  const header = nodes(tree).find((node) => node.type === screen.Header)
  assert.equal(header.props.scrollEdge, true)
  const native = screen.Header(header.props)
  assert.deepEqual(
    nodes(native)
      .filter((node) => node.type === 'ToolbarButton')
      .map((node) => node.props.accessibilityLabel),
    ['Plan usage', 'Resources', 'Search', 'Settings'],
  )
  assert.ok(!nodes(native).some((node) => node.type === 'ToolbarView'))
  const usage = nodes(native).find(
    (node) => node.type === 'ToolbarButton' && node.props.accessibilityLabel === 'Plan usage',
  )
  usage.props.onPress()
  assert.equal(find(render(), 'PlanUsageSheet').props.open, true)
  assert.equal(find(native, 'StackScreen').props.options.headerTransparent, true)
  assert.equal(find(native, 'StackScreen').props.options.scrollEdgeEffects.top, 'soft')
  hooks.dispose()
})

test('main destination toolbar actions share native glass and retain their identity when primary actions change', () => {
  const screen = load('components/Screen.tsx', 'ios')
  const overlays = load('components/Overlays.tsx', 'ios', {
    './Screen': { HeaderButton: screen.HeaderButton },
    '../i18n': { useT: () => ({ searchTab: 'Search', settings: 'Settings' }) },
  })
  const buttons = (primary) =>
    nodes(
      screen.Header({
        title: 'Threads',
        back: false,
        large: true,
        right: overlays.useTabActions(primary),
      }),
    ).filter((node) => node.type === 'ToolbarButton')
  const search = buttons(undefined)
  const create = buttons({ icon: 'Plus', label: 'New schedule', systemIcon: 'plus', onPress() {} })
  assert.deepEqual(
    search.map((node) => node.props.identifier),
    ['tab-primary', 'tab-settings'],
  )
  assert.deepEqual(
    create.map((node) => node.props.identifier),
    ['tab-primary', 'tab-settings'],
  )
  assert.equal(search[0].props.icon, 'magnifyingglass')
  assert.equal(create[0].props.icon, 'plus')
  for (const button of [...search, ...create]) {
    assert.equal(button.props.separateBackground, false)
    assert.equal(button.props.hidesSharedBackground, false)
  }
})

test('composer back and close actions are native toolbar buttons rather than embedded custom views', () => {
  const screen = load('components/Screen.tsx', 'ios')
  const { jsx } = require('react/jsx-runtime')
  const tree = screen.Header({
    title: 'New thread',
    align: 'center',
    back: false,
    left: jsx(screen.HeaderButton, {
      icon: 'Back',
      systemIcon: 'chevron.left',
      label: 'Back to projects',
      actionId: 'new-thread-back',
    }),
    right: jsx(screen.HeaderButton, {
      icon: 'Close',
      systemIcon: 'xmark',
      label: 'Close',
      actionId: 'new-thread-close',
    }),
  })
  assert.deepEqual(
    nodes(tree)
      .filter((node) => node.type === 'ToolbarButton')
      .map((node) => node.props.identifier),
    ['new-thread-back', 'new-thread-close'],
  )
  assert.ok(!nodes(tree).some((node) => node.type === 'ToolbarView'))
})

for (const os of ['ios', 'android']) {
  test(`${os} an empty terminal can retry opening a session without duplicate taps creating shells`, async () => {
    const hooks = hookHarness()
    let opening = 0
    const pending = deferred()
    const store = {
      mayUse: () => true,
      computers: [{ id: 'a', status: 'online', name: 'Host' }],
      chats: [],
      projects: [],
      subscribe: () => () => {},
      watch: () => () => {},
      invoke: async (_host, method) => {
        if (method === 'term.list') return []
        if (method === 'term.open') {
          if (++opening === 1) throw new Error('Temporary host error')
          return pending.promise
        }
        if (method === 'term.snapshot') return { output: '', cursor: 0, exited: false }
        throw new Error(method)
      },
    }
    const { TerminalScreen } = load('components/TerminalScreen.tsx', os, {
      '../runtime/terminalGesture': { terminalFontSize: () => 13 },
      react: hooks.react,
      'react-native': { Keyboard: { addListener: () => ({ remove() {} }) } },
      '../runtime/store': { useStore: () => store },
      '../runtime/terminalKeys': terminalKeys,
      './TerminalView': { default: 'TerminalView' },
    })
    const render = () => hooks.render(() => TerminalScreen({ computerId: 'a', ctx: 'task', onBack() {} }))
    render()
    await settle()
    const empty = render()
    assert.equal(find(empty, 'TerminalTabs').props.tabs.length, 0)
    const action = nodes(empty).find((node) => node.type === 'Button' && node.props.title === 'New terminal')
    assert.equal(action.props.disabled, false)
    action.props.onPress()
    action.props.onPress()
    assert.equal(opening, 2, 'one automatic attempt and one explicit retry')
    pending.resolve({ id: 'shell', taskId: 'task', cwd: '/work', exited: false })
    await settle()
    assert.equal(find(render(), 'TerminalView').props.session, 'shell')
    hooks.dispose()
  })
}

test('page searches use the native bottom search slot and preserve query, clear and submit actions', () => {
  const hooks = hookHarness()
  const changes = []
  let submitted = 0
  const { BottomSearch } = load('components/BottomSearch.tsx', 'ios', { react: hooks.react })
  const tree = hooks.render(() =>
    BottomSearch({
      value: 'file',
      placeholder: 'Search files',
      onChangeText: (value) => changes.push(value),
      onSubmit: () => submitted++,
    }),
  )
  assert.equal(find(tree, 'NativeSearchSlot') !== undefined, true)
  const field = find(tree, 'NativeSearch')
  field.props.onChangeText({ nativeEvent: { text: 'src' } })
  field.props.onSearchButtonPress()
  field.props.onCancelButtonPress()
  assert.deepEqual(changes, ['src', ''])
  assert.equal(submitted, 1)
  hooks.dispose()
})

test('native dialog search stays in its own bottom toolbar and does not configure the page behind it', () => {
  const hooks = hookHarness()
  const shared = {
    value: '',
    set(value) {
      this.value = value
    },
  }
  const native = {
    Host: 'SwiftHost',
    BottomSheet: 'SwiftSheet',
    NavigationStack: 'SwiftStack',
    RNHostView: 'RNHost',
    ScrollView: 'SwiftScroll',
    Button: 'SwiftButton',
    ToolbarItem: 'SwiftToolbarItem',
    HStack: 'SwiftRow',
    TextField: 'SwiftInput',
    Image: 'SwiftImage',
    useNativeState: () => shared,
    Toolbar: Object.assign(() => null, { Content: 'SwiftToolbarContent' }),
  }
  const search = {
    value: '',
    placeholder: 'Search models',
    onChangeText(value) {
      this.value = value
    },
  }
  // Use a closure: native callbacks are passed directly, without a receiver.
  search.onChangeText = (value) => {
    search.value = value
  }
  const { NativeSheet } = load('components/NativeSheet.ios.tsx', 'ios', {
    react: hooks.react,
    '@expo/ui/swift-ui': native,
    '@expo/ui/swift-ui/modifiers': new Proxy(
      {},
      {
        get:
          (_, name) =>
          (...args) => ({ name, args }),
      },
    ),
  })
  const root = NativeSheet({ open: true, title: 'Models', onClose() {}, search, children: 'Results' })
  const body = nodes(root).find((node) => typeof node.type === 'function' && node.type.name === 'NativeSheetSearch')
  const render = () => hooks.render(() => body.type(body.props))
  let tree = render()
  assert.equal(find(tree, 'SwiftToolbarItem').props.placement, 'bottomBar')
  find(tree, 'SwiftInput').props.onTextChange('codex')
  tree = render()
  assert.equal(shared.value, 'codex')
  find(tree, 'SwiftButton').props.onPress()
  render()
  assert.equal(search.value, '')
  assert.equal(shared.value, '')
  assert.equal(find(tree, 'NativeSearch'), undefined)
  hooks.dispose()
})

for (const os of ['ios', 'android']) {
  test(`${os} interactive content starts themed without a thumbnail and keeps an expanded preview alive`, () => {
    const card = interactiveCardHarness(os)
    card.document.preview = 'data:image/png;base64,cached'
    card.visible(false)
    assert.equal(find(card.render(), 'Image'), undefined)
    card.visible(true)
    let tree = card.render()
    let frame = find(tree, 'InteractiveFrame')
    assert.equal(JSON.parse(frame.props.html).theme['--background'], 'window')
    assert.equal(find(tree, 'Image'), undefined)
    card.app('inactive')
    assert.ok(find(card.render(), 'InteractiveFrame'), 'native transitions do not stop the document')
    nodes(card.render())
      .find((node) => node.type === 'IconButton' && node.props.label === 'Expand')
      .props.onPress()
    frame = find(card.render(), 'InteractiveFrame')
    frame.props.onMessage({
      ramuInteractive: 1,
      instance: frame.props.instance,
      type: 'state',
      requestId: frame.props.snapshot,
      value: { controls: [], custom: null },
    })
    tree = card.render()
    const expandedInstance = find(tree, 'InteractiveFrame').props.instance
    card.visible(false)
    tree = card.render()
    assert.equal(
      find(tree, 'InteractiveFrame').props.instance,
      expandedInstance,
      'covering the transcript cannot unload the expanded viewer',
    )
    card.app('background')
    assert.equal(find(card.render(), 'InteractiveFrame'), undefined)
    card.app('active')
    assert.ok(find(card.render(), 'InteractiveFrame'))
    card.dispose()
  })

  test(`${os} saved thumbnails are fallback content, not a first-load dependency`, () => {
    const card = interactiveCardHarness(os)
    card.document.preview = 'data:image/png;base64,cached'
    assert.equal(find(card.render(), 'Image'), undefined)
    card.evict()
    assert.equal(find(card.render(), 'Image').props.source.uri, card.document.preview)
    card.dispose()
  })
}

test('native interactive views reveal only their painted document and keep theme changes from reloading it', () => {
  const hooks = hookHarness()
  const { default: Frame } = load('components/InteractiveFrame.native.tsx', 'ios', {
    react: hooks.react,
    'react-native-webview': { WebView: 'NativeWebView' },
  })
  let props = {
    html: '<main>Content</main>',
    instance: 'one',
    height: 400,
    theme: { '--background': '#131315' },
    onMessage() {},
    onStop() {},
  }
  const render = () => hooks.render(() => Frame(props))
  let tree = render()
  let webview = find(tree, 'NativeWebView')
  const source = webview.props.source
  assert.equal(tree.props.style.backgroundColor, '#131315')
  assert.equal(webview.props.style.opacity, 0)
  const frames = [],
    messages = []
  runInNewContext(webview.props.injectedJavaScript, {
    requestAnimationFrame: (callback) => frames.push(callback),
    window: { ReactNativeWebView: { postMessage: (data) => messages.push(data) } },
  })
  assert.equal(messages.length, 0)
  frames.shift()()
  assert.equal(messages.length, 0)
  frames.shift()()
  assert.equal(JSON.parse(messages[0]).type, 'painted')
  webview.props.onMessage({
    nativeEvent: { data: JSON.stringify({ ramuInteractive: 1, instance: 'old', type: 'painted' }) },
  })
  assert.equal(find(render(), 'NativeWebView').props.style.opacity, 0)
  webview.props.onMessage({ nativeEvent: { data: messages[0] } })
  assert.equal(find(render(), 'NativeWebView').props.style.opacity, 1)
  props = { ...props, theme: { '--background': '#f2f2f7' } }
  webview = find(render(), 'NativeWebView')
  assert.equal(webview.props.source, source)
  assert.equal(webview.props.style.backgroundColor, '#f2f2f7')
  assert.equal(webview.props.style.opacity, 1)
  props = { ...props, instance: 'two', html: '<main>Replacement</main>' }
  webview = find(render(), 'NativeWebView')
  assert.equal(webview.props.style.opacity, 0)
  webview.props.onMessage({ nativeEvent: { data: messages[0] } })
  assert.equal(find(render(), 'NativeWebView').props.style.opacity, 0)
  hooks.dispose()
})

test('interactive navigation cannot escape through the WebView library’s system-browser fallback', async () => {
  const hooks = hookHarness()
  const { default: Frame } = load('components/InteractiveFrame.native.tsx', 'ios', {
    react: hooks.react,
    'react-native-webview': { WebView: 'NativeWebView' },
  })
  const props = find(
    hooks.render(() =>
      Frame({ html: 'Content', instance: 'one', height: 400, theme: {}, onMessage() {}, onStop() {} }),
    ),
    'NativeWebView',
  ).props
  const { default: escapeStringRegexp } = await import('escape-string-regexp')
  const opened = [],
    decisions = []
  const { createOnShouldStartLoadWithRequest } = load(
    '../../../node_modules/react-native-webview/src/WebViewShared.tsx',
    'ios',
    {
      'escape-string-regexp': { default: escapeStringRegexp },
      './WebView.styles': { default: {} },
      'react-native': {
        Linking: {
          canOpenURL: async (url) => {
            opened.push(url)
            return true
          },
          openURL: async (url) => opened.push(url),
        },
      },
    },
  )
  const navigate = createOnShouldStartLoadWithRequest(
    (allow, url) => decisions.push({ allow, url }),
    props.originWhitelist,
    props.onShouldStartLoadWithRequest,
  )
  for (const url of [
    'https://example.com/',
    'https://localhost/private',
    'http://localhost/',
    'file:///private/file',
    'mailto:test@example.com',
    'ramu://pair',
  ]) {
    navigate({ nativeEvent: { url, lockIdentifier: 1, isTopFrame: true } })
  }
  await settle()
  assert.equal(decisions.length, 6)
  assert.ok(decisions.every(({ allow }) => allow === false))
  assert.deepEqual(opened, [])
  navigate({ nativeEvent: { url: 'https://ramu-content.invalid/', lockIdentifier: 2, isTopFrame: true } })
  assert.equal(decisions.at(-1).allow, true)
  navigate({ nativeEvent: { url: 'https://ramu-content.invalid/', lockIdentifier: 3, isTopFrame: false } })
  assert.equal(decisions.at(-1).allow, false)
  assert.equal(typeof props.onOpenWindow, 'function')
  hooks.dispose()
})

for (const os of ['ios', 'android']) {
  test(`${os} interactive content and loading surfaces match the chat in both themes`, () => {
    const card = interactiveCardHarness(os)
    card.theme('dark', '#131315', '#1c1c1f')
    let frame = find(card.render(), 'InteractiveFrame')
    assert.equal(frame.props.theme['--background'], '#131315')
    assert.equal(JSON.parse(frame.props.html).theme['--background'], '#131315')
    const html = frame.props.html
    card.theme('light', '#f2f2f7', '#ffffff')
    frame = find(card.render(), 'InteractiveFrame')
    assert.equal(frame.props.theme['--background'], '#f2f2f7')
    assert.equal(frame.props.html, html, 'live palette updates do not reload the document or its controls')
    card.visible(false)
    assert.ok(
      nodes(card.render()).some(
        (node) =>
          node.type === 'View' && node.props.style?.height === 400 && node.props.style.backgroundColor === '#f2f2f7',
      ),
    )
    card.visible(true)
    frame = find(card.render(), 'InteractiveFrame')
    assert.equal(
      JSON.parse(frame.props.html).theme['--background'],
      '#f2f2f7',
      'a resumed document starts with the current chat palette',
    )
    card.dispose()
  })
}

test('native tool completion uses the shared delayed left-to-right sweep without replaying history', async () => {
  const hooks = hookHarness()
  const calls = []
  const listeners = []
  let stopped = 0
  class Value {
    constructor(value) {
      this.value = value
    }
    setValue(value) {
      this.value = value
    }
    interpolate(config) {
      return { value: this, ...config }
    }
  }
  const { ActivityText } = load('components/Motion.tsx', 'ios', {
    react: hooks.react,
    '@ramu/shared/chat/presentation': chatPresentation,
    'react-native': {
      AccessibilityInfo: {
        isReduceMotionEnabled: async () => false,
        addEventListener: (_event, listener) => {
          listeners.push(listener)
          return { remove() {} }
        },
      },
      Easing: { linear: 'linear' },
      Animated: { Value, View: 'AnimatedView' },
    },
    // The sweep runs on the UI thread through Reanimated: record each timing with the delay that wraps it.
    'react-native-reanimated': {
      default: { View: 'ReanimatedView' },
      Easing: { linear: 'linear' },
      useSharedValue: (value) => hooks.react.useRef({ value }).current,
      useAnimatedStyle: (style) => style(),
      interpolate: (value) => value,
      withTiming: (toValue, options) => {
        const timing = { toValue, ...options }
        calls.push(timing)
        return timing
      },
      withDelay: (delay, timing) => Object.assign(timing, { delay }),
      cancelAnimation: () => {
        stopped++
      },
    },
    'react-native-worklets': { scheduleOnRN: (run, ...args) => run(...args) },
    './ui': { T: 'T' },
  })
  let active = false
  let text = 'Read files'
  const render = () => hooks.render(() => ActivityText({ active, children: text }))
  render()
  assert.equal(calls.length, 0)
  active = true
  render()
  active = false
  const tree = render()
  assert.equal(find(tree, 'T').props.children, text)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].delay, chatPresentation.TOOL_MOTION.settleMs)
  assert.equal(calls[0].duration, chatPresentation.TOOL_MOTION.finishMs)
  text = 'Read more files'
  render()
  assert.equal(calls.length, 1)
  active = true
  render()
  assert.equal(stopped, 1)
  await settle()
  for (const listener of listeners) listener(true)
  render()
  active = false
  const reduced = render()
  assert.equal(find(reduced, 'T').props.children, text)
  assert.equal(calls.length, 1, 'reduced motion never adds a delayed highlight')
  hooks.dispose()
})

test('a screen with its own bottom actions keeps search in the navigation bar, never the bottom toolbar', () => {
  const hooks = hookHarness()
  const { BottomSearch } = load('components/BottomSearch.tsx', 'ios', { react: hooks.react })
  const props = { value: '', onChangeText() {}, placeholder: 'Filter 128 files' }
  const render = (extra) => hooks.render(() => BottomSearch({ ...props, ...extra }))
  const bottom = render({})
  assert.ok(nodes(bottom).some((node) => node.type === 'NativeSearchSlot'))
  assert.equal(find(bottom, 'NativeSearch').props.placement, undefined)
  // Source Control's commit box owns the bottom edge, so its filter must not take the toolbar slot.
  const header = render({ placement: 'header' })
  assert.ok(!nodes(header).some((node) => node.type === 'NativeSearchSlot'))
  assert.equal(find(header, 'NativeSearch').props.placement, 'integratedButton')
  assert.equal(find(header, 'NativeSearch').props.allowToolbarIntegration, false)
  hooks.dispose()
})

test('iOS header keeps both toolbar owners stable while actions load, clear and return', () => {
  const screen = load('components/Screen.tsx', 'ios')
  const { jsx, jsxs } = require('react/jsx-runtime')
  const right = jsxs(require('react').Fragment, {
    children: [
      jsx(screen.HeaderButton, {
        icon: 'Trash2',
        label: 'Clear side chat',
        systemIcon: 'trash',
        actionId: 'clear-side-chat',
      }),
      jsx(screen.HeaderButton, { icon: 'RefreshCw', label: 'Refresh', systemIcon: 'arrow.clockwise' }),
    ],
  })
  for (const props of [
    { title: 'Side questions', subtitle: 'A long task name' },
    { title: 'Schedule' },
    { title: 'Explorer' },
    { title: 'Threads', large: true, back: false },
  ]) {
    const renders = [undefined, right, null, right].map((actions) => screen.Header({ ...props, right: actions }))
    const toolbar = (tree) => nodes(tree).find((node) => node.type === Toolbar && node.props.placement === 'right')
    const owners = renders.map(toolbar)
    assert.ok(owners.every(Boolean), 'empty toolbars must clear native actions without unmounting their options owner')
    assert.ok(owners.every((owner) => owner.key === owners[0].key))
    assert.equal(nodes(owners[0]).filter((node) => node.type === 'ToolbarButton').length, 0)
    assert.equal(nodes(owners[2]).filter((node) => node.type === 'ToolbarButton').length, 0)
    for (const owner of [owners[1], owners[3]]) {
      assert.deepEqual(
        nodes(owner)
          .filter((node) => node.type === 'ToolbarButton')
          .map((node) => node.props.icon),
        ['trash', 'arrow.clockwise'],
      )
    }
  }
})

test('side-question input uses the thread dock and lifts the transcript inset without resizing it', async () => {
  const hooks = hookHarness()
  const scrolls = []
  let keyboardHeight = 0
  const keyboard = {
    useKeyboardHeight: () => ({ height: keyboardHeight }),
    KeyboardLift: 'KeyboardLift',
    ComposerDock: 'ComposerDock',
  }
  const { default: AsideScreen } = load('app/chat/[id]/aside.tsx', 'ios', {
    react: hooks.react,
    'expo-router': { useLocalSearchParams: () => ({ id: 'chat', quote: 'quoted passage' }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 59, bottom: 34 }) },
    '../../../runtime/store': {
      useChat: () => ({ computerId: 'host', sessionId: 'session', title: 'Task' }),
      useStore: () => ({
        language: 'en',
        computers: [{ id: 'host', status: 'online', access: 'owner' }],
        subscribe: () => () => {},
        watch: () => () => {},
        invoke: async () => [],
      }),
    },
    '../../../components/Keyboard': keyboard,
    '../../../components/ui': { T: 'T', tap() {} },
    '../../../components/Screen': {
      Screen: 'Screen',
      Header: 'Header',
      HeaderButton: 'HeaderButton',
      PageScrollView: 'ScrollView',
    },
  })
  const render = () => hooks.render(() => AsideScreen())
  let tree = render()
  const list = find(tree, 'ScrollView')
  list.props.ref.current = { scrollTo: (options) => scrolls.push(options) }
  list.props.onLayout({ nativeEvent: { layout: { height: 500 } } })
  list.props.onContentSizeChange(400, 1000)
  find(tree, 'ComposerDock').props.onLayout({ nativeEvent: { layout: { height: 100 } } })
  find(tree, 'TextInput').props.onChangeText('draft stays here')
  tree = render()
  assert.equal(find(tree, 'ScrollView').props.contentInset.bottom, 100)
  keyboardHeight = 300
  tree = render()
  assert.equal(find(tree, 'KeyboardLift').props.keyboard.height, 300)
  assert.equal(find(tree, 'ScrollView').props.automaticallyAdjustKeyboardInsets, false)
  assert.equal(find(tree, 'ScrollView').props.contentInset.bottom, 374)
  assert.equal(find(tree, 'ScrollView').props.contentContainerStyle.paddingBottom, 24)
  assert.equal(find(tree, 'TextInput').props.value, 'draft stays here')
  await settle()
  assert.ok(
    scrolls.some(({ y }) => y === 874),
    'latest answer remains above the raised input',
  )
  find(tree, 'ScrollView').props.onScrollBeginDrag()
  const before = scrolls.length
  find(tree, 'ScrollView').props.onContentSizeChange(400, 1200)
  assert.equal(scrolls.length, before, 'new answers do not pull a reader away from older messages')
  keyboardHeight = 0
  tree = render()
  assert.equal(find(tree, 'ScrollView').props.contentInset.bottom, 100)
  assert.equal(find(tree, 'TextInput').props.value, 'draft stays here')
  hooks.dispose()
})

test('tool shortcut pills keep one icon-only shape while status pills keep their words', () => {
  const { ActivityPill } = load('components/ActivityPill.tsx', 'ios')
  const labels = (props) =>
    nodes(ActivityPill({ icon: 'Globe', onPress() {}, ...props }))
      .filter((node) => node.type === 'T')
      .map((node) => node.props.children)
  const shortcut = ActivityPill({ icon: 'Globe', label: 'Terminal', iconOnly: true, onPress() {} })
  assert.deepEqual(labels({ label: 'Terminal', iconOnly: true }), [])
  assert.equal(find(shortcut, 'Pressable').props.accessibilityLabel, 'Terminal', 'screen readers still hear the name')
  assert.ok(find(shortcut, 'Pressable').props.style.minWidth >= 32)
  assert.deepEqual(labels({ label: '3 queued' }), ['3 queued'])
  assert.deepEqual(labels({ label: 'Approval needed', tone: 'attention' }), ['Approval needed'])
})

test('a phone without the Terminals permission is offered a request, never a shell the host would refuse', async () => {
  const hooks = hookHarness(),
    calls = []
  const store = {
    mayUse: (_id, permission) => permission !== 'terminal',
    language: 'en',
    computers: [{ id: 'a', status: 'online', name: 'Host A' }],
    chats: [],
    projects: [],
    invoke: async (...args) => {
      calls.push(args)
      if (args[1] === 'term.list') return []
      throw new Error(`Unexpected ${args[1]}`)
    },
    subscribe: () => () => {},
    watch: () => () => {},
  }
  const { TerminalScreen } = load('components/TerminalScreen.tsx', 'ios', {
    react: hooks.react,
    'react-native': { Keyboard: { addListener: () => ({ remove() {} }) } },
    '../runtime/store': { useStore: () => store },
    '../runtime/terminalKeys': terminalKeys,
    './TerminalView': { default: 'TerminalView' },
    './DevicePermissions': { PermissionNeeded: 'PermissionNeeded' },
  })
  const render = () => hooks.render(() => TerminalScreen({ computerId: 'a', ctx: 'task', onBack() {} }))
  render()
  await settle()
  const tree = render()
  assert.equal(find(tree, 'PermissionNeeded').props.permission, 'terminal')
  assert.equal(
    calls.some(([, method]) => method === 'term.open'),
    false,
  )
  hooks.dispose()
})

test('the Skills & MCP page reads every project’s servers and skills without offering host administration', async () => {
  const hooks = hookHarness(),
    calls = []
  const store = {
    language: 'en',
    isOnline: () => true,
    projects: [{ id: 'a:p1', computerId: 'a', name: 'Site' }],
    computers: [{ id: 'a', name: 'Host A' }],
    subscribe: () => () => {},
    invoke: async (...args) => {
      calls.push(args)
      if (args[1] === 'mcp.status')
        return {
          connections: [
            {
              connection: { id: 'c1', name: 'Issues', providers: ['codex'] },
              status: 'sign-in-required',
              toolCount: 3,
            },
          ],
          providerManaged: [{ provider: 'claude-code', name: 'figma' }],
        }
      if (args[1] === 'projects.setup')
        return {
          mcp: [
            {
              key: 'k1',
              name: 'atlassian',
              transport: { type: 'http', url: 'https://mcp.example/a' },
              providers: ['codex'],
              nativeProviders: ['codex'],
              shared: false,
              shareScope: 'host',
              scope: 'user',
              sources: [],
              exceptions: 1,
            },
          ],
          skills: [
            {
              name: 'deploy',
              description: 'Ships it',
              providers: ['claude-code'],
              nativeProviders: ['claude-code'],
              shared: false,
              shareScope: 'default',
              scope: 'project',
              sources: [{ scope: 'project', label: 'site', file: '.claude/skills/deploy', enabled: true }],
              nameConflict: true,
            },
          ],
        }
      throw new Error(`Unexpected ${args[1]}`)
    },
  }
  const { AgentSetupSettings } = load('components/AgentSetupSettings.tsx', 'ios', {
    react: hooks.react,
    '../runtime/store': { useStore: () => store },
    './SettingRows': { RowLabel: 'RowLabel' },
    '@ramu/shared/providers/providers': { providerName: (id) => id },
    '@ramu/shared/listView': { matchesWords: () => true, searchWords: () => [] },
    '@ramu/shared/mcp': sharedMcp,
  })
  const render = () => hooks.render(() => AgentSetupSettings({ hostId: 'a' }))
  render()
  await settle()
  const labels = nodes(render())
    .filter((node) => node.type === 'RowLabel')
    .map((node) => [node.props.title, node.props.help])
  assert.deepEqual(labels, [
    // Declared servers for every project, with the projects that chose differently.
    ['atlassian', 'https://mcp.example/a · Only in codex · Different in 1 project'],
    ['Issues', 'Sign-in required · 3 tools · codex'],
    ['figma', 'Only claude-code has it, from its own settings'],
    // Who loads it, where it comes from, and a name two places use for different content.
    ['deploy', 'Ships it · Only in claude-code · From site/.claude/skills/deploy · Different content shares this name'],
  ])
  assert.deepEqual(
    calls.find(([, method]) => method === 'projects.setup'),
    ['a', 'projects.setup', null],
  )
  assert.equal(
    calls.some(([, method]) => /^mcp\.(save|approve|signIn|setSecret|remove)/.test(method)),
    false,
  )
  hooks.dispose()
})

test('a required MCP form answer counts only once it holds a value, and a list needs at least one choice', () => {
  const { elicitationAnswered } = load('components/Transcript.tsx', 'ios', {
    react: { memo: (component) => component, ...require('react') },
    '../runtime/store': { useStore: () => ({}) },
    '@ramu/shared/i18n': { translate: (_language, text) => text },
    '../i18n': { useT: () => ({}), fill: (text) => text },
    './ui': { ...components, tap() {}, T: 'T', Card: 'Card' },
    './Motion': { Collapse: 'Collapse', Disclosure: 'Disclosure', Breathe: 'Breathe', Arrive: 'Arrive' },
  })
  const field = (type) => ({ id: 'f', label: 'F', type, required: true, options: [] })
  assert.equal(elicitationAnswered(field('string'), '  '), false)
  assert.equal(elicitationAnswered(field('integer'), '3'), true)
  assert.equal(elicitationAnswered(field('boolean'), 'false'), true)
  assert.equal(elicitationAnswered(field('array'), '[]'), false)
  assert.equal(elicitationAnswered(field('array'), 'not json'), false)
  assert.equal(elicitationAnswered(field('array'), '["a"]'), true)
})

test('a device without Change settings sees a host’s settings rows read-only', () => {
  const { HostGroups } = load('components/SettingRows.tsx', 'ios', {
    '../runtime/store': { useStore: () => ({ language: 'en' }) },
    '../runtime/settingsModel': {
      ...settingsModel,
      visibleGroups: () => [{ title: null, rows: [{ path: 'a.b', kind: 'toggle', label: 'Thing' }] }],
    },
  })
  const rows = (locked) =>
    nodes(HostGroups({ section: 'chats', host: { state: { status: 'ready', settings: [] }, read: () => {} }, locked }))
      .filter((node) => node.props?.row)
      .map((node) => node.props.disabled)
  assert.deepEqual(rows(true), [true])
  assert.deepEqual(rows(false), [false])
})

test('an error toast sits under the header and never blocks a press, while an Undo toast stays within reach', () => {
  const render = (toast) => {
    const { UndoToast } = load('components/UndoToast.tsx', 'ios', {
      react: { useEffect() {}, useSyncExternalStore: (_subscribe, read) => read() },
      'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 59, bottom: 34 }) },
      '../i18n': { useT: () => ({}) },
      '../runtime/toast': {
        TOAST_MS: 6000,
        currentToast: () => toast,
        dismissToast() {},
        subscribeToast: () => () => {},
      },
    })
    return UndoToast()
  }
  const error = render({ id: 1, message: 'Host unreachable', error: true })
  assert.equal(error.props.pointerEvents, 'none')
  assert.equal(error.props.style.top, 59 + 52)
  assert.equal(error.props.style.bottom, undefined)

  const undo = render({ id: 2, message: 'recapDone', action: { label: 'undo', run() {} } })
  assert.equal(undo.props.pointerEvents, 'box-none')
  assert.equal(undo.props.style.bottom, 34 + 72)
  assert.equal(undo.props.style.top, undefined)
})

for (const readOnly of [false, true]) {
  test(`the phone's MCP sheet ${readOnly ? 'only reads status on a view-only device' : 'reconnects a failed server and reloads them all'}`, async () => {
    const hooks = hookHarness(),
      calls = []
    const status = {
      supported: true,
      live: true,
      canReconnect: true,
      canReload: true,
      servers: [
        { name: 'github', status: 'failed', error: 'token expired' },
        { name: 'docs', status: 'connected', toolCount: 4 },
      ],
    }
    const store = {
      invoke: async (...args) => {
        calls.push(args)
        return args[1] === 'agent.mcpStatus' ? status : undefined
      },
    }
    const { McpStatusSheet } = load('components/McpStatusSheet.tsx', 'ios', {
      react: { ...require('react'), ...hooks.react },
      './ui': components,
      '@ramu/shared/mcp': sharedMcp,
      '../runtime/store': { useStore: () => store },
      '../i18n': { useSay: () => (text, values) => text.replace('{0}', values?.[0] ?? '') },
      '../theme': {
        font: { caption: 12 },
        space: { l: 16, m: 12, s: 8 },
        useTheme: () => ({ c: { ok: 'ok', bad: 'bad', muted: 'muted' } }),
      },
    })
    const render = () =>
      hooks.render(() => McpStatusSheet({ open: true, onClose() {}, computerId: 'host', sessionId: 's', readOnly }))
    render()
    await settle()
    const buttons = () => nodes(render()).filter((node) => node.type === 'Button')
    const button = (title) => buttons().find((node) => node.props.title === title)
    assert.ok(nodes(render()).some((node) => node.props?.children === 'github'))
    if (readOnly) {
      assert.equal(button('Reconnect'), undefined)
      assert.equal(button('Reload MCP servers'), undefined)
      assert.ok(button('Refresh'))
      return
    }
    // Only the failed server offers Reconnect.
    assert.equal(buttons().filter((node) => node.props.title === 'Reconnect').length, 1)
    calls.length = 0
    button('Reconnect').props.onPress()
    await settle()
    assert.deepEqual(
      calls.map((call) => call.slice(1)),
      [
        ['agent.reconnectMcp', 's', 'github'],
        ['agent.mcpStatus', 's'],
      ],
    )
    calls.length = 0
    button('Reload MCP servers').props.onPress()
    await settle()
    assert.deepEqual(
      calls.map((call) => call.slice(1)),
      [
        ['agent.reloadMcp', 's'],
        ['agent.mcpStatus', 's'],
      ],
    )
  })
}

const hostStore = (answers, calls) => ({
  language: 'en',
  computers: [{ id: 'host', access: 'full' }],
  isOnline: () => true,
  invoke: async (_host, method, ...args) => {
    calls.push([method, ...args])
    return answers[method]?.(...args)
  },
})
const pressByText = (tree, text) => {
  const pressable = nodes(tree).find(
    (node) => node.type === 'Pressable' && nodes(node.props.children).some((child) => child.props?.children === text),
  )
  assert.ok(pressable, `a ${text} action`)
  pressable.props.onPress()
}

test('saved approvals list the host’s Always allow rules and remove one from the phone', async () => {
  const hooks = hookHarness(),
    calls = []
  const store = hostStore(
    {
      'settings.permissions.list': () => [
        { id: 'r1', provider: 'claude-code', scope: 'user', label: 'Bash(git status)', createdAt: 1 },
      ],
    },
    calls,
  )
  const { SavedApprovals } = load('components/SavedApprovals.tsx', 'ios', {
    react: hooks.react,
    '../runtime/store': { useStore: () => store },
    '../runtime/types': { providerNames: { 'claude-code': 'Claude Code' } },
    '../runtime/toast': { showToast() {} },
    './ui': new Proxy({ tap() {} }, { get: (target, key) => (key in target ? target[key] : String(key)) }),
  })
  const render = () => hooks.render(() => SavedApprovals({ hostId: 'host', locked: false }))
  render()
  await settle()
  const tree = render()
  assert.ok(nodes(tree).some((node) => node.props?.children === 'Bash(git status)'))
  pressByText(tree, 'Remove')
  await settle()
  assert.deepEqual(
    calls.map((call) => call[0]),
    ['settings.permissions.list', 'settings.permissions.remove', 'settings.permissions.list'],
  )
  assert.equal(calls[1][1], 'r1')
  hooks.dispose()
})

test('learning reviews show only what waits for the person, and Apply applies that review', async () => {
  const hooks = hookHarness(),
    calls = []
  const job = (id, status) => ({ id, status, sessionId: 's', projectId: null, seq: 1, createdAt: 1, error: null })
  const store = hostStore(
    {
      'learning.get': () => ({
        skills: [],
        running: false,
        jobs: [
          {
            ...job('pending-1', 'pending'),
            sessionTitle: 'Fix login',
            proposal: JSON.stringify({ memories: [{ title: 'Use pnpm', reason: 'The repo has a pnpm lockfile' }] }),
          },
          job('applied-1', 'applied'),
        ],
      }),
    },
    calls,
  )
  const { LearningReviews } = load('components/LearningReviews.tsx', 'ios', {
    react: hooks.react,
    '../runtime/store': { useStore: () => store },
    '../runtime/toast': { showToast() {} },
    './ui': new Proxy({ tap() {} }, { get: (target, key) => (key in target ? target[key] : String(key)) }),
  })
  const render = () => hooks.render(() => LearningReviews({ hostId: 'host', locked: false }))
  render()
  await settle()
  const tree = render()
  const texts = nodes(tree).map((node) => [node.props?.children].flat().join(''))
  assert.ok(texts.includes('Fix login · pending'))
  assert.ok(texts.includes('Memory: Use pnpm — The repo has a pnpm lockfile'))
  assert.ok(!texts.some((text) => text.includes('applied')), 'an applied review stays on the desktop’s full list')
  pressByText(tree, 'Apply')
  await settle()
  assert.deepEqual(calls[1], ['learning.apply', 'pending-1'])
  hooks.dispose()
})

test('artifact settings on the phone revoke a share link and close a page opened to anyone', async () => {
  const sharedArtifacts = await import('../../../packages/shared/src/artifacts.ts')
  const hooks = hookHarness(),
    calls = []
  const store = hostStore(
    {
      'artifacts.shares': () => [{ token: 'tok', artifactId: 'a1', canAdd: false, createdAt: 1, expiresAt: 2 }],
      'artifacts.runs': () => [],
      'artifacts.publicStatus': () => ({ state: 'running', url: 'https://tunnel.example', error: null, since: 1 }),
    },
    calls,
  )
  const { ArtifactSettings } = load('components/ArtifactSettings.tsx', 'ios', {
    react: hooks.react,
    '@ramu/shared/artifacts': sharedArtifacts,
    '../runtime/store': { useStore: () => store },
    '../runtime/toast': { showToast() {} },
    './ui': new Proxy({ tap() {} }, { get: (target, key) => (key in target ? target[key] : String(key)) }),
  })
  const page = { id: 'a1', title: 'Report', kind: 'doc', capabilities: {}, grants: {} }
  const render = () =>
    hooks.render(() =>
      ArtifactSettings({ computerId: 'host', page, open: true, onClose() {}, onChanged() {}, onDeleted() {} }),
    )
  render()
  await settle()
  let tree = render()
  assert.ok(nodes(tree).some((node) => node.props?.children === 'https://tunnel.example'))
  nodes(tree)
    .find((node) => node.props?.label === 'Revoke')
    .props.onPress()
  await settle()
  assert.ok(calls.some((call) => call[0] === 'artifacts.revokeShare' && call[1] === 'tok'))
  tree = render()
  const close = nodes(tree).find((node) => node.type === 'Button' && node.props.title === 'Close to everyone')
  assert.ok(close, 'an open page offers Close to everyone')
  close.props.onPress()
  await settle()
  assert.ok(calls.some((call) => call[0] === 'artifacts.closePublic' && call[1] === 'a1'))
  hooks.dispose()
})
