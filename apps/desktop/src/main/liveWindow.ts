import { BrowserWindow, screen } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * What the live view window may call. It only watches and stops: thread and host state, frames, and Stop. Anything
 * else, including control, settings and files, stays with the main window.
 */
const LIVE_METHODS = new Set([
  'computers.list',
  'computers.overview',
  'background.status',
  'agent.list',
  'agent.stop',
  'computer.session',
  'computer.frame',
  'computer.stop',
  'hostBrowser.list',
  'hostBrowser.frame',
  'browser.list',
  'browser.preview',
  'live.open',
  'live.close',
])

export const liveMethodAllowed = (method: string) => LIVE_METHODS.has(method)

type Bounds = { x: number; y: number; width: number; height: number }

/** A small window that stays above other apps and remembers where the person put it on this device. */
export class LiveWindow {
  private window: BrowserWindow | null = null

  constructor(
    private readonly options: {
      file: string
      preload: string
      load: (window: BrowserWindow) => Promise<void>
      closed: () => void
    },
  ) {}

  owns(contents: Electron.WebContents) {
    return !!this.window && !this.window.isDestroyed() && this.window.webContents === contents
  }

  private saved(): Bounds | null {
    try {
      if (!existsSync(this.options.file)) return null
      const bounds = JSON.parse(readFileSync(this.options.file, 'utf8')) as Bounds
      // A display that is gone would leave the window off screen.
      const visible = screen
        .getAllDisplays()
        .some(
          ({ workArea: area }) =>
            bounds.x >= area.x - 40 &&
            bounds.y >= area.y - 40 &&
            bounds.x < area.x + area.width &&
            bounds.y < area.y + area.height,
        )
      return visible ? bounds : null
    } catch {
      return null
    }
  }

  open(hideFromSharing: boolean) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.setContentProtection(hideFromSharing)
      this.window.showInactive()
      return
    }
    const area = screen.getPrimaryDisplay().workArea
    const bounds = this.saved() ?? {
      width: 360,
      height: 320,
      x: area.x + area.width - 380,
      y: area.y + area.height - 340,
    }
    const window = new BrowserWindow({
      ...bounds,
      minWidth: 260,
      minHeight: 220,
      title: 'Ramu live view',
      alwaysOnTop: true,
      fullscreenable: false,
      backgroundColor: '#131315',
      webPreferences: {
        preload: this.options.preload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    })
    window.setAlwaysOnTop(true, 'floating')
    window.setContentProtection(hideFromSharing)
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    const remember = () => {
      if (!window.isDestroyed())
        try {
          writeFileSync(this.options.file, JSON.stringify(window.getBounds()))
        } catch {
          /* The next window opens in the default corner. */
        }
    }
    window.on('moved', remember)
    window.on('resized', remember)
    window.on('closed', () => {
      this.window = null
      this.options.closed()
    })
    this.window = window
    void this.options.load(window)
  }

  close() {
    if (this.window && !this.window.isDestroyed()) this.window.close()
  }
}

export const liveWindowFile = (userData: string) => join(userData, 'live-window.json')
