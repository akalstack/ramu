import { WebContentsView, session, type BrowserWindow } from 'electron'
import type { GuestFactory, GuestHandlers, GuestPage } from './browserRuntime'

/**
 * Guest pages over Electron web contents. Each page is sandboxed with context isolation and no Node access, in the
 * partition its profile names, with no preload: a website never sees the app's bridge. Camera, microphone, location,
 * notifications and downloads stay denied until a later flow grants them per origin and profile.
 */
export class ElectronGuestFactory implements GuestFactory {
  private readonly guarded = new Set<string>()
  constructor(private readonly window: () => BrowserWindow | null) {}

  private guard(partition: string) {
    if (this.guarded.has(partition)) return
    this.guarded.add(partition)
    const guest = session.fromPartition(partition)
    guest.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    guest.setPermissionCheckHandler(() => false)
    guest.on('will-download', (event) => event.preventDefault())
  }

  create(partition: string, handlers: GuestHandlers): GuestPage {
    this.guard(partition)
    const view = new WebContentsView({
      webPreferences: {
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    })
    const contents = view.webContents
    contents.setWindowOpenHandler(({ url }) => {
      handlers.onOpenWindow(url)
      return { action: 'deny' }
    })
    const check = (event: { preventDefault(): void }, url: string) => {
      if (!handlers.onNavigate(url)) event.preventDefault()
    }
    contents.on('will-navigate', check)
    contents.on('will-redirect', check)
    contents.on('render-process-gone', () => handlers.onCrash())
    const window = this.window
    let attached = false
    return {
      load: (url) => contents.loadURL(url),
      url: () => contents.getURL(),
      title: () => contents.getTitle(),
      back: () => contents.navigationHistory.goBack(),
      forward: () => contents.navigationHistory.goForward(),
      reload: () => contents.reload(),
      show(bounds) {
        const win = window()
        if (!win) return
        if (!attached) {
          win.contentView.addChildView(view)
          attached = true
        }
        view.setBounds({
          x: Math.round(bounds.x),
          y: Math.round(bounds.y),
          width: Math.max(0, Math.round(bounds.width)),
          height: Math.max(0, Math.round(bounds.height)),
        })
      },
      hide() {
        const win = window()
        if (win && attached) win.contentView.removeChildView(view)
        attached = false
      },
      destroy() {
        const win = window()
        if (win && attached) win.contentView.removeChildView(view)
        attached = false
        if (!contents.isDestroyed()) contents.close()
      },
    }
  }

  clearTemporary(partition: string): void {
    void session.fromPartition(partition).clearStorageData()
  }
}
