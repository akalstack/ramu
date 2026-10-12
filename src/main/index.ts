import { configureDesktopLanguage, desktopLanguage, t } from './localization'
import { editorMenu, type EditorMenuOptions } from './editorMenu'
import { existsSync } from 'node:fs'
import { DEFAULT_APP_PREFERENCES, type AppPreferences } from '../shared/types'
import { join } from 'node:path'
import { app, BrowserWindow, Menu, safeStorage, session, shell, dialog, ipcMain, clipboard } from 'electron'
import { CompletionService } from './completion'
import { editMenuItems } from './editMenu'
import { AttachmentStore } from './attachments'
import { attachmentActions } from './attachmentActions'
import { terminalMenu } from './terminalMenu'
import { createAgentNotifier } from './agentNotifier'
import { ensureRuntime, runtimeInvoke, subscribeRuntime, loginService, loginEnabled, loginPreferred } from './runtimeClient'

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
  "img-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
].join('; ')

async function main() {
  await app.whenReady()

  const userData = app.getPath('userData')
  const daemonPath = join(import.meta.dirname, 'daemon.js')
  const socketPath = await ensureRuntime(userData, daemonPath)
  if (app.isPackaged && !process.env.RAMU_USER_DATA && process.platform === 'darwin' && loginPreferred(userData) !== false && !loginEnabled(userData)) loginService(userData, daemonPath, true)

  if (!process.env.ELECTRON_RENDERER_URL) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } })
    })
  }
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))

  const languagePreferences = await runtimeInvoke(socketPath, 'settings.app.get') as AppPreferences
  let languagePreference = languagePreferences.language
  configureDesktopLanguage(languagePreference, app.getPreferredSystemLanguages())

  // Our own menu: keeps copy/paste and quit, but leaves ⌘W, ⌘N, ⌘P and friends to the app's shortcuts.
  const updateApplicationMenu = () => {
    const menu = Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ label: 'Ramu', role: 'appMenu' as const }] : []),
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

  updateApplicationMenu()

  // Packaged macOS builds take the icon from the bundle; development, Linux and Windows read it from assets/.
  const icon = join(import.meta.dirname, '../../assets/icon.png')
  if (process.platform === 'darwin' && !app.isPackaged && existsSync(icon)) app.dock?.setIcon(icon)

  const win = new BrowserWindow({
    ...(existsSync(icon) ? { icon } : {}),
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

  win.webContents.on('context-menu', (_event, params) => {
    const items = editMenuItems(params)
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win, ...(params.frame ? { frame: params.frame } : {}) })
  })

  const send = (channel: string, payload: unknown) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
  const notifier = createAgentNotifier({ window: win, send, invoke: (method, args) => runtimeInvoke(socketPath, method, args) })
  const unsubscribe = subscribeRuntime(socketPath, (channel, payload) => {
    if (channel !== 'host:request') { send(channel, payload); notifier.observe(channel, payload); return }
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
        else if (payload.method === 'trash') await shell.trashItem(payload.path)
        else if (payload.method === 'reveal') shell.showItemInFolder(payload.path)
        else throw new Error('Unknown desktop action')
        await runtimeInvoke(socketPath, 'host.reply', [payload.requestId, value])
      } catch (error) { await runtimeInvoke(socketPath, 'host.reply', [payload.requestId, null, String(error)]).catch(() => {}) }
    })()
  })
  // Completion runs here, not in the daemon: the API key is decrypted with the OS keychain, which only the main process can reach.
  const completion = new CompletionService({
    preferences: async () => ({ ...DEFAULT_APP_PREFERENCES, ...(await runtimeInvoke(socketPath, 'settings.app.get') as Partial<AppPreferences>) }),
    notify: send,
    readFile: async (taskId, repoId, path) => { try { return (await runtimeInvoke(socketPath, 'files.read', [taskId, repoId, path]) as { content: string }).content } catch { return null } },
    search: async (taskId, repoId, pattern) => { try { return ((await runtimeInvoke(socketPath, 'files.search', [taskId, { query: pattern, caseSensitive: true, wholeWord: false, regex: true, include: '', exclude: '', repoId }]) as { matches: { path: string; line: number }[] }).matches).map((m) => ({ path: m.path, line: m.line })) } catch { return [] } },
    keyFile: join(userData, 'completion-key.json'),
    // Lets tests point the local provider at a mock server.
    ollamaUrl: process.env.RAMU_OLLAMA_URL,
    crypto: { available: () => safeStorage.isEncryptionAvailable(), encrypt: (text) => safeStorage.encryptString(text), decrypt: (data) => safeStorage.decryptString(data) },
  })
  const attachment = attachmentActions(win, new AttachmentStore(join(userData, 'attachments')))
  ipcMain.handle('ramu:invoke', async (event, method: unknown, args: unknown) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Untrusted IPC sender')
    if (typeof method !== 'string' || !Array.isArray(args)) throw new Error('Invalid request')
    if (method === 'app.systemLanguages') {
      const languages = app.getPreferredSystemLanguages(), before = desktopLanguage()
      configureDesktopLanguage(languagePreference, languages)
      if (desktopLanguage() !== before) updateApplicationMenu()
      return languages
    }
    if (method === 'settings.app.set') {
      const result = await runtimeInvoke(socketPath, method, args)
      languagePreference = (args[0] as AppPreferences).language
      configureDesktopLanguage(languagePreference, app.getPreferredSystemLanguages())
      updateApplicationMenu()
      return result
    }
    if (method === 'editor.menu') {
      const options = args[0] as EditorMenuOptions | null, point = args[1] as { x?: unknown; y?: unknown } | null
      if (!options || typeof options.selection !== 'string' || options.selection.length > 1_000_000 || !['editable', 'comment', 'definition', 'references', 'rename', 'format'].every((key) => typeof options[key as keyof EditorMenuOptions] === 'boolean') || !point || typeof point.x !== 'number' || typeof point.y !== 'number' || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Invalid editor menu request')
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
      if (typeof args[0] !== 'string') throw new Error('Invalid attachment')
      if (method === 'attachments.save') return attachment.save(args[0])
      if (method === 'attachments.copy') return attachment.copy(args[0])
      if (method === 'attachments.reveal') return attachment.reveal(args[0])
      const point = args[2] as { x?: unknown; y?: unknown } | null
      if (typeof args[1] !== 'boolean' || !point || typeof point.x !== 'number' || typeof point.y !== 'number' || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Invalid menu request')
      return attachment.menu(args[0], args[1], { x: point.x, y: point.y })
    }
    if (method.startsWith('completion.')) return completion.handle(method, args)
    if (method === 'background.start') { await ensureRuntime(userData, daemonPath); return }
    if (method === 'background.login') { if (typeof args[0] !== 'boolean') throw new Error('Invalid startup setting'); loginService(userData, daemonPath, args[0]); return }
    if (method === 'background.status') return { ...await runtimeInvoke(socketPath, method), loginEnabled: loginEnabled(userData) }
    return runtimeInvoke(socketPath, method, args)
  })

  // No in-app navigation or new windows; external links open in the browser.
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) await win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await win.loadFile(join(import.meta.dirname, '../renderer/index.html'))

  app.on('before-quit', () => {
    unsubscribe()
    ipcMain.removeHandler('ramu:invoke')
  })
  app.on('window-all-closed', () => app.quit())
}

void main()
