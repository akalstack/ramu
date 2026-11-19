import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { rememberBounds, savedBounds } from './windowBounds'

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

  open(hideFromSharing: boolean) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.setContentProtection(hideFromSharing)
      this.window.showInactive()
      return
    }
    const area = screen.getPrimaryDisplay().workArea
    const saved = savedBounds(this.options.file)
    const bounds = (saved && { x: saved.x, y: saved.y, width: saved.width, height: saved.height }) ?? {
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
    rememberBounds(window, this.options.file)
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
