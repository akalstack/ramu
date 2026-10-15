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
import { app, BrowserWindow, Menu, session, shell, dialog, ipcMain, clipboard, safeStorage, powerMonitor, WebContentsView, type Session, type WebContents } from 'electron'
import { editMenuItems } from './editMenu'
import { AttachmentStore } from '@ramu/server/attachments'
import { attachmentActions } from './attachmentActions'
import { terminalMenu } from './terminalMenu'
import { createAgentNotifier } from './agentNotifier'
import { runtimeInvoke, runtimePair, subscribeRuntime, refreshRuntimeNetwork, runtimeNetwork, PresenceListener } from '@ramu/client-runtime'
import { SshComputers } from './sshComputers'
import { RemoteServers } from './remoteServers'
import { ComputerBroadcaster } from './computerBroadcast'
import { HiddenEvents } from './hiddenEvents'
import { WorkspaceViewCache } from './viewCache'
import { randomUUID } from 'node:crypto'
import { ComputerRegistry, LOCAL } from './computers'
import { ensureRuntime, loginService, loginEnabled, loginPreferred } from './runtimeLauncher'

// Set the native runtime identity before creating menus, windows or notifications.
app.setName('Ramu')
if (process.platform === 'win32') app.setAppUserModelId('app.ramu.desktop')
app.setAboutPanelOptions({ applicationName: 'Ramu', applicationVersion: app.getVersion() })

// Lets tests and screenshots run against a throwaway profile.
if (process.env.RAMU_USER_DATA) app.setPath('userData', process.env.RAMU_USER_DATA)

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "media-src 'self' data:",
  "frame-src data:",
  "img-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
].join('; ')

// `ramu://pair?...` links can arrive before the window exists, so they queue until it can show them.
const PAIR_LINK = /^ramu:\/\/pair(?:[/?]|$)/i
const queuedPairLinks: string[] = []
let showPairLink: ((link: string) => void) | null = null
const receivePairLink = (link: string) => { if (link.length > 4096 || !PAIR_LINK.test(link)) return; if (showPairLink) showPairLink(link); else queuedPairLinks.push(link) }
app.on('open-url', (event, url) => { event.preventDefault(); receivePairLink(url) })
for (const arg of process.argv) receivePairLink(arg)
if (app.isPackaged) app.setAsDefaultProtocolClient('ramu')

async function main() {
  await app.whenReady()

  const userData = app.getPath('userData')
  const daemonPath = join(import.meta.dirname, 'daemon.js')
  // This computer's server always runs. Paired computers connect alongside it, each with its own window (see openComputer).
  const runtime = await ensureRuntime(userData, daemonPath)
  const servers = new RemoteServers(join(userData, 'remote-servers.json'), { get available() { return safeStorage.isEncryptionAvailable() }, seal: (text) => safeStorage.encryptString(text).toString('base64'), open: (text) => safeStorage.decryptString(Buffer.from(text, 'base64')) })
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
  if (app.isPackaged && !process.env.RAMU_USER_DATA && process.platform === 'darwin' && loginPreferred(userData) !== false && !loginEnabled(userData)) await setLoginService(true)

  // Every window, including each paired computer's own partition, gets the same policy.
  const secure = (ses: Session) => {
    if (!process.env.ELECTRON_RENDERER_URL) {
      ses.webRequest.onHeadersReceived((details, callback) => {
        callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } })
      })
    }
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  }
  secure(session.defaultSession)

  const languagePreferences = await runtimeInvoke(runtime, 'settings.app.get') as AppPreferences
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
          ...(process.platform === 'darwin' ? [
            { label: t('Services'), role: 'services' as const },
            { type: 'separator' as const },
            { label: t('Hide Ramu'), role: 'hide' as const },
            { label: t('Hide others'), role: 'hideOthers' as const },
            { label: t('Show all'), role: 'unhide' as const },
            { type: 'separator' as const },
          ] : []),
          { label: t('Quit Ramu'), role: 'quit' },
        ],
      },
      { label: t('Edit'), role: 'editMenu' },
      {
        label: t('View'),
        submenu: [{ label: t('Reload'), role: 'reload' }, { label: t('Developer tools'), role: 'toggleDevTools' }, { type: 'separator' }, { label: t('Actual size'), role: 'resetZoom' }, { label: t('Zoom in'), role: 'zoomIn' }, { label: t('Zoom out'), role: 'zoomOut' }, { type: 'separator' }, { label: t('Full screen'), role: 'togglefullscreen' }],
      },
      { label: t('Window'), submenu: [{ label: t('Minimize'), role: 'minimize' }, { label: t('Zoom'), role: 'zoom' }] },
    ])
    // Translate Electron's generated items too, preserving platform editing actions and shortcuts.
    const roleCopy: Record<string, string> = { appMenu: 'Ramu', editMenu: 'Edit', about: 'About Ramu', services: 'Services', hide: 'Hide Ramu', hideOthers: 'Hide others', unhide: 'Show all', quit: 'Quit Ramu', undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', pasteAndMatchStyle: 'Paste and match style', delete: 'Delete', selectAll: 'Select all', startSpeaking: 'Start speaking', stopSpeaking: 'Stop speaking', reload: 'Reload', toggleDevTools: 'Developer tools', resetZoom: 'Actual size', zoomIn: 'Zoom in', zoomOut: 'Zoom out', togglefullscreen: 'Full screen', minimize: 'Minimize', zoom: 'Zoom' }
    const roles = Object.fromEntries(Object.entries(roleCopy).map(([role, copy]) => [role.toLowerCase(), copy]))
    const localize = (menu: Menu) => { for (const item of menu.items) { item.label = t(roles[item.role?.toLowerCase() ?? ''] ?? item.label); if (item.submenu) localize(item.submenu) } }
    localize(menu)
    Menu.setApplicationMenu(menu)
  }

  const openSettings = (action: 'settings' | 'check-updates') => {
    if (win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    sendTo(visible, 'menu:action', { action })
  }
  updateApplicationMenu()
  showPairLink = (link) => {
    if (win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show(); win.focus()
    sendTo(visible, 'pair:link', { link })
  }
  // The window may still be loading; the renderer keeps the link until the screen asks for it.
  for (const link of queuedPairLinks.splice(0)) setTimeout(() => showPairLink?.(link), 1500)

  // Packaged macOS builds take the icon from the bundle; development, Linux and Windows read it from assets/.
  // Packaged builds copy assets/ beside the app; in the monorepo it sits at the repository root.
  const icon = [join(import.meta.dirname, '../../assets/icon.png'), join(import.meta.dirname, '../../../../assets/icon.png')].find((path) => existsSync(path)) ?? ''
  // In development the dock icon comes from the patched Electron.app (scripts/dev-icon.mjs), so the glass icon is not replaced by a flat PNG.

  const win = new BrowserWindow({
    ...(icon ? { icon } : {}),
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    title: 'Ramu',
    backgroundColor: '#131315',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 16 } } : {}),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })

  // Each computer's page gets the same behavior: edit menu, window chrome, and no navigation away from the app.
  const sendChrome = (contents: WebContents) => { if (!contents.isDestroyed()) contents.send('ramu:window-chrome', { controlsInset: process.platform === 'darwin' && !win.isFullScreen() ? 84 : 0 }) }
  const wire = (contents: WebContents) => {
    contents.on('context-menu', (_event, params) => {
      const items = editMenuItems(params)
      if (items.length) Menu.buildFromTemplate(items).popup({ window: win, ...(params.frame ? { frame: params.frame } : {}) })
    })
    contents.on('dom-ready', () => { sendChrome(contents); const id = owners.get(contents.id); if (id) sendTo(id, 'workspace:visibility', { visible: id === visible }) })
    // No in-app navigation or new windows; external links open in the browser.
    contents.on('will-navigate', (e, url) => { if (url !== contents.getURL()) e.preventDefault() })
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
  }
  wire(win.webContents)

  let updateStatus: AppUpdateStatus | undefined
  const desktopUpdater = new DesktopUpdater(userData, () => { if (updateStatus) sendAll('updates:changed', updateView(updateStatus)) })
  const updateView = (status: AppUpdateStatus): AppUpdateStatus => {
    const stale = !!status.release && !newerVersion(status.release.version, app.getVersion())
    return { ...status, currentVersion: app.getVersion(), ...(stale ? { release: null, phase: 'idle' as const, downloadedBytes: 0 } : {}), nativeReady: !stale && desktopUpdater.ready, supported: desktopUpdater.supported, error: desktopUpdater.error ?? status.error }
  }
  // `send` reaches this computer's window. Paired computers have their own windows, created on first use.
  const views = new Map<string, WebContentsView>()
  const owners = new Map<number, string>([[win.webContents.id, LOCAL]])
  let visible = LOCAL
  const contentsOf = (id: string): WebContents | undefined => id === LOCAL ? win.webContents : views.get(id)?.webContents
  const sendTo = (id: string, channel: string, payload: unknown) => { const contents = contentsOf(id); if (contents && !contents.isDestroyed()) contents.send(channel, payload) }
  const hiddenEvents = new Map<string, HiddenEvents>()
  const deliverTo = (id: string, channel: string, payload: unknown) => {
    if (id === visible) sendTo(id, channel, payload)
    else if (contentsOf(id)) { let events = hiddenEvents.get(id); if (!events) { events = new HiddenEvents(); hiddenEvents.set(id, events) }; events.add(channel, payload) }
  }
  const send = (channel: string, payload: unknown) => deliverTo(LOCAL, channel, payload)
  const sendAll = (channel: string, payload: unknown) => { for (const id of [LOCAL, ...views.keys()]) deliverTo(id, channel, payload) }
  const broadcaster = new ComputerBroadcaster(() => computers.list(visible), (state) => sendTo(visible, 'computers:changed', state))
  const announce = () => broadcaster.changed()
  const checkpointRequests = new Map<string, { id: string; finish: (safe: boolean) => void }>()
  const releaseView = (id: string) => {
    const view = views.get(id)
    if (!view || id === visible) return
    win.contentView.removeChildView(view)
    owners.delete(view.webContents.id); views.delete(id); hiddenEvents.delete(id)
    view.webContents.close()
  }
  const viewCache = new WorkspaceViewCache((id) => new Promise<boolean>((resolve) => {
    const contents = contentsOf(id)
    if (!contents || contents.isDestroyed() || contents.isLoading()) { resolve(false); return }
    const requestId = randomUUID()
    const timer = setTimeout(() => { checkpointRequests.delete(requestId); resolve(false) }, 15000)
    checkpointRequests.set(requestId, { id, finish: (safe) => { clearTimeout(timer); checkpointRequests.delete(requestId); resolve(safe) } })
    sendTo(id, 'workspace:checkpoint', { requestId })
  }), releaseView)
  const sweepViews = setInterval(() => { void viewCache.sweep() }, 60_000)
  sweepViews.unref()
  // Native fullscreen hides the macOS traffic lights; reclaim their space in the header, and refit the visible window.
  const layout = () => {
    if (win.isDestroyed()) return
    const view = views.get(visible)
    if (view) { const { width, height } = win.getContentBounds(); view.setBounds({ x: 0, y: 0, width, height }) }
  }
  const chromeChanged = () => { for (const id of [LOCAL, ...views.keys()]) { const contents = contentsOf(id); if (contents) sendChrome(contents) }; layout() }
  win.on('enter-full-screen', chromeChanged)
  win.on('leave-full-screen', chromeChanged)
  win.on('resize', layout)

  const notifiers = new Map<string, ReturnType<typeof createAgentNotifier>>()
  const pendingOpen = new Map<string, { taskId: string; sessionId: string }>()
  const notifierFor = (id: string) => {
    let notifier = notifiers.get(id)
    if (!notifier) {
      const local = id === LOCAL
      notifier = createAgentNotifier({
        window: win,
        send: (channel, payload) => sendTo(id, channel, payload),
        invoke: (method, args) => runtimeInvoke(computers.endpoint(id), method, args),
        preferences: () => runtimeInvoke(runtime, 'settings.app.get'),
        visible: () => visible === id,
        ...(local ? {} : { label: () => computers.list(LOCAL).computers.find((computer) => computer.id === id)?.name ?? '' }),
        reveal: (target) => {
          const fresh = !contentsOf(id)
          try { openComputer(id) } catch { return }
          // A window that has not loaded yet asks for this when it starts (see 'computers.list').
          if (fresh || contentsOf(id)?.isLoading()) pendingOpen.set(id, target)
          else sendTo(id, 'notify:open', target)
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
    servers, ssh, deviceName: hostname(), localName: () => t('This computer'), local: runtime,
    subscribe: (target, receive, options) => subscribeRuntime(target, receive, runtimeNetwork, {
      ...options, presencePort: presence.port,
      ...(target.kind === 'http' ? { watchWake: (wake: () => void) => presence.watch(target.token, wake) } : {}),
    }), invoke: runtimeInvoke, pair: runtimePair,
    deliver: (id, channel, payload) => { deliverTo(id, channel, payload); notifierFor(id).observe(channel, payload) },
    changed: announce,
  })
  const rendererUrl = () => process.env.ELECTRON_RENDERER_URL
  const ensureView = (id: string) => {
    const existing = views.get(id)
    if (existing) return existing
    const view = new WebContentsView({ webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, session: session.fromPartition(`persist:ramu-computer-${id}`) } })
    secure(view.webContents.session)
    wire(view.webContents)
    owners.set(view.webContents.id, id)
    views.set(id, view)
    const url = rendererUrl()
    if (url) void view.webContents.loadURL(url); else void view.webContents.loadFile(join(import.meta.dirname, '../renderer/index.html'))
    return view
  }
  /** How long the outgoing window stays on screen while the incoming one paints. */
  const SWAP_SETTLE_MS = 150
  let settleTimer: NodeJS.Timeout | undefined
  /** Brings a computer's window to the front. Every other window keeps running behind it. */
  const openComputer = (id: string) => {
    if (!computers.exists(id)) throw new Error(t('That computer is no longer saved'))
    const info = computers.list(LOCAL).computers.find((computer) => computer.id === id)!
    if (id !== LOCAL && info.status === 'rejected') throw new Error(t('{name} no longer accepts this computer. Forget it, then pair again.', { name: info.name }))
    if (id !== LOCAL && info.status !== 'connected') throw new Error(t('{name} is not reachable right now.', { name: info.name }))
    const previousId = visible
    const previous = views.get(previousId)
    visible = id
    // A hidden workspace blanks its page, so the new one is told first and the old one only after it is out of sight.
    sendTo(id, 'workspace:visibility', { visible: true })
    if (id === LOCAL) win.webContents.focus()
    else {
      const view = ensureView(id)
      // Under the old window first, so it repaints out of sight; settling raises it.
      const below = previous && previous !== view ? win.contentView.children.indexOf(previous) : -1
      if (below >= 0) win.contentView.addChildView(view, below); else win.contentView.addChildView(view)
      layout()
      view.webContents.focus()
    }
    clearTimeout(settleTimer)
    const settle = () => {
      if (visible !== id || win.isDestroyed()) return
      const shown = views.get(id)
      if (shown) win.contentView.addChildView(shown)
      for (const [viewId, view] of views) if (viewId !== id) win.contentView.removeChildView(view)
      if (previousId !== id) sendTo(previousId, 'workspace:visibility', { visible: false })
    }
    const contents = views.get(id)?.webContents
    if (contents?.isLoading()) { contents.once('did-finish-load', () => { settleTimer = setTimeout(settle, SWAP_SETTLE_MS) }); settleTimer = setTimeout(settle, 3000) }
    else settleTimer = setTimeout(settle, SWAP_SETTLE_MS)
    sendTo(id, 'background:connection', { connected: info.status === 'connected', rejected: info.status === 'rejected' })
    hiddenEvents.get(id)?.drain((channel, payload) => sendTo(id, channel, payload), t('Older terminal output was truncated while this workspace was hidden.'))
    hiddenEvents.delete(id)
    if (updateStatus) sendTo(id, 'updates:changed', updateView(updateStatus))
    broadcaster.flush()
    viewCache.show(id)
  }
  /** Drops a forgotten computer's window and everything it stored. */
  const closeComputer = async (id: string) => {
    const view = views.get(id)
    if (view) {
      if (visible === id) openComputer(LOCAL)
      win.contentView.removeChildView(view)
      owners.delete(view.webContents.id); views.delete(id)
      const ses = view.webContents.session
      view.webContents.close()
      await ses.clearStorageData().catch(() => {})
    }
    viewCache.forget(id); hiddenEvents.delete(id); notifiers.delete(id); pendingOpen.delete(id)
    for (const request of checkpointRequests.values()) if (request.id === id) request.finish(false)
  }
  const unsubscribe = subscribeRuntime(runtime, (channel, payload) => {
    if (channel === 'background:connection') computers.setLocalStatus(payload.connected)
    computers.observe(LOCAL, channel, payload)
    if (channel === 'updates:changed') { updateStatus = payload; void desktopUpdater.prepare(payload); sendAll(channel, updateView(payload)); return }
    if (channel !== 'host:request') { send(channel, payload); notifierFor(LOCAL).observe(channel, payload); return }
    void (async () => {
      try {
        let value: unknown
        if (payload.method === 'pickDirectory') {
          // Test runs answer the folder dialog through RAMU_TEST_PICK_DIRECTORY instead of a native sheet.
          if (process.env.RAMU_TEST_PICK_DIRECTORY) value = process.env.RAMU_TEST_PICK_DIRECTORY
          else { const result = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: payload.path === 'repository' ? t('Connect a repository') : t('Add project'), buttonLabel: payload.path === 'repository' ? t('Connect') : t('Add project') }); value = result.canceled ? null : result.filePaths[0] ?? null }
        }
        else if (payload.method === 'pickExecutable') { const result = await dialog.showOpenDialog(win, { properties: ['openFile'], title: t('Select provider binary'), buttonLabel: t('Use binary') }); value = result.canceled ? null : result.filePaths[0] ?? null }
        else if (payload.method === 'pickAttachments') { const result = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], title: t('Attach files') }); value = result.canceled ? [] : result.filePaths }
        else if (payload.method === 'reveal') shell.showItemInFolder(payload.path)
        else throw new Error('Unknown desktop action')
        await runtimeInvoke(runtime, 'host.reply', [payload.requestId, value])
      } catch (error) { await runtimeInvoke(runtime, 'host.reply', [payload.requestId, null, String(error)]).catch(() => {}) }
    })()
  })
  const attachment = attachmentActions(win, new AttachmentStore(join(userData, 'attachments')))
  ipcMain.handle('ramu:invoke', async (event, requestMethod: unknown, requestArgs: unknown) => {
    // Only our windows may invoke IPC. Normal calls reach their owning computer; explicit computer management validates its target below.
    const self = owners.get(event.sender.id)
    if (!self || event.senderFrame !== event.sender.mainFrame) throw new Error('Untrusted IPC sender')
    if (typeof requestMethod !== 'string' || !Array.isArray(requestArgs)) throw new Error('Invalid request')
    let method: string = requestMethod, args: unknown[] = requestArgs
    let settingsComputer = self
    if (method === 'computers.settings.invoke') {
      const [id, operation, parameters] = args
      if (typeof id !== 'string' || !computers.exists(id) || computers.status(id) !== 'connected') throw new Error('That computer is not connected')
      if (typeof operation !== 'string' || !/^(providers\.|updates\.|background\.|network\.|memory\.|learning\.|codex\.hook\.|advisor\.claude$)/.test(operation) || !Array.isArray(parameters)) throw new Error('Invalid settings action')
      if (id !== self && operation === 'providers.pickBinary') throw new Error('Enter the binary path on the selected computer')
      settingsComputer = id; method = operation; args = parameters
    }
    const remote = settingsComputer !== LOCAL
    const target = method.startsWith('computers.') ? runtime : computers.endpoint(settingsComputer)
    if (remote && computers.status(settingsComputer) === 'paused' && !method.startsWith('computers.')) throw new Error(t('This connection is paused. Resume it in Remote access.'))
    if (method === 'app.systemLanguages') {
      const languages = app.getPreferredSystemLanguages(), before = desktopLanguage()
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
      const options = args[0] as EditorMenuOptions | null, point = args[1] as { x?: unknown; y?: unknown } | null
      if (!options || typeof options.selection !== 'string' || options.selection.length > 1_000_000 || !['editable', 'comment'].every((key) => typeof options[key as keyof EditorMenuOptions] === 'boolean') || !point || typeof point.x !== 'number' || typeof point.y !== 'number' || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Invalid editor menu request')
      return editorMenu(win, options, { x: point.x, y: point.y })
    }
    if (method === 'clipboard.write') {
      if (typeof args[0] !== 'string' || args[0].length > 5_000_000) throw new Error('Invalid clipboard text')
      return clipboard.writeText(args[0])
    }
    if (method === 'term.menu') {
      const point = args[1] as { x?: unknown; y?: unknown } | null
      if (typeof args[0] !== 'string' || args[0].length > 1_000_000 || !point || typeof point.x !== 'number' || typeof point.y !== 'number' || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Invalid terminal menu request')
      return terminalMenu(win, args[0], { x: point.x, y: point.y })
    }
    if (['attachments.menu', 'attachments.save', 'attachments.copy', 'attachments.reveal'].includes(method)) {
      if (remote) throw new Error(t('Not available while connected to another computer'))
      if (typeof args[0] !== 'string') throw new Error('Invalid attachment')
      if (method === 'attachments.save') return attachment.save(args[0])
      if (method === 'attachments.copy') return attachment.copy(args[0])
      if (method === 'attachments.reveal') return attachment.reveal(args[0])
      const point = args[2] as { x?: unknown; y?: unknown } | null
      if (typeof args[1] !== 'boolean' || !point || typeof point.x !== 'number' || typeof point.y !== 'number' || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Invalid menu request')
      return attachment.menu(args[0], args[1], { x: point.x, y: point.y })
    }
    if (method === 'computers.checkpoint') {
      if (typeof args[0] !== 'string' || typeof args[1] !== 'boolean') throw new Error('Invalid workspace checkpoint')
      const request = checkpointRequests.get(args[0])
      if (!request || request.id !== self) return false
      const safe = args[1] && self !== visible
      request.finish(safe)
      return safe
    }
    if (method === 'computers.list') {
      // A window that opened from a notification asks for its chat once it has loaded.
      const waiting = pendingOpen.get(self)
      if (waiting) { pendingOpen.delete(self); setTimeout(() => sendTo(self, 'notify:open', waiting), 400) }
      return computers.list(self)
    }
    if (method === 'computers.settings.get' || method === 'computers.settings.patch') {
      const id = args[0]
      if (typeof id !== 'string' || !computers.exists(id)) throw new Error('That computer is no longer saved')
      if (computers.status(id) !== 'connected') throw new Error('That computer is not connected')
      // An explicit target never falls back to this window's computer.
      const result = await runtimeInvoke(computers.endpoint(id), method === 'computers.settings.get' ? 'settings.app.snapshot' : 'settings.app.patch', method === 'computers.settings.get' ? [] : [args[1]])
      if (method === 'computers.settings.patch' && id === LOCAL) {
        languagePreference = (await runtimeInvoke(runtime, 'settings.app.get') as AppPreferences).language
        configureDesktopLanguage(languagePreference, app.getPreferredSystemLanguages())
        updateApplicationMenu()
      }
      return result
    }
    if (method === 'computers.open') {
      if (typeof args[0] !== 'string') throw new Error('Invalid computer')
      return openComputer(args[0])
    }
    if (method === 'computers.pair') {
      const [address, code, label] = args
      if (typeof address !== 'string' || typeof code !== 'string' || (label !== undefined && typeof label !== 'string') || !code.trim()) throw new Error('Enter the address and the pairing code')
      const previous = servers.list()
      await computers.pair(address, code, label)
      for (const server of previous) if (!computers.exists(server.id)) await closeComputer(server.id)
      return computers.list(self)
    }
    if (method === 'computers.sshHosts') return ssh.hosts()
    if (method === 'computers.pairSsh') {
      const [target, label] = args
      if (typeof target !== 'string' || !target.trim() || (label !== undefined && typeof label !== 'string')) throw new Error('Enter user@host or an alias from your SSH config')
      const previous = servers.list()
      await computers.pairSsh(target, label)
      for (const server of previous) if (!computers.exists(server.id)) await closeComputer(server.id)
      return computers.list(self)
    }
    if (method === 'computers.forget') {
      if (typeof args[0] !== 'string') throw new Error('Invalid computer')
      computers.forget(args[0])
      await closeComputer(args[0])
      return computers.list(self === args[0] ? LOCAL : self)
    }
    if (method === 'computers.retry') {
      if (typeof args[0] !== 'string') throw new Error('Invalid computer')
      computers.retry(args[0])
      return computers.list(self)
    }
    if (method === 'computers.update') {
      if (typeof args[0] !== 'string' || !args[1] || typeof args[1] !== 'object' || Array.isArray(args[1])) throw new Error('Invalid computer settings')
      computers.update(args[0], args[1] as Parameters<typeof computers.update>[1])
      return computers.list(self)
    }
    if (remote && ['background.start', 'background.login', 'background.restart'].includes(method)) throw new Error(t('Not available while connected to another computer'))
    if (method === 'background.start') { await ensureRuntime(userData, daemonPath); return }
    if (method === 'background.login') { if (typeof args[0] !== 'boolean') throw new Error('Invalid startup setting'); return setLoginService(args[0]) }
    if (method === 'background.status') { const status = await runtimeInvoke(target, method); return { ...status, loginEnabled: !remote && loginEnabled(userData), bundledVersion: app.getVersion(), bundledBuild: runtimeBuild(daemonPath), updateAvailable: !remote && status.build !== runtimeBuild(daemonPath) } }
    if (method === 'background.restart') {
      const choice = await dialog.showMessageBox(win, { type: 'question', message: t('Restart Ramu and the background service?'), detail: t("Stops running agents. Unfinished chats resume if restart recovery is enabled."), buttons: [t('Restart now'), t('Later')], defaultId: 1, cancelId: 1 })
      if (choice.response !== 0) return
      const startup = loginEnabled(userData)
      // Unload the old supervisor so it cannot race the replacement back into existence.
      if (startup) { loginService(userData, daemonPath, false); unloadLoginService(userData) }
      await runtimeInvoke(runtime, 'background.restart').catch(() => {})
      for (let attempt = 0; attempt < 300; attempt++) { try { await runtimeInvoke(runtime, 'background.status') } catch { break }; await new Promise((resolve) => setTimeout(resolve, 100)) }
      await ensureRuntime(userData, daemonPath)
      if (startup) loginService(userData, daemonPath, true)
      app.relaunch(); app.quit(); return
    }
    if (method === 'updates.restart') {
      const choice = await dialog.showMessageBox(win, { type: 'question', message: t('Restart Ramu to finish updating?'), detail: t("Running chats continue. The background service can be updated separately."), buttons: [t('Restart now'), t('Later')], defaultId: 1, cancelId: 1 })
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

  if (process.env.ELECTRON_RENDERER_URL) await win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await win.loadFile(join(import.meta.dirname, '../renderer/index.html'))

  computers.start()
  const networkWake = () => refreshRuntimeNetwork(true)
  powerMonitor.on('resume', networkWake)
  app.on('before-quit', () => {
    powerMonitor.removeListener('resume', networkWake)
    desktopUpdater.close()
    computers.stop()
    broadcaster.close(); viewCache.close(); clearInterval(sweepViews)
    for (const request of checkpointRequests.values()) request.finish(false)
    presence.close()
    unsubscribe()
  })
  // Keep the bridge available until windows have closed; renderers can still invoke it during before-quit.
  app.on('will-quit', () => ipcMain.removeHandler('ramu:invoke'))
  app.on('window-all-closed', () => app.quit())
}

void main()
