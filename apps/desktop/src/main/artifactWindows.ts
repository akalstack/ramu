import { BrowserWindow, shell } from 'electron'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { rememberBounds, savedBounds } from './windowBounds'
import { isWebLink } from '@ramu/shared/browserLinks'
import { artifactAppId } from './artifactApps'

/**
 * What an artifact's own window may not call: the main window's per-window state (which threads it streams, where it
 * navigates, the live view). Everything else is the same artifact view the main window shows.
 */
const MAIN_WINDOW_METHODS = new Set([
  'computers.threads',
  'computers.navigate',
  'computers.navigation.ready',
  'computers.scope',
  'live.window',
])

export const artifactWindowMethodAllowed = (method: string) => !MAIN_WINDOW_METHODS.has(method)

/** The query an artifact window's page reads to show only that artifact. */
export const artifactWindowQuery = (hostId: string, artifactId: string) => ({ artifact: artifactId, host: hostId })

/** One window per artifact, opened from its installed app or its menu, remembering where the person put it. */
export class ArtifactWindows {
  private readonly windows = new Map<string, BrowserWindow>()

  constructor(
    private readonly options: {
      userData: string
      preload: string
      backgroundColor: () => string
      load: (window: BrowserWindow, query: Record<string, string>) => Promise<void>
      /** The installed app's icons, when it is one, so the window and the taskbar show its icon. */
      icon: (hostId: string, artifactId: string) => { png: string; ico: string; title: string } | null
      /** The command that reopens this artifact, for a taskbar pin on Windows. */
      relaunch: (hostId: string, artifactId: string) => { executable: string; args: string }
    },
  ) {}

  owns(contents: Electron.WebContents) {
    for (const window of this.windows.values())
      if (!window.isDestroyed() && window.webContents === contents) return true
    return false
  }

  all(): BrowserWindow[] {
    return [...this.windows.values()].filter((window) => !window.isDestroyed())
  }

  open(hostId: string, artifactId: string) {
    const id = artifactAppId(hostId, artifactId)
    const existing = this.windows.get(id)
    if (existing && !existing.isDestroyed()) {
      if (existing.isMinimized()) existing.restore()
      existing.show()
      existing.focus()
      return
    }
    const folder = join(this.options.userData, 'artifact-windows')
    mkdirSync(folder, { recursive: true })
    const file = join(folder, `${id}.json`)
    const saved = savedBounds(file)
    const installed = this.options.icon(hostId, artifactId)
    const icon = installed && existsSync(installed.png) ? installed.png : undefined
    const window = new BrowserWindow({
      width: saved?.width ?? 1100,
      height: saved?.height ?? 780,
      ...(saved && { x: saved.x, y: saved.y }),
      minWidth: 420,
      minHeight: 320,
      title: installed?.title ?? 'Ramu',
      ...(icon ? { icon } : {}),
      backgroundColor: this.options.backgroundColor(),
      webPreferences: {
        preload: this.options.preload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    })
    if (saved?.maximized) window.maximize()
    // On Windows the window groups under the installed app's taskbar button and icon, not Ramu's.
    if (process.platform === 'win32' && installed && existsSync(installed.ico)) {
      const relaunch = this.options.relaunch(hostId, artifactId)
      window.setAppDetails({
        appId: `run.ramu.app.${id}`,
        appIconPath: installed.ico,
        relaunchCommand: `"${relaunch.executable}" ${relaunch.args}`,
        relaunchDisplayName: installed.title,
      })
    }
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (isWebLink(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    rememberBounds(window, file)
    window.on('closed', () => {
      if (this.windows.get(id) === window) this.windows.delete(id)
    })
    this.windows.set(id, window)
    void this.options.load(window, artifactWindowQuery(hostId, artifactId))
  }

  close(hostId: string, artifactId: string) {
    const window = this.windows.get(artifactAppId(hostId, artifactId))
    if (window && !window.isDestroyed()) window.close()
  }
}
