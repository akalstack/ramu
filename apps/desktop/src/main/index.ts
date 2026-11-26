import { isThemePreviewDocument, themePreviewResponse, THEME_PREVIEW_CSP } from './themePreview'
import { PRIVACY_PANES, privacyPaneUrl, type PrivacyPane } from '@ramu/shared/privacyPanes'
import { INTERACTIVE_CSP } from '@ramu/shared/interactive'
import { ContentDocuments } from './contentDocuments'
import { HostNavigation } from './hostNavigation'
import type { HostDestination } from '@ramu/shared/hostOverview'
import { readHostOverview, HostOverviewQueue } from './hostOverview'
import { isHostDestination } from '@ramu/shared/hostOverview'
import {
  LINK_TARGET_KEY,
  PULL_REQUEST_LINKS_KEY,
  SERVICE_LINK_TARGET,
  isWebLink,
  linkTargetFrom,
  pullRequestLinkKey,
  pullRequestLinksFrom,
} from '@ramu/shared/browserLinks'
import { BrowserRuntime } from './browserRuntime'
import { BrowserDownloads } from './browserDownloads'
import { browserImportSources } from './browserImportSources'
import { BrowserProfiles } from './browserProfiles'
import { BrowserSignInWindows } from './browserSignIn'
import { browserProfileMethod } from './browserProfileMethods'
import { executeBrowserBridge } from './browserBridge'
import type { BrowserBridgeRequest } from '@ramu/shared/browserBridge'
import { randomUUID } from 'node:crypto'
import { ElectronGuestFactory } from './electronGuest'
import { browserMethod, isBrowserMethod } from './browserMethods'
import { LiveWindow, liveMethodAllowed, liveWindowFile } from './liveWindow'
import { ArtifactApps } from './artifactApps'
import { ArtifactWindows, artifactWindowMethodAllowed } from './artifactWindows'
import { artifactLink, parseArtifactLink } from '@ramu/shared/artifacts'
import {
  isHostInvokeAllowed,
  isSettingsActionAllowed,
  routeInvoke,
  routeTaskCommand,
  activityChannel,
} from './hostInvoke'
import { DeviceState } from './deviceState'
import { DesktopVoice } from './voice'
import { voiceErrorMessage } from '@ramu/shared/voice/bridge'
import { newerVersion } from '@ramu/shared/version'
import { DesktopUpdater } from './desktopUpdater'
import { whileStarting } from './startupWindow'
import { serviceIsIdle } from './serviceIdle'
import { ServiceRestart } from './serviceRestart'
import { installsAtLaunch, mayInstallUnattended } from './unattendedUpdate'
import { rememberBounds, savedBounds } from './windowBounds'
import { runtimeBuild } from '@ramu/server/build'
import { unloadLoginService } from './runtimeLauncher'
import type { AppUpdateStatus } from '@ramu/shared/updates'
import { configureDesktopLanguage, desktopLanguage, t } from './localization'
import { editorMenu, type EditorMenuOptions } from './editorMenu'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { type AppPreferences } from '@ramu/shared/types'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { FILE_LIST_TYPE, fileListEntry, pathsFromUriList } from './fileClipboard'
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
  ClipboardItem,
  safeStorage,
  systemPreferences,
  powerMonitor,
  nativeTheme,
  nativeImage,
  net,
  screen,
  type Session,
  type WebContents,
} from 'electron'
import { editMenuItems } from './editMenu'
import { AttachmentStore } from '@ramu/server/attachments'
import { attachmentActions } from './attachmentActions'
import { terminalMenu } from './terminalMenu'
import { createAgentNotifier } from './agentNotifier'
import { createPairingNotifier } from './pairingNotifier'
import { AccountHostConnector } from '@ramu/shared/accountHosts'
import { createPermissionNotifier } from './permissionNotifier'
import {
  runtimeInvoke,
  runtimeInvokeRecoverable,
  runtimePair,
  runtimeRenew,
  subscribeRuntime,
  refreshRuntimeNetwork,
  runtimeNetwork,
  PresenceListener,
  hostSocket,
} from '@ramu/client-runtime'
import { HOST_PUSH_CHANNELS, STREAMING_KINDS, pushMessage, type PushArgs } from '@ramu/shared/pushChannels'
import type { PushEvents } from '@ramu/shared/api'
import { SshComputers } from './sshComputers'
import { NearbyBrowser } from './discovery'
import { RemoteServers } from './remoteServers'
import type { DeviceOs } from '@ramu/shared/types'
import { ComputerBroadcaster } from './computerBroadcast'
import { ComputerRegistry, LOCAL } from './computers'
import { BrowserImporter, IMPORT_SOURCE_IDS, type ImportSourceId } from './browserImport'
import {
  ensureRuntime,
  waitForRuntimeExit,
  loginService,
  loginEnabled,
  loginPreferred,
  loginSupported,
  keepRunningPreferred,
  setKeepRunningPreferred,
} from './runtimeLauncher'
import { commandTarget, terminalCommand } from './terminalCommand'

protocol.registerSchemesAsPrivileged([
  { scheme: 'ramu-content', privileges: { standard: true, secure: true } },
  { scheme: 'ramu-theme', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
])

// Set the native runtime identity before creating menus, windows or notifications. A development run is "Ramu Dev",
// with its own data folder and its own "Ramu Dev Safe Storage" keychain item: macOS lets only the app that made a
// keychain item read it without asking, and a dev build is signed differently from the installed app, so sharing one
// asked for the keychain password on every launch, and a dev build could change real threads and settings.
const DEV_NAME = 'Ramu Dev'
app.setName(app.isPackaged ? 'Ramu' : DEV_NAME)
// Websites read navigator.webdriver as a bot signal; the integrated browser is driven by a person or a supervised agent.
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled')
if (process.platform === 'win32') app.setAppUserModelId('app.ramu.desktop')
app.setAboutPanelOptions({ applicationName: 'Ramu', applicationVersion: app.getVersion() })

// Lets tests and screenshots run against a throwaway profile.
if (process.env.RAMU_USER_DATA) app.setPath('userData', process.env.RAMU_USER_DATA)
else if (!app.isPackaged) app.setPath('userData', join(app.getPath('appData'), DEV_NAME))

// End-to-end runs stay out of the way: windows are created hidden and unfocused, and macOS shows no Dock icon.
// Hidden pages would otherwise be throttled, so throttling is off; tests emulate focus through Playwright.
/** One window shows only so many chats; anything longer is not this app asking. */

/**
 * Starts the app again. Under `pnpm dev` electron-vite ends with this process, which would leave a relaunched app on a
 * dev server that is gone, so it exits with the code scripts/dev.mjs restarts electron-vite on; cleanup still runs first.
 */
function relaunch() {
  const code = Number(process.env.RAMU_DEV_RELAUNCH)
  if (process.env.ELECTRON_RENDERER_URL && code) {
    app.once('will-quit', (event) => {
      event.preventDefault()
      app.exit(code)
    })
  } else app.relaunch()
  app.quit()
}

const MAX_FOLLOWED_THREADS = 64
const e2eHeadless = process.env.RAMU_E2E_HEADLESS === '1'
// The background service opened the app only to show a nearby device's pairing request; the window waits for a click.
const launchedForPairing = process.argv.includes('--pairing-request')
if (e2eHeadless) app.dock?.hide()

const CSP = [
  "default-src 'self'",
  // WebAssembly for the editor's TextMate grammars (Shiki's Oniguruma engine); no string-to-code evaluation.
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "media-src 'self' data:",
  'frame-src data: ramu-content: ramu-theme:',
  "img-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
].join('; ')

// `ramu://pair?...` and `ramu://plugin/install?...` links can arrive before the window exists, so they queue until it
// can show them.
const APP_LINK = /^ramu:\/\/(pair|plugin\/install)(?:[/?]|$)/i
const queuedPairLinks: string[] = []
let showPairLink: ((link: string) => void) | null = null
// `ramu://artifact/<host>/<id>` from an installed artifact's launcher opens that artifact in its own window.
const queuedArtifacts: { hostId: string; artifactId: string }[] = []
let openArtifactWindow: ((hostId: string, artifactId: string) => void) | null = null
let showMainWindow: (() => void) | null = null
const receivePairLink = (link: string) => {
  if (link.length > 4096) return
  const artifact = parseArtifactLink(link)
  if (artifact && !artifact.share) {
    if (openArtifactWindow) openArtifactWindow(artifact.computerId, artifact.artifactId)
    else queuedArtifacts.push({ hostId: artifact.computerId, artifactId: artifact.artifactId })
    return
  }
  if (!APP_LINK.test(link)) return
  if (showPairLink) showPairLink(link)
  else queuedPairLinks.push(link)
}
app.on('open-url', (event, url) => {
  event.preventDefault()
  receivePairLink(url)
})
// On Windows and Linux a launcher starts Ramu again with its link: the running Ramu takes the link and the new one
// quits. macOS hands links to the running app itself.
const secondCopy = app.isPackaged && process.platform !== 'darwin' && !app.requestSingleInstanceLock()
if (secondCopy) app.exit(0)
app.on('second-instance', (_event, argv) => {
  for (const arg of argv) receivePairLink(arg)
  if (argv.includes('--pairing-request') || !argv.some((arg) => arg.startsWith('ramu://'))) showMainWindow?.()
})
for (const arg of process.argv) receivePairLink(arg)
if (app.isPackaged) app.setAsDefaultProtocolClient('ramu')

async function main() {
  await app.whenReady()

  const userData = app.getPath('userData')
  const daemonPath = join(import.meta.dirname, 'daemon.js')
  const ramuCommand = terminalCommand({
    userData,
    target: commandTarget({
      executable: process.execPath,
      cli: join(import.meta.dirname, 'cli.js'),
      platform: process.platform,
      env: process.env,
      development: !app.isPackaged,
    }),
  })
  // After the app moved or a new copy was installed, the command follows it.
  try {
    ramuCommand.refresh()
  } catch {}
  // This computer's server always runs. Paired computers connect alongside it in the same shell.
  // Settings live in the service, so until it answers the window follows the system language.
  configureDesktopLanguage('system', app.getPreferredSystemLanguages())
  // Registered before any window exists: with no listener, Electron quits when the last window closes, and the small
  // "Starting Ramu" window closes before the main one is made. That quit cut the main page's load short
  // (ERR_FAILED loading index.html). The app quits with its windows only once the main window has existed.
  app.on('window-all-closed', () => {
    if (shellWindowMade) app.quit()
  })
  const runtime =
    e2eHeadless || launchedForPairing
      ? await ensureRuntime(userData, daemonPath)
      : await whileStarting(() => ensureRuntime(userData, daemonPath), {
          title: t('Starting Ramu…'),
          detail: t('The first start after installing or updating can take up to a minute.'),
        })
  const serviceIdle = () =>
    serviceIsIdle({
      counts: () => runtimeInvoke(runtime, 'agent.counts'),
      resources: () => runtimeInvoke(runtime, 'resources.snapshot'),
    })
  // Windows hear a restart the app asked for as one, not as the service going offline; the stream is wired below.
  let deliverLocalConnection: (payload: PushEvents['background:connection']) => void = () => {}
  const serviceRestart = new ServiceRestart((payload) => deliverLocalConnection(payload))
  /** Stops the service and starts it again from the daemon on disk, keeping login startup as it was. */
  const restartRuntime = async () => {
    const startup = loginEnabled(userData)
    serviceRestart.begin()
    try {
      // Unload the old supervisor so it cannot race the replacement back into existence.
      if (startup) {
        loginService(userData, daemonPath, false)
        unloadLoginService(userData)
      }
      await runtimeInvoke(runtime, 'background.restart').catch(() => {})
      await waitForRuntimeExit(runtime)
      await ensureRuntime(userData, daemonPath)
      if (startup) loginService(userData, daemonPath, true)
    } finally {
      serviceRestart.end()
    }
  }
  // Under `pnpm dev` the service outlives the app, and electron-vite rebuilds the daemon only when the app starts, so a
  // restart or a new `pnpm dev` would otherwise keep serving the previous build's code.
  if (process.env.ELECTRON_RENDERER_URL) {
    const status = await runtimeInvoke(runtime, 'background.status')
    if (status.build !== runtimeBuild(daemonPath)) {
      console.info('[ramu] background service is from an older build; restarting it')
      await restartRuntime()
    }
  }
  // An update installs the app but leaves the service running the release it started under. When nothing is running,
  // nothing is lost by replacing it, so the new app brings it up to date instead of leaving a second restart to do.
  // With work running it stays, and Settings offers the restart.
  if (app.isPackaged && !process.env.RAMU_USER_DATA && !e2eHeadless && !launchedForPairing) {
    const status = await runtimeInvoke(runtime, 'background.status').catch(() => null)
    if (status?.running && status.build !== runtimeBuild(daemonPath) && (await serviceIdle())) {
      console.info('[ramu] background service is from an older build and idle; restarting it')
      await whileStarting(restartRuntime, {
        title: t('Updating Ramu…'),
        detail: t('The background service is restarting with the new version.'),
      })
    }
  }
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
  const canStartAtLogin = loginSupported()
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
  // Starting at login is the person's choice (Background, or Stay reachable in Remote access); a login item they chose
  // that has gone missing, as after the app moved, is put back.
  if (
    app.isPackaged &&
    !process.env.RAMU_USER_DATA &&
    loginSupported() &&
    keepRunningPreferred(userData) &&
    loginPreferred(userData) === true &&
    !loginEnabled(userData)
  )
    await setLoginService(true)
  // With Keep running when Ramu closes off, quitting stops the service first, then quits. Quit waits for it, briefly:
  // a service that does not answer is left to stop on its own rather than holding the app open.
  let quitHeld = false,
    serviceStopped = false
  app.on('before-quit', (event) => {
    if (serviceStopped || keepRunningPreferred(userData)) return
    event.preventDefault()
    if (quitHeld) return
    quitHeld = true
    // The windows go at once, so quitting feels immediate and no window shows the service going away while it stops.
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.hide()
    app.dock?.hide()
    const stopService = runtimeInvoke(runtime, 'background.stop').then(() => waitForRuntimeExit(runtime, 8_000))
    void Promise.race([stopService, new Promise((resolve) => setTimeout(resolve, 10_000))])
      .catch(() => {})
      .finally(() => {
        serviceStopped = true
        quitHeld = false
        app.quit()
      })
  })

  let updateStatus: AppUpdateStatus | undefined
  // Windows learn of the native updater's progress once they exist; an update installed at launch has none to tell.
  let showUpdaterChange = () => {}
  const desktopUpdater = new DesktopUpdater(userData, () => showUpdaterChange())
  // A release the service downloaded while Ramu was closed installs now, before any window holds work, rather than
  // waiting until the person leaves the computer idle with the window open. Only the app restarts; threads keep running.
  if (
    app.isPackaged &&
    !process.env.RAMU_USER_DATA &&
    !e2eHeadless &&
    !launchedForPairing &&
    desktopUpdater.supported
  ) {
    const staged = await Promise.all([
      runtimeInvoke(runtime, 'updates.status'),
      runtimeInvoke(runtime, 'settings.app.get'),
    ]).catch(() => null)
    if (staged && installsAtLaunch(staged[0], staged[1].appAutoUpdate, app.getVersion())) {
      const prepared = await whileStarting(
        () =>
          desktopUpdater.readyFor(staged[0], 90_000).then(
            () => true,
            () => false,
          ),
        { title: t('Updating Ramu…'), detail: t('Installing the update downloaded while Ramu was closed.') },
      )
      // A build that fails to prepare starts as it is; the update stays offered in the status bar and Settings.
      if (prepared) {
        desktopUpdater.install()
        return
      }
    }
  }

  // Dictation: main owns the microphone permission, the single recording lease and the local recognizer.
  const voice = new DesktopVoice({
    dir: join(userData, 'voice'),
    microphone: {
      status: () => (process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('microphone') : 'unknown'),
      ask: () =>
        process.platform === 'darwin' ? systemPreferences.askForMediaAccess('microphone') : Promise.resolve(false),
    },
  })
  voice.cleanupOrphans()

  // Every window, including each paired computer's own partition, gets the same policy.
  const secure = (ses: Session) => {
    if (!process.env.ELECTRON_RENDERER_URL) {
      ses.webRequest.onHeadersReceived((details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [
              details.url.startsWith('ramu-content:')
                ? `${INTERACTIVE_CSP}; sandbox allow-scripts`
                : details.url.startsWith('ramu-theme:')
                  ? THEME_PREVIEW_CSP
                  : CSP,
            ],
          },
        })
      })
    }
    // Only the shell page that holds the recording lease may capture audio, and never video or from a guest page.
    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      const media = details as { mediaTypes?: string[]; isMainFrame?: boolean }
      // Presenting a deck on another display needs to know the displays; only the app's own page may ask.
      if (permission === 'window-management')
        return callback(
          !!wc && wc.getType() === 'window' && (details as { isMainFrame?: boolean }).isMainFrame !== false,
        )
      callback(
        permission === 'media' &&
          !!wc &&
          wc.getType() === 'window' &&
          voice.holds(wc.id) &&
          media.isMainFrame !== false &&
          !!media.mediaTypes?.length &&
          media.mediaTypes.every((type) => type === 'audio'),
      )
    })
  }
  const contentDocuments = new ContentDocuments()
  session.defaultSession.protocol.handle('ramu-content', (request) => contentDocuments.response(request.url))
  session.defaultSession.protocol.handle('ramu-theme', (request) =>
    themePreviewResponse(request.url, {
      rendererRoot: join(import.meta.dirname, '../renderer'),
      sourceRoot: join(import.meta.dirname, '../../../..'),
      devUrl: process.env.ELECTRON_RENDERER_URL,
      fetch: (url) => net.fetch(url, { redirect: 'error' }),
    }),
  )
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
    sendTo(LOCAL, /^ramu:\/\/plugin\//i.test(link) ? 'plugin:link' : 'pair:link', { link })
  }
  // The window may still be loading; the renderer keeps the link until the screen asks for it.
  for (const link of queuedPairLinks.splice(0)) setTimeout(() => showPairLink?.(link), 1500)
  showMainWindow = () => {
    if (win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  // Packaged macOS builds take the icon from the bundle; development, Linux and Windows read it from assets/.
  // Packaged builds copy assets/ beside the app; in the monorepo it sits at the repository root.
  const icon =
    [join(import.meta.dirname, '../../assets/icon.png'), join(import.meta.dirname, '../../../../assets/icon.png')].find(
      (path) => existsSync(path),
    ) ?? ''
  // macOS takes the dock icon from the bundle, packaged or patched for development (scripts/dev-icon.mjs), so the glass icon is not replaced by a flat PNG.

  const windowFile = join(userData, 'main-window.json')
  const lastBounds = e2eHeadless ? null : savedBounds(windowFile)
  shellWindowMade = true
  const win = new BrowserWindow({
    ...(icon ? { icon } : {}),
    width: 1440,
    height: 900,
    ...(lastBounds && { x: lastBounds.x, y: lastBounds.y, width: lastBounds.width, height: lastBounds.height }),
    minWidth: 900,
    minHeight: 560,
    title: 'Ramu',
    // Opened by an installed artifact's launcher, only that artifact's window shows; the Dock or Ramu brings this one.
    show: !e2eHeadless && !launchedForPairing && queuedArtifacts.length === 0,
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
  if (!e2eHeadless) {
    // Showing a window only for a pairing request should not also pop it to full size.
    if (lastBounds?.maximized && !launchedForPairing) win.maximize()
    rememberBounds(win, windowFile)
  }

  // Each artifact installed as an app opens in a window of its own, loading the same page with only that artifact.
  const loadRenderer = (window: BrowserWindow, query: Record<string, string>) =>
    process.env.ELECTRON_RENDERER_URL
      ? window.loadURL(`${process.env.ELECTRON_RENDERER_URL}?${new URLSearchParams(query)}`)
      : window.loadFile(join(import.meta.dirname, '../renderer/index.html'), { query })
  // On Windows a Squirrel install starts through Update.exe, which follows the app across updates; a launcher that
  // named the versioned Ramu.exe would break after the next one.
  const squirrelUpdate = join(dirname(process.execPath), '..', 'Update.exe')
  const launchCommand =
    process.platform === 'win32' && app.isPackaged && existsSync(squirrelUpdate)
      ? { executable: squirrelUpdate, args: ['--processStart', basename(process.execPath), '--process-start-args'] }
      : { executable: process.env.APPIMAGE || process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] }
  const artifactApps = new ArtifactApps({
    platform: process.platform,
    home: homedir(),
    userData,
    dataHome:
      process.platform === 'win32'
        ? app.getPath('appData')
        : process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'),
    command: launchCommand,
    writeShortcut: (path, options) => {
      if (!shell.writeShortcutLink(path, 'replace', { ...options, iconIndex: 0, description: 'Ramu artifact' }))
        throw new Error(t('Could not add the app to the Start menu.'))
    },
  })
  const artifactWindows = new ArtifactWindows({
    userData,
    preload: join(import.meta.dirname, '../preload/index.cjs'),
    backgroundColor: () => (nativeTheme.shouldUseDarkColors ? '#131315' : '#ececef'),
    load: async (window, query) => {
      // This window has the system's own title bar, so the page keeps no room for the macOS window buttons.
      window.webContents.on('dom-ready', () => window.webContents.send('ramu:window-chrome', { controlsInset: 0 }))
      window.webContents.on('context-menu', (_event, params) => {
        const items = editMenuItems(params)
        if (items.length) Menu.buildFromTemplate(items).popup({ window })
      })
      window.on('closed', () => {
        // Opened only for this artifact, Ramu goes away with its last artifact window, as an app would.
        if (!win.isDestroyed() && !win.isVisible() && artifactWindows.all().length === 0) app.quit()
      })
      await loadRenderer(window, query)
    },
    icon: (hostId, artifactId) => {
      const installed = artifactApps.list().find((app) => app.hostId === hostId && app.artifactId === artifactId)
      return installed
        ? {
            png: artifactApps.iconFile(hostId, artifactId, 'png'),
            ico: artifactApps.iconFile(hostId, artifactId, 'ico'),
            title: installed.title,
          }
        : null
    },
    relaunch: (hostId, artifactId) => ({
      executable: launchCommand.executable,
      args: [...launchCommand.args, artifactLink({ computerId: hostId, artifactId })]
        .map((arg) => `"${arg}"`)
        .join(' '),
    }),
  })
  // Closing Ramu's main window quits it, so its artifact windows close with it.
  win.on('closed', () => {
    for (const window of artifactWindows.all()) window.close()
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
      if (isWebLink(params.linkURL))
        items.unshift(
          // Whichever the click does, the other way to open a pull request is one right-click away.
          ...(pullRequestLinkKey(params.linkURL)
            ? [
                {
                  label: t('Open pull request in Ramu'),
                  click: () => {
                    if (!win.isDestroyed()) win.webContents.send('pull-request:open-link', { url: params.linkURL })
                  },
                },
              ]
            : []),
          {
            label: t('Open in system browser'),
            click: () => {
              void shell.openExternal(params.linkURL)
            },
          },
          {
            label: t('Open in Ramu browser'),
            click: () => {
              if (!win.isDestroyed()) win.webContents.send('browser:open-link', { url: params.linkURL })
            },
          },
          ...(items.length ? [{ type: 'separator' as const }] : []),
        )
      if (items.length)
        Menu.buildFromTemplate(items).popup({ window: win, ...(params.frame ? { frame: params.frame } : {}) })
    })
    contents.on('dom-ready', () => {
      sendChrome(contents)
    })
    // No in-app navigation or new windows; external links open in the browser.
    contents.on('will-frame-navigate', (event) => {
      // Generated documents cannot navigate, including redirects, meta refresh and script-driven navigation.
      const themePreview =
        isThemePreviewDocument(event.url) &&
        event.frame?.parent === contents.mainFrame &&
        (!event.initiator || event.initiator === contents.mainFrame)
      if (!event.isMainFrame && !contentDocuments.has(event.url) && !themePreview) event.preventDefault()
    })
    contents.on('will-navigate', (e, url) => {
      if (url !== contents.getURL()) e.preventDefault()
    })
    contents.setWindowOpenHandler(({ url, frameName, disposition }) => {
      // A deck's presenter notes: a blank window the app fills itself, on the display the full-screen deck is not on.
      if (url === 'about:blank' && frameName === 'ramu-presenter' && contents === win.webContents) {
        const deck = screen.getDisplayMatching(win.getBounds()).id
        const area = (screen.getAllDisplays().find((display) => display.id !== deck) ?? screen.getPrimaryDisplay())
          .workArea
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            x: area.x + 40,
            y: area.y + 40,
            width: Math.min(960, area.width - 80),
            height: Math.min(680, area.height - 80),
            title: t('Presenter notes'),
            autoHideMenuBar: true,
            webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
          },
        }
      }
      if (!isWebLink(url)) return { action: 'deny' }
      // Cmd-click (Ctrl-click elsewhere) asks for a background tab: it always opens in the person's own browser,
      // whatever clicked links do by default, as a quick way past Ramu's own views. A plain click on a link reports a
      // foreground tab, so only the background one is the modifier.
      if (disposition === 'background-tab') {
        void shell.openExternal(url)
        return { action: 'deny' }
      }
      // A pull request opens in Ramu's own view when the person keeps that choice; the window falls back to an
      // ordinary link when Ramu does not list it.
      if (
        frameName !== SERVICE_LINK_TARGET &&
        pullRequestLinkKey(url) &&
        pullRequestLinksFrom(deviceState.snapshot()[PULL_REQUEST_LINKS_KEY]) === 'app' &&
        !win.isDestroyed()
      ) {
        win.webContents.send('pull-request:open-link', { url })
        return { action: 'deny' }
      }
      // The person chooses, per device, whether clicked links use their own browser or the integrated one.
      if (linkTargetFrom(deviceState.snapshot()[LINK_TARGET_KEY]) === 'integrated' && !win.isDestroyed())
        win.webContents.send('browser:open-link', { url })
      else void shell.openExternal(url)
      return { action: 'deny' }
    })
  }
  // The presenter notes window shows only what the app writes into it: no navigation, no further windows.
  win.webContents.on('did-create-window', (child) => {
    child.webContents.on('will-navigate', (event) => event.preventDefault())
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })
  win.webContents.on('render-process-gone', () => contentDocuments.clear())
  win.webContents.on('did-navigate', () => contentDocuments.clear())
  wire(win.webContents)

  showUpdaterChange = () => {
    if (updateStatus) sendAll('updates:changed', updateView(updateStatus))
  }
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
    // An artifact's own window follows the same hosts, and keeps only the events its artifact view listens to.
    for (const window of artifactWindows.all()) window.webContents.send(channel, payload, id)
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
  const observeHostActivity = (id: string, ...[channel, payload]: PushArgs) => {
    if (
      !['workspace:changed', 'automation:changed', 'summaries:changed', 'background:connection'].includes(channel) &&
      !(channel === 'agent:event' && payload.event.kind === 'state')
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
  const pairing = createPairingNotifier({ window: win, launchedForRequest: launchedForPairing, quit: () => app.quit() })
  const permissions = createPermissionNotifier({ window: win, reveal: () => pairing.reveal() })
  // macOS also activates an app as it launches; only a later activation (Dock, Finder) is the person opening it.
  const pairingLaunchAt = Date.now()
  app.on('activate', () => {
    if (Date.now() - pairingLaunchAt > 3000) pairing.reveal()
  })
  // Requests raised before this app connected arrive with this read, not as an event.
  if (launchedForPairing)
    void runtimeInvoke(runtime, 'network.status').then(
      (status) => pairing.receive(status.requests ?? []),
      () => app.quit(),
    )
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
  // Browsing is started and stopped by the Connect-to-a-host panel; nothing listens otherwise.
  const nearby = new NearbyBrowser({ verifiedHost: (hostId) => computers.byHostId(hostId) })
  /** The one request to a nearby host this computer is waiting on, if any. */
  let pairRequest: AbortController | null = null
  // This computer's own OS, from its own service, for the hosts it connects to as a device.
  let thisDevice: DeviceOs | undefined
  void runtimeInvoke(runtime, 'background.status')
    .then((status) => (thisDevice = status.os))
    .catch(() => {})
  const computers = new ComputerRegistry({
    thisDevice: () => thisDevice,
    servers,
    ssh,
    deviceName: hostname(),
    localName: () => t('This host'),
    local: runtime,
    follow: (target, sessionIds) =>
      hostSocket(target).subscribe(
        [...HOST_PUSH_CHANNELS],
        { 'agent:event': sessionIds },
        { 'agent:event': [...STREAMING_KINDS] },
        true,
      ),
    subscribe: (target, receive, options) =>
      subscribeRuntime(
        target,
        // A host's event reaches windows and notifiers only on a channel this app knows, in the shape it carries.
        (channel, payload) => {
          const message = pushMessage(channel, payload)
          if (message) receive(...([message.channel, message.payload] as PushArgs))
        },
        runtimeNetwork,
        {
          ...options,
          presencePort: presence.port,
          ...(target.kind === 'http' ? { watchWake: (wake: () => void) => presence.watch(target.token, wake) } : {}),
        },
      ),
    invoke: runtimeInvoke,
    pair: runtimePair,
    renew: (url, token) => runtimeRenew(url, token),
    deliver: (id, ...[channel, payload]) => {
      if (id === LOCAL && channel === 'pairing:requests') pairing.receive(payload.requests)
      if (id === LOCAL && channel === 'pairing:joined') pairing.joined(payload)
      if (id === LOCAL && channel === 'account:changed') void accountHosts.connect()
      if (id === LOCAL && channel === 'permission:requests') permissions.receive(payload.requests)
      observeHostActivity(id, ...([channel, payload] as PushArgs))
      sendTo(id, channel, payload)
      notifierFor(id).observe(channel, payload)
    },
    changed: announce,
  })
  // Hosts listed in this computer's Ramu account that let the account's devices in are added on their own, after
  // sign-in and every few minutes; a host that asks first waits for Add this host.
  const addedFile = join(userData, 'account-hosts-added.json')
  const added = new Set<string>(
    (() => {
      try {
        const saved: unknown = JSON.parse(readFileSync(addedFile, 'utf8'))
        return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []
      } catch {
        return []
      }
    })(),
  )
  const accountHosts = new AccountHostConnector({
    hosts: () => runtimeInvoke(runtime, 'account.hosts'),
    added: {
      has: (id) => added.has(id),
      add: (id) => {
        added.add(id)
        writeFileSync(addedFile, JSON.stringify([...added]))
      },
    },
    saved: (hostKey) => computers.byHostId(hostKey) !== null,
    pair: async (host) => {
      await computers.pairThroughAccount(host.id, host.name, () => {}, AbortSignal.timeout(60_000))
      announce()
    },
  })
  void accountHosts.connect()
  setInterval(() => void accountHosts.connect(), 5 * 60_000).unref()
  const overviewReads = new HostOverviewQueue(async (id) => {
    if (!computers.exists(id) || computers.status(id) !== 'connected') throw new Error('That host is not connected')
    const endpoint = computers.endpoint(id)
    return readHostOverview((operation) => runtimeInvoke(endpoint, operation, [], { timeoutMs: 10000 }))
  })
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
  // The integrated browser's tabs live in this shell; every call names the host and thread it is for.
  const browserProfiles = new BrowserProfiles(join(userData, 'browser-profiles.json'))
  const browserGuests = new ElectronGuestFactory(() => (win.isDestroyed() ? null : win))
  const browser = new BrowserRuntime(
    browserGuests,
    () => browserProfiles.ids(),
    () => {
      if (!win.isDestroyed()) win.webContents.send('browser:changed', {})
    },
    (id) => !browserProfiles.isBusy(id),
    new BrowserDownloads(join(userData, 'browser-downloads'), () => {
      if (!win.isDestroyed()) win.webContents.send('browser:changed', {})
    }),
  )
  browser.startIdleSweep()
  const browserRuntimes = new Set([browser])
  const guestPartition = (id: string) => session.fromPartition(`persist:ramu-browser:${id}`)
  // Copies website sign-ins once, from another browser into a new hidden profile the person then keeps or discards.
  const browserImporter = new BrowserImporter({
    profiles: browserProfiles,
    home: homedir(),
    setCookie: (id, cookie) => guestPartition(id).cookies.set(cookie),
    flush: (id) => guestPartition(id).cookies.flushStore(),
    clearData: (id) => browserGuests.clearProfile(id),
  })
  void browserImporter.cleanup()
  const browserSignIn = new BrowserSignInWindows(browserProfiles, browserRuntimes, () => {
    if (!win.isDestroyed()) win.webContents.send('browser:changed', {})
  })
  win.on('closed', () => {
    browserSignIn.closeAll()
    browser.closeAll()
  })
  const browserClientId = randomUUID()
  let browserToken: string | null = null
  let browserConnection = 0
  /** The local service asks this desktop to drive its own browser for an agent. */
  const onBrowserOperation = (payload: BrowserBridgeRequest) => {
    const token = browserToken
    if (!token || payload.clientId !== browserClientId) return
    void executeBrowserBridge(browser, LOCAL, payload, () => browserProfiles.catalog())
      .then(
        (result) => {
          if (!win.isDestroyed() && result && typeof result === 'object') {
            if (payload.command.kind === 'present' && 'id' in result) win.webContents.send('browser:present', result)
            else if (
              payload.command.kind === 'open' &&
              payload.command.presentation === 'foreground' &&
              'tab' in result
            )
              win.webContents.send('browser:present', result.tab)
          }
          return runtimeInvoke(runtime, 'browser.bridge.reply', [browserClientId, token, payload.requestId, result])
        },
        (error) =>
          runtimeInvoke(runtime, 'browser.bridge.reply', [
            browserClientId,
            token,
            payload.requestId,
            null,
            error instanceof Error ? error.message : 'Browser operation failed',
          ]),
      )
      .catch(() => {})
  }
  /** The local service asks for a native dialog or action that only this desktop can show. */
  const onHostRequest = (payload: { requestId: string; method: string; path?: string }) => {
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
        } else if (payload.method === 'reveal' && payload.path) shell.showItemInFolder(payload.path)
        else if (payload.method === 'installUpdate') {
          // Asked from another of the person's devices: install only a signed build that is fully prepared.
          await desktopUpdater.readyFor(await runtimeInvoke(runtime, 'updates.status'))
          await runtimeInvoke(runtime, 'host.reply', [payload.requestId, null])
          setTimeout(() => desktopUpdater.install(), 500)
          return
        } else throw new Error('Unknown desktop action')
        await runtimeInvoke(runtime, 'host.reply', [payload.requestId, value])
      } catch (error) {
        await runtimeInvoke(runtime, 'host.reply', [payload.requestId, null, String(error)]).catch(() => {})
      }
    })()
  }
  /** Every event this app knows, typed by its channel. */
  const onLocalEvent = (...[channel, payload]: PushArgs) => {
    if (channel === 'background:connection') {
      const epoch = ++browserConnection
      browserToken = null
      if (!payload.connected) browser.pauseForDisconnect()
      else {
        // The service may have outlived an app update: tell it which release is installed here, and whether this app
        // installs updates itself, so it offers and downloads only what this app can use.
        void runtimeInvoke(runtime, 'updates.installedApp', [
          { version: app.getVersion(), canInstall: desktopUpdater.supported },
        ]).catch(() => {})
        void (async () => {
          // The connection can race the event stream registering, so a failed attach is retried briefly.
          for (let attempt = 0; attempt < 5; attempt++) {
            if (browserConnection !== epoch) return
            try {
              // A desktop-only method outside the shared table: the local service answers with this desktop's token.
              const result = (await runtimeInvoke(runtime, 'browser.bridge.attach', [browserClientId])) as {
                token: string
              }
              if (browserConnection !== epoch) return
              browserToken = result.token
              await runtimeInvoke(runtime, 'browser.bridge.ready', [browserClientId, result.token])
              if (!win.isDestroyed()) win.webContents.send('browser:changed', {})
              return
            } catch {
              await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt))
            }
          }
          if (browserConnection === epoch) {
            browserToken = null
            if (!win.isDestroyed()) win.webContents.send('browser:changed', {})
          }
        })()
      }
    }
    observeHostActivity(LOCAL, ...([channel, payload] as PushArgs))
    if (channel === 'background:connection') computers.setLocalStatus(payload.connected, payload.restarting)
    computers.observe(LOCAL, ...([channel, payload] as PushArgs))
    if (channel === 'updates:changed') {
      updateStatus = payload
      void desktopUpdater.prepare(payload)
      sendAll(channel, updateView(payload))
      return
    }
    {
      send(channel, payload)
      notifierFor(LOCAL).observe(channel, payload)
    }
  }
  deliverLocalConnection = (payload) => onLocalEvent('background:connection', payload)
  const unsubscribe = subscribeRuntime(
    runtime,
    // Two channels are private to this desktop and its local service; anything else must be a known push event.
    (channel, raw) => {
      if (channel === 'browser:operation') return onBrowserOperation(raw as BrowserBridgeRequest)
      if (channel === 'host:request') return onHostRequest(raw as { requestId: string; method: string; path?: string })
      const message = pushMessage(channel, raw)
      if (message?.channel === 'background:connection') serviceRestart.observe(message.payload)
      else if (message) onLocalEvent(...([message.channel, message.payload] as PushArgs))
    },
    runtimeNetwork,
    { localClientId: browserClientId },
  )
  const attachment = attachmentActions(win, new AttachmentStore(join(userData, 'attachments')))
  const liveWindow = new LiveWindow({
    file: liveWindowFile(userData),
    preload: join(import.meta.dirname, '../preload/index.cjs'),
    load: (window) =>
      process.env.ELECTRON_RENDERER_URL
        ? window.loadURL(`${process.env.ELECTRON_RENDERER_URL}?live=1`)
        : window.loadFile(join(import.meta.dirname, '../renderer/index.html'), { query: { live: '1' } }),
    closed: () => sendTo(LOCAL, 'live:closed', {}),
  })
  const routing = (self: string) => ({
    self,
    exists: (id: string) => computers.exists(id),
    status: (id: string) => computers.status(id),
    text: (message: string) => t(message),
  })
  /** Runs a call on another host's server and nudges overviews when it changed threads or projects. */
  const runOnHost = async (id: string, method: string, args: unknown[]) => {
    const result = await runtimeInvokeRecoverable(computers.endpoint(id), method, args)
    const channel = activityChannel(method)
    if (channel) observeHostActivity(id, channel, {})
    return result
  }
  const artifactTarget = (hostId: unknown, artifactId: unknown) => {
    if (
      typeof hostId !== 'string' ||
      typeof artifactId !== 'string' ||
      !parseArtifactLink(artifactLink({ computerId: hostId, artifactId }))
    )
      throw new Error('Invalid artifact')
    return { hostId, artifactId }
  }
  /** Installs an artifact as an app, removes it, or opens its own window. */
  const artifactAppMethod = (method: string, args: unknown[]) => {
    if (method === 'artifactApps.list') return artifactApps.list()
    if (method === 'artifactApps.install') {
      const [input, iconPng] = args
      const prefix = 'data:image/png;base64,'
      if (typeof iconPng !== 'string' || !iconPng.startsWith(prefix) || iconPng.length > 2_000_000)
        throw new Error('Invalid icon')
      const icon = nativeImage.createFromBuffer(Buffer.from(iconPng.slice(prefix.length), 'base64'))
      if (icon.isEmpty()) throw new Error('Invalid icon')
      const installed = artifactApps.install(input, (size) =>
        icon.resize({ width: size, height: size, quality: 'best' }).toPNG(),
      )
      for (const window of artifactWindows.all()) window.webContents.send('artifact-apps:changed', {})
      if (!win.isDestroyed()) win.webContents.send('artifact-apps:changed', {})
      return void installed
    }
    if (method === 'artifactApps.remove') {
      const { hostId, artifactId } = artifactTarget(args[0], args[1])
      artifactApps.remove(hostId, artifactId)
      for (const window of artifactWindows.all()) window.webContents.send('artifact-apps:changed', {})
      if (!win.isDestroyed()) win.webContents.send('artifact-apps:changed', {})
      return
    }
    if (method === 'artifactApps.open') {
      const { hostId, artifactId } = artifactTarget(args[0], args[1])
      return artifactWindows.open(hostId, artifactId)
    }
    throw new Error('Invalid request')
  }
  ipcMain.handle('ramu:invoke', async (event, requestMethod: unknown, requestArgs: unknown, requestHost?: unknown) => {
    // Only our windows may invoke IPC. Normal calls reach their owning computer; explicit computer management validates its target below.
    // The live view window is trusted only for watching and stopping.
    const fromLive = liveWindow.owns(event.sender)
    const fromArtifact = artifactWindows.owns(event.sender)
    const self = event.sender === win.webContents || fromLive || fromArtifact ? LOCAL : undefined
    if (!self || event.senderFrame !== event.sender.mainFrame) throw new Error('Untrusted IPC sender')
    if (typeof requestMethod !== 'string' || !Array.isArray(requestArgs)) throw new Error('Invalid request')
    if (fromLive && !liveMethodAllowed(requestMethod)) throw new Error('That is not available in the live view.')
    // The main window's own state (threads it streams, its host filter) stays its own; the artifact window's store
    // asks for them too and is answered without changing them.
    if (fromArtifact && !artifactWindowMethodAllowed(requestMethod))
      return requestMethod === 'computers.scope' ? computers.list(self) : undefined
    if (requestMethod.startsWith('artifactApps.')) return artifactAppMethod(requestMethod, requestArgs)
    if (requestMethod === 'live.window') {
      if (fromLive) throw new Error('That is not available in the live view.')
      if (requestArgs[0] === true) liveWindow.open(requestArgs[1] === true)
      else liveWindow.close()
      return
    }
    if (requestMethod === 'live.close') return liveWindow.close()
    if (requestMethod === 'live.open') {
      const [hostId, taskId] = requestArgs
      if (typeof hostId !== 'string' || typeof taskId !== 'string') throw new Error('Invalid thread')
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      sendTo(LOCAL, 'live:open', { hostId, taskId })
      return
    }
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
      if (!isSettingsActionAllowed(operation) || !Array.isArray(parameters)) throw new Error('Invalid settings action')
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
    if (isBrowserMethod(method)) {
      if (method === 'browser.runtimeStatus')
        return args[0] === LOCAL && browserToken
          ? { available: true, warning: browser.warning() }
          : {
              available: false,
              reason:
                args[0] !== LOCAL
                  ? 'The selected execution host has no authorized browser bridge to this desktop.'
                  : 'The desktop browser is not connected to the execution service.',
            }
      if (remote || args[0] !== LOCAL)
        throw new Error('The selected execution host has no authorized browser bridge to this desktop.')
      if (method === 'browser.saveDownload') {
        const [hostId, threadId, downloadId] = args
        if (typeof hostId !== 'string' || typeof threadId !== 'string' || typeof downloadId !== 'string')
          throw new Error('Invalid browser download')
        const download = browser.listDownloads({ hostId, threadId }).find((entry) => entry.id === downloadId)
        if (!download || download.state !== 'completed') throw new Error('That download is not ready or has expired.')
        // Website suggestions are filenames only. The native dialog grants the destination path.
        const result = await dialog.showSaveDialog(win, { defaultPath: download.name })
        if (!result.canceled && result.filePath) browser.saveDownload(downloadId, { hostId, threadId }, result.filePath)
        return { cancelled: result.canceled }
      }
      if (method === 'browser.profiles.importSources') return browserImportSources()
      if (method.startsWith('browser.import.')) {
        const source = (value: unknown): ImportSourceId => {
          if (!IMPORT_SOURCE_IDS.includes(value as ImportSourceId)) throw new Error('Choose a supported browser.')
          return value as ImportSourceId
        }
        const text = (value: unknown, max = 200) => {
          if (typeof value !== 'string' || !value || value.length > max) throw new Error('Invalid import request')
          return value
        }
        if (method === 'browser.import.profiles') return browserImporter.profiles(source(args[1]))
        if (method === 'browser.import.inspect') return browserImporter.inspect(source(args[1]), text(args[2]))
        if (method === 'browser.import.run') {
          const domains = args[2]
          if (
            !Array.isArray(domains) ||
            domains.length > 500 ||
            domains.some((entry) => typeof entry !== 'string' || entry.length > 253)
          )
            throw new Error('Invalid import request')
          const staged = await browserImporter.run(text(args[1]), domains as string[], text(args[3], 80))
          if (!win.isDestroyed()) win.webContents.send('browser:changed', {})
          return staged
        }
        if (method === 'browser.import.cancel') return browserImporter.cancel(text(args[1]))
        if (method === 'browser.import.keep') {
          const kept = browserImporter.keep(text(args[1]))
          if (!win.isDestroyed()) win.webContents.send('browser:changed', {})
          return kept
        }
        if (method === 'browser.import.discard') {
          await browserImporter.discard(text(args[1]))
          if (!win.isDestroyed()) win.webContents.send('browser:changed', {})
          return
        }
        throw new Error('Unknown browser import action')
      }
      if (method === 'browser.profiles.signIn') {
        if (typeof args[1] !== 'string' || typeof args[2] !== 'string' || args[2].length > 4000)
          throw new Error('Invalid browser sign-in request')
        return browserSignIn.open(args[1], args[2])
      }
      if (method.startsWith('browser.profiles.'))
        return browserProfileMethod(
          browserProfiles,
          browser,
          {
            clearData: (id) => browserGuests.clearProfile(id),
            runtimes: () => [...browserRuntimes],
            async resetDefault(id) {
              const snapshot = (await runtimeInvoke(
                runtime,
                'settings.app.snapshot',
              )) as import('@ramu/shared/settingsCompatibility').SettingsSnapshot
              const field = snapshot.settings.find((entry) => entry.path === 'agentBrowser.defaultProfileId')
              if (field?.value === id)
                await runtimeInvoke(runtime, 'settings.app.patch', [
                  [{ path: field.path, schema: field.schema, before: id, value: 'default' }],
                ])
            },
            async confirm({ name, deleteProfile, tabs }) {
              const result = await dialog.showMessageBox(win, {
                type: 'warning',
                message: t(deleteProfile ? 'Delete browser profile {0}?' : 'Clear website data for {0}?', { 0: name }),
                detail: t(
                  'Closes {0} tabs and signs out of websites in this profile. Deleting the selected profile switches back to Default. This cannot be undone.',
                  { 0: tabs },
                ),
                buttons: [t('Cancel'), t(deleteProfile ? 'Delete profile' : 'Clear website data')],
                defaultId: 0,
                cancelId: 0,
              })
              return result.response === 1
            },
            changed() {
              if (!win.isDestroyed()) win.webContents.send('browser:changed', {})
            },
          },
          method,
          args,
        )

      if (method === 'browser.giveControl') {
        // Resolve the run through the local execution service; never trust a renderer-supplied session id.
        browserMethod(browser, 'browser.list', args.slice(0, 2))
        if (args[0] !== LOCAL) throw new Error('This browser belongs to the local execution host.')
        const running = (await runtimeInvoke(runtime, 'agent.list', [
          args[1],
        ])) as import('@ramu/shared/types').AgentSessionInfo[]
        const run = running.find((session) => !session.parentId && ['starting', 'running'].includes(session.state))
        return browserMethod(browser, method, args, run?.id)
      }
      return browserMethod(browser, method, args)
    }
    if (method === 'app.openPrivacySettings') {
      // Only the listed Privacy & Security pages, and only from this computer: a phone cannot open this Mac's settings.
      if (remote || process.platform !== 'darwin' || typeof args[0] !== 'string' || !(args[0] in PRIVACY_PANES))
        throw new Error('These settings are only on this Mac.')
      return shell.openExternal(privacyPaneUrl(args[0] as PrivacyPane))
    }
    if (method === 'app.openExternal') {
      if (remote || typeof args[0] !== 'string' || !isWebLink(args[0])) throw new Error('Only web links can be opened.')
      return shell.openExternal(args[0])
    }
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
    if (method === 'clipboard.readFiles') {
      if (!(await clipboard.has(FILE_LIST_TYPE))) return []
      for (const item of await clipboard.read())
        if (item.types.includes(FILE_LIST_TYPE))
          return pathsFromUriList(await (await item.getType(FILE_LIST_TYPE)).text())
      return []
    }
    if (method === 'clipboard.writeFiles') {
      const paths = args[0]
      if (
        !Array.isArray(paths) ||
        !paths.length ||
        paths.length > 100 ||
        paths.some((path) => typeof path !== 'string' || !isAbsolute(path) || path.length > 4096)
      )
        throw new Error('Invalid clipboard files')
      return clipboard.write([new ClipboardItem(fileListEntry(paths as string[]))])
    }
    if (method === 'clipboard.write') {
      if (typeof args[0] !== 'string' || args[0].length > 5_000_000) throw new Error('Invalid clipboard text')
      if (args[1] !== undefined && (typeof args[1] !== 'string' || args[1].length > 10_000_000))
        throw new Error('Invalid clipboard HTML')
      // One write with both forms: rich targets read the HTML, everything else the text.
      if (!args[1]) return clipboard.writeText(args[0])
      return clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([args[0]], { type: 'text/plain' }),
          'text/html': new Blob([args[1]], { type: 'text/html' }),
        }),
      ])
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
        !Number.isFinite(point.y) ||
        (args[2] !== undefined && (typeof args[2] !== 'string' || args[2].length > 1_000_000))
      )
        throw new Error('Invalid terminal menu request')
      return terminalMenu(win, args[0], { x: point.x, y: point.y }, args[2] ?? '')
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
    if (method === 'computers.threads') {
      const [id, sessionIds] = args
      if (
        typeof id !== 'string' ||
        !computers.exists(id) ||
        !Array.isArray(sessionIds) ||
        sessionIds.length > MAX_FOLLOWED_THREADS ||
        !sessionIds.every((sessionId) => typeof sessionId === 'string' && sessionId.length <= 200)
      )
        throw new Error('Invalid request')
      return computers.follow(id, sessionIds as string[])
    }
    if (method === 'computers.overview') {
      const id = args[0]
      if (typeof id !== 'string' || !computers.exists(id) || computers.status(id) !== 'connected')
        throw new Error('That host is not connected')
      return overviewReads.read(id)
    }
    if (method === 'computers.appMemory') {
      return app.getAppMetrics().reduce((sum, metric) => sum + metric.memory.workingSetSize * 1024, 0)
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
      const [address, code, label, offered] = args
      if (
        typeof address !== 'string' ||
        typeof code !== 'string' ||
        (label !== undefined && typeof label !== 'string') ||
        !code.trim()
      )
        throw new Error('Enter the address and the pairing code')
      // Only https backups, as a pairing link keeps them: the code is sent to each one tried.
      const alternates = Array.isArray(offered)
        ? offered.filter((url): url is string => typeof url === 'string' && url.startsWith('https://')).slice(0, 3)
        : []
      const previous = servers.list()
      await computers.pair(address, code, label, alternates)
      for (const server of previous) if (!computers.exists(server.id)) await closeComputer(server.id)
      return computers.list(self)
    }
    // A nearby host is asked instead of typing its code; the number to match arrives as `computers:pairCode`.
    if (method === 'computers.pairByRequest') {
      const [address, label] = args
      if (typeof address !== 'string' || (label !== undefined && typeof label !== 'string'))
        throw new Error('Enter the address')
      pairRequest?.abort()
      const controller = new AbortController()
      pairRequest = controller
      const previous = servers.list()
      try {
        await computers.pairByRequest(
          address,
          label,
          (code) => send('computers:pairCode', { address, code }),
          controller.signal,
        )
      } finally {
        if (pairRequest === controller) pairRequest = null
      }
      for (const server of previous) if (!computers.exists(server.id)) await closeComputer(server.id)
      return computers.list(self)
    }
    // A host listed in the person's Ramu account, asked through the account instead of over the network.
    if (method === 'computers.pairThroughAccount') {
      const [listedId, label] = args
      if (typeof listedId !== 'string' || (label !== undefined && typeof label !== 'string'))
        throw new Error('Choose a host')
      pairRequest?.abort()
      const controller = new AbortController()
      pairRequest = controller
      const previous = servers.list()
      try {
        await computers.pairThroughAccount(
          listedId,
          label,
          (code) => send('computers:pairCode', { address: listedId, code }),
          controller.signal,
        )
      } finally {
        if (pairRequest === controller) pairRequest = null
      }
      for (const server of previous) if (!computers.exists(server.id)) await closeComputer(server.id)
      return computers.list(self)
    }
    // Device-local: the command goes on this computer's PATH, whichever host the window shows.
    if (method === 'terminalCommand.status') return ramuCommand.status()
    if (method === 'terminalCommand.install') return ramuCommand.install()
    if (method === 'terminalCommand.remove') return ramuCommand.remove()
    if (method === 'computers.cancelPairRequest') {
      pairRequest?.abort()
      pairRequest = null
      return null
    }
    // Device-local: this computer listens for nearby hosts and only lists them.
    if (method === 'computers.discovery.start') return nearby.start()
    if (method === 'computers.discovery.state') return nearby.state()
    if (method === 'computers.discovery.stop') return nearby.stop()
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
    if (method === 'computers.reviewAddress') {
      if (typeof args[0] !== 'string' || typeof args[1] !== 'string') throw new Error('Invalid host address')
      return computers.reviewAddress(args[0], args[1])
    }
    if (method === 'computers.update') {
      if (typeof args[0] !== 'string' || !args[1] || typeof args[1] !== 'object' || Array.isArray(args[1]))
        throw new Error('Invalid host settings')
      computers.update(args[0], args[1] as Parameters<typeof computers.update>[1])
      return computers.list(self)
    }
    if (
      remote &&
      [
        'background.start',
        'background.login',
        'background.restart',
        'background.keepRunning',
        'background.restartService',
      ].includes(method)
    )
      throw new Error(t('Not available while connected to another host'))
    if (method === 'background.start') {
      await ensureRuntime(userData, daemonPath)
      return
    }
    if (method === 'background.login') {
      if (typeof args[0] !== 'boolean') throw new Error('Invalid startup setting')
      // A login service would bring back a service the person asked to stop with the app.
      if (args[0] && !keepRunningPreferred(userData)) throw new Error(t('Turn on Keep running when Ramu closes first.'))
      return setLoginService(args[0])
    }
    if (method === 'background.keepRunning') {
      if (typeof args[0] !== 'boolean') throw new Error('Invalid background setting')
      setKeepRunningPreferred(userData, args[0])
      if (!args[0] && loginEnabled(userData)) await setLoginService(false)
      return
    }
    if (method === 'background.restartService') {
      const then = args[0] === 'reload' ? 'reload' : 'keep'
      // Asked only when the restart would stop something; an idle service just restarts.
      if (!(await serviceIdle())) {
        const choice = await dialog.showMessageBox(win, {
          type: 'question',
          message: t('Restart the background service?'),
          detail: t('Stops running agents. Unfinished threads resume if restart recovery is enabled.'),
          buttons: [t('Restart now'), t('Later')],
          defaultId: 1,
          cancelId: 1,
        })
        if (choice.response !== 0) return
      }
      await restartRuntime()
      // The window reconnects as soon as the new service answers; a reload also starts the page fresh.
      if (then === 'reload') win.webContents.reload()
      return
    }
    if (method === 'background.status') {
      const status = await runtimeInvoke(target, method)
      return {
        ...status,
        loginEnabled: !remote && loginEnabled(userData),
        loginSupported: !remote && canStartAtLogin,
        ...(remote ? {} : { keepRunning: keepRunningPreferred(userData) }),
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
      await restartRuntime()
      relaunch()
      return
    }
    if (method === 'app.relaunch') {
      if (remote) throw new Error(t('Not available while connected to another host'))
      relaunch()
      return
    }
    if (method === 'updates.restart') {
      // The window asks this while it holds nothing unsaved; the rest is checked here, and anything busy waits.
      if (args[0] === 'idle') {
        const install =
          !remote &&
          (await mayInstallUnattended({
            ready: desktopUpdater.ready,
            autoUpdate: async () => (await runtimeInvoke(runtime, 'settings.app.get')).appAutoUpdate,
            idleSeconds: () => powerMonitor.getSystemIdleTime(),
            serviceIdle,
          }))
        if (install) desktopUpdater.install()
        return
      }
      const idle = !remote && (await serviceIdle())
      const choice = await dialog.showMessageBox(win, {
        type: 'question',
        message: t('Restart Ramu to finish updating?'),
        detail: idle
          ? t('Nothing is running, so the background service updates too.')
          : t(
              'Running threads keep going. The background service keeps its current version until you restart it in Settings.',
            ),
        buttons: [t('Restart now'), t('Later')],
        defaultId: 1,
        cancelId: 1,
      })
      if (choice.response === 0) desktopUpdater.install()
      return
    }
    if (['updates.status', 'updates.check', 'updates.skipWait', 'updates.download'].includes(method)) {
      updateStatus = (await runtimeInvoke(runtime, method, args)) as AppUpdateStatus
      await desktopUpdater.prepare(updateStatus!)
      return updateView(updateStatus!)
    }
    return runtimeInvokeRecoverable(target, method, args)
  })

  // Dictation bridge. Only the shell window's own main frame; audio and the lease never reach a guest page or a host.
  const voiceSender = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender !== win.webContents || event.senderFrame !== event.sender.mainFrame)
      throw new Error('Untrusted IPC sender')
    return event.sender.id
  }
  const voiceText = (value: unknown, max = 40) => {
    if (typeof value !== 'string' || value.length > max) throw new Error(voiceErrorMessage('recognition'))
    return value
  }
  win.webContents.on('destroyed', () => voice.release(win.webContents.id))
  ipcMain.handle('ramu:voice:capability', (event, language: unknown) => {
    voiceSender(event)
    return voice.capability(voiceText(language))
  })
  ipcMain.handle('ramu:voice:begin', (event, language: unknown) => voice.begin(voiceSender(event), voiceText(language)))
  ipcMain.handle('ramu:voice:transcribe', (event, token: unknown, pcm: unknown, language: unknown) => {
    const owner = voiceSender(event)
    if (!(pcm instanceof ArrayBuffer) && !ArrayBuffer.isView(pcm)) throw new Error(voiceErrorMessage('empty'))
    const bytes =
      pcm instanceof ArrayBuffer ? new Uint8Array(pcm) : new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)
    return voice.transcribe(owner, voiceText(token, 80), bytes, voiceText(language))
  })
  ipcMain.handle('ramu:voice:cancel', (event, token: unknown) => voice.cancel(voiceSender(event), voiceText(token, 80)))
  ipcMain.handle('ramu:voice:settings', (event) => {
    voiceSender(event)
    // Microphone first; speech recognition lives on the same privacy page family.
    void shell.openExternal(privacyPaneUrl('microphone'))
  })

  // Device-wide UI state: read synchronously by each page at startup, written through and fanned out to the other windows.
  ipcMain.on('ramu:device-state', (event) => {
    // An artifact's window reads the same appearance and language; only the main window changes them.
    event.returnValue =
      event.sender === win.webContents || artifactWindows.owns(event.sender) ? deviceState.snapshot() : {}
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

  if (process.env.ELECTRON_RENDERER_URL) {
    // The dev server versions its pre-bundled packages (`?v=<hash>`) and answers a stale one with 504 "Outdated Optimize
    // Dep". Modules kept from earlier runs in this profile's HTTP cache hold old hashes, so start every dev run clean.
    await win.webContents.session.clearCache()
    await win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else await win.loadFile(join(import.meta.dirname, '../renderer/index.html'))

  openArtifactWindow = (hostId, artifactId) => artifactWindows.open(hostId, artifactId)
  for (const { hostId, artifactId } of queuedArtifacts.splice(0)) artifactWindows.open(hostId, artifactId)
  computers.start()
  const networkWake = () => refreshRuntimeNetwork(true)
  powerMonitor.on('resume', networkWake)
  app.on('before-quit', () => {
    // Quitting waits while the service stops first; cleanup runs on the quit that follows.
    if (quitHeld) return
    powerMonitor.removeListener('resume', networkWake)
    nearby.stop()
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
    ipcMain.removeAllListeners('ramu:device-state')
    ipcMain.removeAllListeners('ramu:device-state:set')
  })
}

let shellWindowMade = false

void main().catch((error: unknown) => {
  console.error('Ramu startup failed:', error)
  dialog.showErrorBox(t('Could not start Ramu'), error instanceof Error ? error.message : String(error))
  app.quit()
})
