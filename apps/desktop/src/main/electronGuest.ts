import { WebContentsView, session, type BrowserWindow, type Session } from 'electron'
import type { GuestFactory, GuestHandlers, GuestPage, PageSnapshot } from './browserRuntime'
import { BrowserDebugger } from './browserDebugger'
import type { BrowserDiagnostics, BrowserScreenshot } from '@ramu/shared/browserBridge'
import { browserGuestScript } from './browserGuestScript'

/**
 * Guest pages over Electron web contents. Each page is sandboxed with context isolation and no Node access, in the
 * partition its profile names, with no preload: a website never sees the app's bridge. Camera, microphone, location,
 * notifications and downloads stay denied until a later flow grants them per origin and profile.
 */
export class ElectronGuestFactory implements GuestFactory {
  private static readonly closing = new Map<string, Set<Promise<void>>>()
  private static readonly guarded = new WeakSet<Session>()
  constructor(private readonly window: () => BrowserWindow | null) {}

  private guard(partition: string) {
    const guest = session.fromPartition(partition)
    if (ElectronGuestFactory.guarded.has(guest)) return
    ElectronGuestFactory.guarded.add(guest)
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
    let driver: BrowserDebugger | undefined
    const debuggerForPage = () => (driver ??= new BrowserDebugger(contents, () => handlers.onChanged?.()))
    const consoleEntries: BrowserDiagnostics['console'] = []
    let consoleTruncated = false
    contents.on('console-message', (details) => {
      if (consoleEntries.length >= 40) {
        consoleEntries.shift()
        consoleTruncated = true
      }
      consoleEntries.push({ level: details.level, message: details.message.slice(0, 500) })
    })
    let humanInput = false
    const inputGuard = (event: { preventDefault(): void }) => {
      if (!humanInput) event.preventDefault()
    }
    contents.on('before-input-event', inputGuard)
    contents.on('before-mouse-event', inputGuard)
    contents.setWindowOpenHandler(({ url }) => {
      handlers.onOpenWindow(url)
      return { action: 'deny' }
    })
    const check = (event: { preventDefault(): void }, url: string) => {
      if (!handlers.onNavigate(url)) event.preventDefault()
    }
    contents.on('will-navigate', check)
    contents.on('will-redirect', check)
    contents.on('did-navigate', () => handlers.onChanged?.())
    contents.on('did-navigate-in-page', () => handlers.onChanged?.())
    contents.on('page-title-updated', () => handlers.onChanged?.())
    contents.on('unresponsive', () => handlers.onCrash())
    contents.on('render-process-gone', () => handlers.onCrash())
    // World 999 has its own JavaScript globals/prototypes. Website scripts never receive the observation map.
    const isolated = <T>(operation: 'inspect' | 'act' | 'invalidate', action?: Parameters<GuestPage['act']>[0]) =>
      contents.executeJavaScriptInIsolatedWorld(999, [{ code: browserGuestScript(operation, action) }]) as Promise<T>
    const window = this.window
    let attached = false
    return {
      load: async (url) => {
        await debuggerForPage().ensure()
        await contents.loadURL(url)
      },
      url: () => contents.getURL(),
      title: () => contents.getTitle(),
      back: () => contents.navigationHistory.goBack(),
      forward: () => contents.navigationHistory.goForward(),
      reload: () => contents.reload(),
      inspect: () => isolated<PageSnapshot>('inspect'),
      act: async (action) => {
        const result = await isolated<{ ok: boolean; reason?: string }>('act', action)
        if (result.ok && action.kind === 'press') await debuggerForPage().key(action.key, action.shift)
        return result
      },
      screenshot: async (): Promise<BrowserScreenshot> => {
        const capture = await contents.capturePage(undefined, { stayHidden: true, stayAwake: false })
        if (capture.isEmpty())
          throw new Error('The page has no rendered image yet. Show its pane and try capturing again.')
        const original = capture.getSize()
        for (const maximum of [1024, 768, 512]) {
          const scale = Math.min(1, maximum / original.width, 768 / original.height)
          const image = capture.resize({
            width: Math.max(1, Math.round(original.width * scale)),
            height: Math.max(1, Math.round(original.height * scale)),
          })
          const bytes = image.toJPEG(50)
          if (bytes.length <= 128000)
            return { mimeType: 'image/jpeg', data: bytes.toString('base64'), ...image.getSize() }
        }
        throw new Error('The page image is too large to return. Use a text snapshot or a smaller viewport.')
      },
      diagnostics: () => {
        const network = driver?.diagnostics()
        return {
          console: consoleEntries.map((entry) => ({ ...entry })),
          network: network?.network ?? [],
          truncated: consoleTruncated || (network?.truncated ?? false),
        }
      },
      dialog: () => driver?.dialog() ?? null,
      handleDialog: (id, accept, text) => debuggerForPage().handleDialog(id, accept, text),
      setHumanInput: (enabled) => {
        humanInput = enabled
      },
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
        driver?.dispose()
        const win = window()
        if (win && attached) win.contentView.removeChildView(view)
        attached = false
        consoleEntries.length = 0
        if (!contents.isDestroyed()) {
          let pending = ElectronGuestFactory.closing.get(partition)
          if (!pending) {
            pending = new Set()
            ElectronGuestFactory.closing.set(partition, pending)
          }
          let done!: () => void
          const closed = new Promise<void>((resolve) => {
            done = resolve
          })
          pending.add(closed)
          contents.once('destroyed', () => {
            pending!.delete(closed)
            if (!pending!.size) ElectronGuestFactory.closing.delete(partition)
            done()
          })
          contents.close({ waitForBeforeUnload: false })
        }
      },
    }
  }

  private async whenClosed(partition: string): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        Promise.all([...(ElectronGuestFactory.closing.get(partition) ?? [])]),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error('A browser page did not close. Try clearing the profile again after restarting Ramu.')),
            5000,
          )
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  async clearProfile(profileId: string): Promise<void> {
    const partition = `persist:ramu-browser:${profileId}`
    await this.whenClosed(partition)
    const profile = session.fromPartition(partition)
    await profile.closeAllConnections()
    await profile.clearStorageData()
    await profile.clearAuthCache()
    await profile.clearCache()
    await profile.cookies.flushStore()
  }

  async clearTemporary(partition: string): Promise<void> {
    await this.whenClosed(partition)
    const profile = session.fromPartition(partition)
    await profile.closeAllConnections()
    await profile.clearStorageData()
    await profile.clearAuthCache()
    await profile.clearCache()
  }
}
