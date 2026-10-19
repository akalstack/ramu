import { INTERACTIVE_CSP } from '@ramu/shared/interactive'
import { ContentDocuments } from './contentDocuments'
import { HostNavigation } from './hostNavigation'
import type { HostDestination } from '@ramu/shared/hostOverview'
import { readHostOverview, HostOverviewQueue } from './hostOverview'
import { isHostDestination } from '@ramu/shared/hostOverview'
import { isHostInvokeAllowed, routeInvoke, routeTaskCommand, activityChannel } from './hostInvoke'
import { DeviceState } from './deviceState'
import { partitionHostEntries } from './partitionStorage'
import { newerVersion } from '@ramu/shared/version'
import { DesktopUpdater } from './desktopUpdater'
import { runtimeBuild } from '@ramu/server/build'
import { unloadLoginService } from './runtimeLauncher'
import type { AppUpdateStatus } from '@ramu/shared/updates'
import { configureDesktopLanguage, desktopLanguage, t } from './localization'
import { editorMenu, type EditorMenuOptions } from './editorMenu'
import { existsSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { type AppPreferences } from '@ramu/shared/types'
import { join } from 'node:path'
import {
  app,
  protocol,
  crashReporter,
  BrowserWindow,
  Menu,
  session,
  shell,
  dialog,
  ipcMain,
  clipboard,
  safeStorage,
  powerMonitor,
  nativeTheme,
  WebContentsView,
  type Session,
  type WebContents,
} from 'electron'
import { editMenuItems } from './editMenu'
import { AttachmentStore } from '@ramu/server/attachments'
import { attachmentActions } from './attachmentActions'
import { terminalMenu } from './terminalMenu'
import { createAgentNotifier } from './agentNotifier'
import {
  runtimeInvoke,
  runtimePair,
  subscribeRuntime,
  refreshRuntimeNetwork,
  runtimeNetwork,
  PresenceListener,
} from '@ramu/client-runtime'
import { SshComputers } from './sshComputers'
import { RemoteServers } from './remoteServers'
import { ComputerBroadcaster } from './computerBroadcast'
import { ComputerRegistry, LOCAL } from './computers'
import { ensureRuntime, loginService, loginEnabled, loginPreferred } from './runtimeLauncher'

protocol.registerSchemesAsPrivileged([{ scheme: 'ramu-content', privileges: { standard: true, secure: true } }])

// Set the native runtime identity before creating menus, windows or notifications.
app.setName('Ramu')
if (process.platform === 'win32') app.setAppUserModelId('app.ramu.desktop')
app.setAboutPanelOptions({ applicationName: 'Ramu', applicationVersion: app.getVersion() })

// Lets tests and screenshots run against a throwaway profile.
if (process.env.RAMU_USER_DATA) app.setPath('userData', process.env.RAMU_USER_DATA)

// End-to-end runs stay out of the way: windows are created hidden and unfocused, and macOS shows no Dock icon.
// Hidden pages would otherwise be throttled, so throttling is off; tests emulate focus through Playwright.
const e2eHeadless = process.env.RAMU_E2E_HEADLESS === '1'
if (e2eHeadless) app.dock?.hide()

const CSP = [
  "default-src 'self'",
  // WebAssembly for the editor's TextMate grammars (Shiki's Oniguruma engine); no string-to-code evaluation.
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "media-src 'self' data:",
  'frame-src data: ramu-content:',
  "img-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
].join('; ')

// `ramu://pair?...` links can arrive before the window exists, so they queue until it can show them.
const PAIR_LINK = /^ramu:\/\/pair(?:[/?]|$)/i
const queuedPairLinks: string[] = []
let showPairLink: ((link: string) => void) | null = null
const receivePairLink = (link: string) => {
  if (link.length > 4096 || !PAIR_LINK.test(link)) return
  if (showPairLink) showPairLink(link)
  else queuedPairLinks.push(link)
}
app.on('open-url', (event, url) => {
  event.preventDefault()
  receivePairLink(url)
})
for (const arg of process.argv) receivePairLink(arg)
if (app.isPackaged) app.setAsDefaultProtocolClient('ramu')

async function main() {
  await app.whenReady()

  const userData = app.getPath('userData')
  const daemonPath = join(import.meta.dirname, 'daemon.js')
  // This computer's server always runs. Paired computers connect alongside it in the same shell.
  const runtime = await ensureRuntime(userData, daemonPath)
  const diagnosticPreferences = await runtimeInvoke(runtime, 'settings.app.get')
  if (diagnosticPreferences.localCrashReports) {
    crashReporter.start({ productName: 'Ramu', uploadToServer: false, extra: {}, globalExtra: {} })
    app.on('render-process-gone', () => {
      void runtimeInvoke(runtime, 'diagnostics.nativeEvent', ['renderer-crash']).catch(() => {})
    })
    process.on('uncaughtExceptionMonitor', () => {
      void runtimeInvoke(runtime, 'diagnostics.nativeEvent', ['desktop-crash']).catch(() => {})
    })
  }
  const servers = new RemoteServers(join(userData, 'remote-servers.json'), {
    get available() {
      return safeStorage.isEncryptionAvailable()
    },
    seal: (text) => safeStorage.encryptString(text).toString('base64'),
    open: (text) => safeStorage.decryptString(Buffer.from(text, 'base64')),
  })
  const setLoginService = async (enabled: boolean) => {
    const firstInstall = enabled && !existsSync(join(userData, 'background-ever-installed.json'))
    loginService(userData, daemonPath, enabled)
    if (firstInstall) {
      const preferences = await runtimeInvoke(runtime, 'settings.app.get')
      await runtimeInvoke(runtime, 'settings.app.set', [{ ...preferences, keepAwake: true }])
      writeFileSync(join(userData, 'background-ever-installed.json'), 'true', { mode: 0o600 })
    }
    return { firstInstall }
  }
  if (
    app.isPackaged &&
    !process.env.RAMU_USER_DATA &&
    process.platform === 'darwin' &&
    loginPreferred(userData) !== false &&
    !loginEnabled(userData)
  )
    await setLoginService(true)

  // Every window, including each paired computer's own partition, gets the same policy.
  const secure = (ses: Session) => {
    if (!process.env.ELECTRON_RENDERER_URL) {
      ses.webRequest.onHeadersReceived((details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [
              details.url.startsWith('ramu-content:') ? `${INTERACTIVE_CSP}; sandbox allow-scripts` : CSP,
            ],
          },
        })
      })
    }
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  }
  const contentDocuments = new ContentDocuments()
  session.defaultSession.protocol.handle('ramu-content', (request) => contentDocuments.response(request.url))
  secure(session.defaultSession)

  const languagePreferences = (await runtimeInvoke(runtime, 'settings.app.get')) as AppPreferences
  let languagePreference = languagePreferences.language
  configureDesktopLanguage(languagePreference, app.getPreferredSystemLanguages())

  // Our own menu: keeps copy/paste and quit, but leaves ⌘W, ⌘N, ⌘P and friends to the app's shortcuts.
  const updateApplicationMenu = () => {
    const menu = Menu.buildFromTemplate([
      {
        label: process.platform === 'darwin' ? 'Ramu' : t('File'),
        submenu: [
          { label: t('About Ramu'), role: 'about' },
          { label: t('Check for Updates…'), click: () => openSettings('check-updates') },
          { type: 'separator' },
          { label: t('Settings…'), accelerator: 'CommandOrControl+,', click: () => openSettings('settings') },
          { type: 'separator' },
          ...(process.platform === 'darwin'
            ? [
                { label: t('Services'), role: 'services' as const },
                { type: 'separator' as const },
                { label: t('Hide Ramu'), role: 'hide' as const },
                { label: t('Hide others'), role: 'hideOthers' as const },
                { label: t('Show all'), role: 'unhide' as const },
                { type: 'separator' as const },
              ]
            : []),
          { label: t('Quit Ramu'), role: 'quit' },
        ],
      },
      { label: t('Edit'), role: 'editMenu' },
      {
        label: t('View'),
        submenu: [
          { label: t('Reload'), role: 'reload' },
          { label: t('Developer tools'), role: 'toggleDevTools' },
          { type: 'separator' },
          { label: t('Actual size'), role: 'resetZoom' },
          { label: t('Zoom in'), role: 'zoomIn' },
          { label: t('Zoom out'), role: 'zoomOut' },
          { type: 'separator' },
          { label: t('Full screen'), role: 'togglefullscreen' },
        ],
      },
      {
        label: t('Window'),
        submenu: [
          { label: t('Minimize'), role: 'minimize' },
          { label: t('Zoom'), role: 'zoom' },
        ],
      },
    ])
    // Translate Electron's generated items too, preserving platform editing actions and shortcuts.
    const roleCopy: Record<string, string> = {
      appMenu: 'Ramu',
      editMenu: 'Edit',
      about: 'About Ramu',
      services: 'Services',
      hide: 'Hide Ramu',
      hideOthers: 'Hide others',
      unhide: 'Show all',
      quit: 'Quit Ramu',
      undo: 'Undo',
      redo: 'Redo',
      cut: 'Cut',
      copy: 'Copy',
      paste: 'Paste',
      pasteAndMatchStyle: 'Paste and match style',
      delete: 'Delete',
      selectAll: 'Select all',
      startSpeaking: 'Start speaking',
      stopSpeaking: 'Stop speaking',
      reload: 'Reload',
      toggleDevTools: 'Developer tools',
      resetZoom: 'Actual size',
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      togglefullscreen: 'Full screen',
      minimize: 'Minimize',
      zoom: 'Zoom',
    }
    const roles = Object.fromEntries(Object.entries(roleCopy).map(([role, copy]) => [role.toLowerCase(), copy]))
    const localize = (menu: Menu) => {
      for (const item of menu.items) {
        item.label = t(roles[item.role?.toLowerCase() ?? ''] ?? item.label)
        if (item.submenu) localize(item.submenu)
      }
    }
    localize(menu)
    Menu.setApplicationMenu(menu)
  }

  const openSettings = (action: 'settings' | 'check-updates') => {
    if (win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    sendTo(LOCAL, 'menu:action', { action })
  }
  updateApplicationMenu()
  showPairLink = (link) => {
    if (win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    sendTo(LOCAL, 'pair:link', { link })
  }
  // The window may still be loading; the renderer keeps the link until the screen asks for it.
  for (const link of queuedPairLinks.splice(0)) setTimeout(() => showPairLink?.(link), 1500)

  // Packaged macOS builds take the icon from the bundle; development, Linux and Windows read it from assets/.
  // Packaged builds copy assets/ beside the app; in the monorepo it sits at the repository root.
  const icon =
    [join(import.meta.dirname, '../../assets/icon.png'), join(import.meta.dirname, '../../../../assets/icon.png')].find(
      (path) => existsSync(path),
    ) ?? ''
  // In development the dock icon comes from the patched Electron.app (scripts/dev-icon.mjs), so the glass icon is not replaced by a flat PNG.

  const win = new BrowserWindow({
    ...(icon ? { icon } : {}),
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    title: 'Ramu',
    show: !e2eHeadless,
    backgroundColor: '#131315',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 16 } } : {}),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: !e2eHeadless,
    },
  })

  // Each computer's page gets the same behavior: edit menu, window chrome, and no navigation away from the app.
  const sendChrome = (contents: WebContents) => {
    if (!contents.isDestroyed())
      contents.send('ramu:window-chrome', {
        controlsInset: process.platform === 'darwin' && !win.isFullScreen() ? 84 : 0,
      })
  }
  const wire = (contents: WebContents) => {
    contents.on('did-start-loading', () => {
      hostNavigation.suspend()
    })
    contents.on('context-menu', (_event, params) => {
      const items = editMenuItems(params)
      if (items.length)
        Menu.buildFromTemplate(items).popup({ window: win, ...(params.frame ? { frame: params.frame } : {}) })
    })
    contents.on('dom-ready', () => {
      sendChrome(contents)
    })
    // No in-app navigation or new windows; external links open in the browser.
    contents.on('will-frame-navigate', (event) => {
      // Generated documents cannot navigate, including redirects, meta refresh and script-driven navigation.
      if (!event.isMainFrame && !contentDocuments.has(event.url)) event.preventDefault()
    })
    contents.on('will-navigate', (e, url) => {
      if (url !== contents.getURL()) e.preventDefault()
    })
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
  }
  win.webContents.on('render-process-gone', () => contentDocuments.clear())
  win.webContents.on('did-navigate', () => contentDocuments.clear())
  wire(win.webContents)

  let updateStatus: AppUpdateStatus | undefined
  const desktopUpdater = new DesktopUpdater(userData, () => {
    if (updateStatus) sendAll('updates:changed', updateView(updateStatus))
  })
  const updateView = (status: AppUpdateStatus): AppUpdateStatus => {
    const stale = !!status.release && !newerVersion(status.release.version, app.getVersion())
    return {
      ...status,
      currentVersion: app.getVersion(),
      ...(stale ? { release: null, phase: 'idle' as const, downloadedBytes: 0 } : {}),
      nativeReady: !stale && desktopUpdater.ready,
      supported: desktopUpdater.supported,
      error: desktopUpdater.error ?? status.error,
    }
  }
  // One shell receives tagged events from every host. Stores route and bound their own work in the renderer.
  const sendTo = (id: string, channel: string, payload: unknown) => {
    if (!win.webContents.isDestroyed()) win.webContents.send(channel, payload, id)
  }
  // Device-wide UI state is shared by every window and is never buffered: it is tiny and idempotent.
  const deviceState = new DeviceState(join(userData, 'device-state.json'))
  // Native chrome (menus, dialogs, scrollbars, the pre-paint window color) follows the page's appearance choice.
  const applyAppearance = () => {
    const choice = deviceState.snapshot().appearance
    nativeTheme.themeSource = choice === 'system' || choice === 'light' ? choice : 'dark'
    win.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#131315' : '#ececef')
  }
  applyAppearance()
  nativeTheme.on('updated', applyAppearance)
  const activityHosts = new Set<string>()
  let activityTimer: NodeJS.Timeout | undefined
  const observeHostActivity = (id: string, channel: string, payload: any) => {
    if (
      !['workspace:changed', 'automation:changed', 'summaries:changed', 'background:connection'].includes(channel) &&
      !(channel === 'agent:event' && payload?.event?.kind === 'state')
    )
      return
    activityHosts.add(id)
    if (activityTimer) return
    activityTimer = setTimeout(() => {
      activityTimer = undefined
      sendTo(LOCAL, 'computers:activity', { ids: [...activityHosts] })
      activityHosts.clear()
    }, 250)
  }
  const send = (channel: string, payload: unknown) => sendTo(LOCAL, channel, payload)
  const sendAll = send
  const broadcaster = new ComputerBroadcaster(
    () => computers.list(LOCAL),
    (state) => send('computers:changed', state),
  )
  const announce = () => broadcaster.changed()
  const chromeChanged = () => sendChrome(win.webContents)
  win.on('enter-full-screen', chromeChanged)
  win.on('leave-full-screen', chromeChanged)

  const notifiers = new Map<string, ReturnType<typeof createAgentNotifier>>()
  const hostNavigation = new HostNavigation((hostId, destination) =>
    send('computers:navigate', { hostId, destination }),
  )
  const notifierFor = (id: string) => {
    let notifier = notifiers.get(id)
    if (!notifier) {
      const local = id === LOCAL
      notifier = createAgentNotifier({
        window: win,
        send: (channel, payload) =>
          sendTo(LOCAL, channel, channel === 'notify:inapp' ? { ...(payload as object), hostId: id } : payload),
        invoke: (method, args) => runtimeInvoke(computers.endpoint(id), method, args),
        preferences: () => runtimeInvoke(runtime, 'settings.app.get'),
        visible: () => true,
        ...(local
          ? {}
          : { label: () => computers.list(LOCAL).computers.find((computer) => computer.id === id)?.name ?? '' }),
        reveal: (target) => {
          try {
            openComputer(id, { kind: 'task', ...target })
          } catch {
            return
          }
        },
      })
      notifiers.set(id, notifier)
    }
    return notifier
  }
  const presence = new PresenceListener()
  await presence.start()
  const ssh = new SshComputers(servers)
  const computers = new ComputerRegistry({
    servers,
    ssh,
    deviceName: hostname(),
    localName: () => t('This host'),
    local: runtime,
    subscribe: (target, receive, options) =>
      subscribeRuntime(target, receive, runtimeNetwork, {
        ...options,
        presencePort: presence.port,
        ...(target.kind === 'http' ? { watchWake: (wake: () => void) => presence.watch(target.token, wake) } : {}),
      }),
    invoke: runtimeInvoke,
    pair: runtimePair,
    deliver: (id, channel, payload) => {
      observeHostActivity(id, channel, payload)
      sendTo(id, channel, payload)
      notifierFor(id).observe(channel, payload)
    },
    changed: announce,
  })
  const overviewReads = new HostOverviewQueue(async (id) => {
    if (!computers.exists(id) || computers.status(id) !== 'connected') throw new Error('That host is not connected')
    const endpoint = computers.endpoint(id)
    return readHostOverview((operation) => runtimeInvoke(endpoint, operation, [], { timeoutMs: 10000 }))
  })
  const rendererUrl = () => process.env.ELECTRON_RENDERER_URL
  /** Opens a host in the existing shell, preserving its store and tabs. */
  const openComputer = (id: string, destination: HostDestination = { kind: 'host' }) => {
    if (!computers.exists(id)) throw new Error(t('That host is no longer saved'))
    const info = computers.list(LOCAL).computers.find((computer) => computer.id === id)!
    if (id !== LOCAL && info.status === 'rejected')
      throw new Error(t('{name} no longer accepts this host. Forget it, then pair again.', { name: info.name }))
    if (id !== LOCAL && info.status !== 'connected')
      throw new Error(t('{name} is not reachable right now.', { name: info.name }))
    hostNavigation.request(id, destination)
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
  const closeComputer = async (id: string) => {
    hostNavigation.forget(id)
    notifiers.delete(id)
    await session
      .fromPartition(`persist:ramu-computer-${id}`)
      .clearStorageData()
      .catch(() => {})
  }
  const unsubscribe = subscribeRuntime(runtime, (channel, payload) => {
    observeHostActivity(LOCAL, channel, payload)
    if (channel === 'background:connection') computers.setLocalStatus(payload.connected)
    computers.observe(LOCAL, channel, payload)
    if (channel === 'updates:changed') {
      updateStatus = payload
      void desktopUpdater.prepare(payload)
      sendAll(channel, updateView(payload))
      return
    }
    if (channel !== 'host:request') {
      send(channel, payload)
      notifierFor(LOCAL).observe(channel, payload)
      return
    }
    void (async () => {
      try {
        let value: unknown
        if (payload.method === 'pickDirectory') {
          // Test runs answer the folder dialog through RAMU_TEST_PICK_DIRECTORY instead of a native sheet.
          if (process.env.RAMU_TEST_PICK_DIRECTORY) value = process.env.RAMU_TEST_PICK_DIRECTORY
          else {
            const result = await dialog.showOpenDialog(win, {
              properties: ['openDirectory', 'createDirectory'],
              title: payload.path === 'repository' ? t('Connect a repository') : t('Add project'),
              buttonLabel: payload.path === 'repository' ? t('Connect') : t('Add project'),
            })
            value = result.canceled ? null : (result.filePaths[0] ?? null)
          }
        } else if (payload.method === 'pickExecutable') {
          const result = await dialog.showOpenDialog(win, {
            properties: ['openFile'],
            title: t('Select provider binary'),
            buttonLabel: t('Use binary'),
          })
          value = result.canceled ? null : (result.filePaths[0] ?? null)
        } else if (payload.method === 'pickAttachments') {
          const result = await dialog.showOpenDialog(win, {
            properties: ['openFile', 'multiSelections'],
            title: t('Attach files'),
          })
          value = result.canceled ? [] : result.filePaths
        } else if (payload.method === 'reveal') shell.showItemInFolder(payload.path)
        else throw new Error('Unknown desktop action')
        await runtimeInvoke(runtime, 'host.reply', [payload.requestId, value])
      } catch (error) {
        await runtimeInvoke(runtime, 'host.reply', [payload.requestId, null, String(error)]).catch(() => {})
      }
    })()
  })
  const attachment = attachmentActions(win, new AttachmentStore(join(userData, 'attachments')))
  const routing = (self: string) => ({
    self,
    exists: (id: string) => computers.exists(id),
    status: (id: string) => computers.status(id),
    text: (message: string) => t(message),
  })
  /** Runs a call on another host's server and nudges overviews when it changed threads or projects. */
  const runOnHost = async (id: string, method: string, args: unknown[]) => {
    const result = await runtimeInvoke(computers.endpoint(id), method, args)
    const channel = activityChannel(method)
    if (channel) observeHostActivity(id, channel, {})
    return result
  }
  ipcMain.handle('ramu:invoke', async (event, requestMethod: unknown, requestArgs: unknown, requestHost?: unknown) => {
    // Only our windows may invoke IPC. Normal calls reach their owning computer; explicit computer management validates its target below.
    const self = event.sender === win.webContents ? LOCAL : undefined
    if (!self || event.senderFrame !== event.sender.mainFrame) throw new Error('Untrusted IPC sender')
    if (typeof requestMethod !== 'string' || !Array.isArray(requestArgs)) throw new Error('Invalid request')
    // A call may name its host. Another host is reached directly, for allow-listed methods only; the window's own host (or none) takes the path below.
    const route = routeInvoke(requestHost, requestMethod, routing(self))
    if (route.direct) return runOnHost(route.host, requestMethod, requestArgs)
    let method: string = requestMethod,
      args: unknown[] = requestArgs
    let settingsComputer = self
    if (method === 'computers.settings.invoke') {
      const [id, operation, parameters] = args
      if (typeof id !== 'string' || !computers.exists(id) || computers.status(id) !== 'connected')
        throw new Error('That host is not connected')
      if (
        typeof operation !== 'string' ||
        !/^(mcp\.|providers\.|updates\.|background\.|network\.|memory\.|learning\.|skills\.|summaries\.|settings\.permissions\.(clear|list|remove)$|codex\.hook\.|advisor\.claude$|projects\.list$|diagnostics\.(export|clear)$)/.test(
          operation,
        ) ||
        !Array.isArray(parameters)
      )
        throw new Error('Invalid settings action')
      if (id !== self && operation === 'providers.pickBinary')
        throw new Error('Enter the binary path on the selected host')
      settingsComputer = id
      method = operation
      args = parameters
    }
    const remote = settingsComputer !== LOCAL
    const target = method.startsWith('computers.') ? runtime : computers.endpoint(settingsComputer)
    if (remote && computers.status(settingsComputer) === 'paused' && !method.startsWith('computers.'))
      throw new Error(t('This connection is paused. Resume it in Remote access.'))
    if (method === 'app.content.mount') return contentDocuments.mount(args[0])
    if (method === 'app.content.release') return contentDocuments.release(args[0])
    if (method === 'app.systemLanguages') {
      const languages = app.getPreferredSystemLanguages(),
        before = desktopLanguage()
      configureDesktopLanguage(languagePreference, languages)
      if (desktopLanguage() !== before) updateApplicationMenu()
      return languages
    }
    if (method === 'settings.app.set') {
      const result = await runtimeInvoke(target, method, args)
      // The menu and dialogs follow this computer's language, not a paired computer's.
      if (remote) return result
      languagePreference = (args[0] as AppPreferences).language
      configureDesktopLanguage(languagePreference, app.getPreferredSystemLanguages())
      updateApplicationMenu()
      return result
    }
    if (method === 'editor.menu') {
      const options = args[0] as EditorMenuOptions | null,
        point = args[1] as { x?: unknown; y?: unknown } | null
      if (
        !options ||
        typeof options.selection !== 'string' ||
        options.selection.length > 1_000_000 ||
        !['editable', 'comment'].every((key) => typeof options[key as keyof EditorMenuOptions] === 'boolean') ||
        !point ||
        typeof point.x !== 'number' ||
        typeof point.y !== 'number' ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y)
      )
        throw new Error('Invalid editor menu request')
      return editorMenu(win, options, { x: point.x, y: point.y })
    }
    if (method === 'clipboard.write') {
      if (typeof args[0] !== 'string' || args[0].length > 5_000_000) throw new Error('Invalid clipboard text')
      return clipboard.writeText(args[0])
    }
    if (method === 'term.menu') {
      const point = args[1] as { x?: unknown; y?: unknown } | null
      if (
        typeof args[0] !== 'string' ||
        args[0].length > 1_000_000 ||
        !point ||
        typeof point.x !== 'number' ||
        typeof point.y !== 'number' ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y)
      )
        throw new Error('Invalid terminal menu request')
      return terminalMenu(win, args[0], { x: point.x, y: point.y })
    }
    if (['attachments.menu', 'attachments.save', 'attachments.copy', 'attachments.reveal'].includes(method)) {
      if (remote) throw new Error(t('Not available while connected to another host'))
      if (typeof args[0] !== 'string') throw new Error('Invalid attachment')
      if (method === 'attachments.save') return attachment.save(args[0])
      if (method === 'attachments.copy') return attachment.copy(args[0])
      if (method === 'attachments.reveal') return attachment.reveal(args[0])
      const point = args[2] as { x?: unknown; y?: unknown } | null
      if (
        typeof args[1] !== 'boolean' ||
        !point ||
        typeof point.x !== 'number' ||
        typeof point.y !== 'number' ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y)
      )
        throw new Error('Invalid menu request')
      return attachment.menu(args[0], args[1], { x: point.x, y: point.y })
    }
    if (method === 'computers.tasks.invoke') {
      const task = routeTaskCommand(args[0], args[1], args[2], routing(self))
      return runOnHost(task.host, task.method, task.args)
    }
    if (method === 'computers.invoke') {
      const [id, operation, parameters] = args
      if (typeof operation !== 'string' || !Array.isArray(parameters)) throw new Error('Invalid request')
      // Same routing as invokeOn. Naming this window's own host runs the call the normal way.
      const target = routeInvoke(id, operation, routing(self))
      if (target.direct) return runOnHost(target.host, operation, parameters)
      if (!isHostInvokeAllowed(operation)) throw new Error(t('That action is not available on another host'))
      return runOnHost(self, operation, parameters)
    }
    if (method === 'computers.recapAct') {
      const [id, recapId, action, until] = args
      if (typeof id !== 'string' || !computers.exists(id) || computers.status(id) !== 'connected')
        throw new Error('That host is not connected')
      if (typeof recapId !== 'string' || !['open', 'done', 'dismissed', 'snoozed'].includes(action as string))
        throw new Error('Invalid recap action')
      if (until !== undefined && (action !== 'snoozed' || typeof until !== 'number'))
        throw new Error('Invalid snooze time')
      await runtimeInvoke(
        computers.endpoint(id),
        'recaps.act',
        until === undefined ? [recapId, action] : [recapId, action, until],
      )
      observeHostActivity(id, 'automation:changed', {})
      return
    }
    if (method === 'computers.overview') {
      const id = args[0]
      if (typeof id !== 'string' || !computers.exists(id) || computers.status(id) !== 'connected')
        throw new Error('That host is not connected')
      return overviewReads.read(id)
    }
    if (method === 'computers.navigate') {
      const [id, destination] = args
      if (typeof id !== 'string' || !isHostDestination(destination)) throw new Error('Invalid host destination')
      openComputer(id, destination)
      return
    }
    if (method === 'computers.navigation.ready') {
      hostNavigation.ready()
      return
    }
    if (method === 'computers.scope') {
      if (args[0] !== null && typeof args[0] !== 'string') throw new Error('Invalid host filter')
      computers.setScope(args[0])
      return computers.list(self)
    }
    if (method === 'computers.list') {
      return computers.list(self)
    }
    if (method === 'computers.settings.get' || method === 'computers.settings.patch') {
      const id = args[0]
      if (typeof id !== 'string' || !computers.exists(id)) throw new Error('That host is no longer saved')
      if (computers.status(id) !== 'connected') throw new Error('That host is not connected')
      // An explicit target never falls back to this window's computer.
      const result = await runtimeInvoke(
        computers.endpoint(id),
        method === 'computers.settings.get' ? 'settings.app.snapshot' : 'settings.app.patch',
        method === 'computers.settings.get' ? [] : [args[1]],
      )
      if (method === 'computers.settings.patch' && id === LOCAL) {
        languagePreference = ((await runtimeInvoke(runtime, 'settings.app.get')) as AppPreferences).language
        configureDesktopLanguage(languagePreference, app.getPreferredSystemLanguages())
        updateApplicationMenu()
      }
      return result
    }
    if (method === 'computers.open') {
      if (typeof args[0] !== 'string') throw new Error('Invalid host')
      return openComputer(args[0])
    }
    if (method === 'computers.pair') {
      const [address, code, label] = args
      if (
        typeof address !== 'string' ||
        typeof code !== 'string' ||
        (label !== undefined && typeof label !== 'string') ||
        !code.trim()
      )
        throw new Error('Enter the address and the pairing code')
      const previous = servers.list()
      await computers.pair(address, code, label)
      for (const server of previous) if (!computers.exists(server.id)) await closeComputer(server.id)
      return computers.list(self)
    }
    if (method === 'computers.sshHosts') return ssh.hosts()
    if (method === 'computers.pairSsh') {
      const [target, label] = args
      if (typeof target !== 'string' || !target.trim() || (label !== undefined && typeof label !== 'string'))
        throw new Error('Enter user@host or an alias from your SSH config')
      const previous = servers.list()
      await computers.pairSsh(target, label)
      for (const server of previous) if (!computers.exists(server.id)) await closeComputer(server.id)
      return computers.list(self)
    }
    if (method === 'computers.forget') {
      if (typeof args[0] !== 'string') throw new Error('Invalid host')
      computers.forget(args[0])
      await closeComputer(args[0])
      return computers.list(self === args[0] ? LOCAL : self)
    }
    if (method === 'computers.retry') {
      if (typeof args[0] !== 'string') throw new Error('Invalid host')
      computers.retry(args[0])
      return computers.list(self)
    }
    if (method === 'computers.update') {
      if (typeof args[0] !== 'string' || !args[1] || typeof args[1] !== 'object' || Array.isArray(args[1]))
        throw new Error('Invalid host settings')
      computers.update(args[0], args[1] as Parameters<typeof computers.update>[1])
      return computers.list(self)
    }
    if (remote && ['background.start', 'background.login', 'background.restart'].includes(method))
      throw new Error(t('Not available while connected to another host'))
    if (method === 'background.start') {
      await ensureRuntime(userData, daemonPath)
      return
    }
    if (method === 'background.login') {
      if (typeof args[0] !== 'boolean') throw new Error('Invalid startup setting')
      return setLoginService(args[0])
    }
    if (method === 'background.status') {
      const status = await runtimeInvoke(target, method)
      return {
        ...status,
        loginEnabled: !remote && loginEnabled(userData),
        bundledVersion: app.getVersion(),
        bundledBuild: runtimeBuild(daemonPath),
        updateAvailable: !remote && status.build !== runtimeBuild(daemonPath),
      }
    }
    if (method === 'background.restart') {
      const choice = await dialog.showMessageBox(win, {
        type: 'question',
        message: t('Restart Ramu and the background service?'),
        detail: t('Stops running agents. Unfinished threads resume if restart recovery is enabled.'),
        buttons: [t('Restart now'), t('Later')],
        defaultId: 1,
        cancelId: 1,
      })
      if (choice.response !== 0) return
      const startup = loginEnabled(userData)
      // Unload the old supervisor so it cannot race the replacement back into existence.
      if (startup) {
        loginService(userData, daemonPath, false)
        unloadLoginService(userData)
      }
      await runtimeInvoke(runtime, 'background.restart').catch(() => {})
      for (let attempt = 0; attempt < 300; attempt++) {
        try {
          await runtimeInvoke(runtime, 'background.status')
        } catch {
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      await ensureRuntime(userData, daemonPath)
      if (startup) loginService(userData, daemonPath, true)
      app.relaunch()
      app.quit()
      return
    }
    if (method === 'app.relaunch') {
      if (remote) throw new Error(t('Not available while connected to another host'))
      app.relaunch()
      app.quit()
      return
    }
    if (method === 'updates.restart') {
      const choice = await dialog.showMessageBox(win, {
        type: 'question',
        message: t('Restart Ramu to finish updating?'),
        detail: t('Running threads continue. The background service can be updated separately.'),
        buttons: [t('Restart now'), t('Later')],
        defaultId: 1,
        cancelId: 1,
      })
      if (choice.response === 0) desktopUpdater.install()
      return
    }
    if (['updates.status', 'updates.check', 'updates.download'].includes(method)) {
      updateStatus = await runtimeInvoke(runtime, method, args)
      await desktopUpdater.prepare(updateStatus!)
      return updateView(updateStatus!)
    }
    return runtimeInvoke(target, method, args)
  })

  // Device-wide UI state: read synchronously by each page at startup, written through and fanned out to the other windows.
  ipcMain.on('ramu:device-state', (event) => {
    event.returnValue = event.sender === win.webContents ? deviceState.snapshot() : {}
  })
  ipcMain.on('ramu:device-state:set', (event, key: unknown, value: unknown) => {
    if (event.sender !== win.webContents || event.senderFrame !== event.sender.mainFrame) return
    try {
      if (!deviceState.set(key, value)) return
    } catch {
      return
    }
    if (key === 'appearance') applyAppearance()
  })

  const legacyStorage: Record<string, Record<string, string>> = {}
  for (const saved of servers.list()) {
    if (deviceState.snapshot()[`ramu.storage-migrated.${saved.id}`]) continue
    const migration = new WebContentsView({
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        additionalArguments: ['--ramu-storage-migration'],
        session: session.fromPartition(`persist:ramu-computer-${saved.id}`),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    })
    secure(migration.webContents.session)
    try {
      const devUrl = rendererUrl()
      if (devUrl) {
        const url = new URL(devUrl)
        url.searchParams.set('ramu-storage-migration', '1')
        await migration.webContents.loadURL(url.toString())
      } else
        await migration.webContents.loadFile(join(import.meta.dirname, '../renderer/index.html'), {
          query: { 'ramu-storage-migration': '1' },
        })
      const entries = (await migration.webContents.executeJavaScript(
        'Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)]))',
      )) as Record<string, string>
      legacyStorage[saved.id] = partitionHostEntries(saved.id, entries)
    } catch (error) {
      console.warn(`Could not migrate storage for ${saved.id}`, error)
    } finally {
      migration.webContents.close()
    }
  }
  ipcMain.on('ramu:legacy-storage', (event) => {
    event.returnValue =
      event.sender === win.webContents && event.senderFrame === event.sender.mainFrame ? legacyStorage : {}
  })
  ipcMain.on('ramu:legacy-storage:imported', (event, host: unknown) => {
    if (
      event.sender !== win.webContents ||
      event.senderFrame !== event.sender.mainFrame ||
      typeof host !== 'string' ||
      !legacyStorage[host]
    )
      return
    deviceState.set(`ramu.storage-migrated.${host}`, '1')
    delete legacyStorage[host]
  })

  if (process.env.ELECTRON_RENDERER_URL) await win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await win.loadFile(join(import.meta.dirname, '../renderer/index.html'))

  computers.start()
  const networkWake = () => refreshRuntimeNetwork(true)
  powerMonitor.on('resume', networkWake)
  app.on('before-quit', () => {
    powerMonitor.removeListener('resume', networkWake)
    desktopUpdater.close()
    deviceState.flush()
    computers.stop()
    broadcaster.close()
    clearTimeout(activityTimer)
    presence.close()
    unsubscribe()
  })
  // Keep the bridge available until windows have closed; renderers can still invoke it during before-quit.
  app.on('will-quit', () => {
    ipcMain.removeHandler('ramu:invoke')
    ipcMain.removeAllListeners('ramu:legacy-storage')
    ipcMain.removeAllListeners('ramu:legacy-storage:imported')
    ipcMain.removeAllListeners('ramu:device-state')
    ipcMain.removeAllListeners('ramu:device-state:set')
  })
  app.on('window-all-closed', () => app.quit())
}

void main()
