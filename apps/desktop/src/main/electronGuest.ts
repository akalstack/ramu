import { WebContentsView, session, shell, Menu, type BrowserWindow, type Session, type WebContents } from 'electron'
import type { GuestFactory, GuestHandlers, GuestPage, PageSnapshot } from './browserRuntime'
import { BrowserDebugger } from './browserDebugger'
import type {
  BrowserDiagnostics,
  BrowserFieldFocus,
  BrowserScreenshot,
  BrowserTabAdjust,
} from '@ramu/shared/browserBridge'
import { browserGuestScript } from './browserGuestScript'
import { browserFaviconFrom } from '@ramu/shared/browserLinks'
import { t } from './localization'

const PARKED = { x: -20000, y: -20000, width: 1280, height: 800 }
const SHORTCUT_KEYS = new Set(['`', 'j', 'b', 'l', 'p'])
/** The terminal, panel, browser and file shortcuts, which must work wherever focus is. */
const appShortcut = (input: { key: string; control: boolean; meta: boolean; alt: boolean; shift: boolean }) => {
  const key = input.key.toLowerCase()
  if (!SHORTCUT_KEYS.has(key)) return false
  if (key === '`') return input.control && !input.meta && !input.alt
  const mod = process.platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta
  if (!mod) return false
  if (key === 'j' || key === 'p') return !input.alt && !input.shift
  if (key === 'b') return input.alt && !input.shift
  return input.shift && !input.alt
}

/**
 * Guest pages over Electron web contents. Each page is sandboxed with context isolation and no Node access, in the
 * partition its profile names, with no preload: a website never sees the app's bridge. Camera, microphone, location,
 * notifications stay denied. Downloads require an explicit, bounded one-use grant from the current controller.
 */
export class ElectronGuestFactory implements GuestFactory {
  private static readonly closing = new Map<string, Set<Promise<void>>>()
  private static readonly guarded = new WeakSet<Session>()
  private static readonly downloadHandlers = new WeakMap<WebContents, GuestHandlers>()
  constructor(private readonly window: () => BrowserWindow | null) {}

  private guard(partition: string) {
    const guest = session.fromPartition(partition)
    if (ElectronGuestFactory.guarded.has(guest)) return
    ElectronGuestFactory.guarded.add(guest)
    guest.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    guest.setPermissionCheckHandler(() => false)
    guest.on('will-download', (event, item, contents) => {
      const accepted = ElectronGuestFactory.downloadHandlers.get(contents)?.onDownload?.({
        name: () => item.getFilename(),
        total: () => item.getTotalBytes(),
        received: () => item.getReceivedBytes(),
        saveTo: (path) => item.setSavePath(path),
        cancel: () => item.cancel(),
        updated: (callback) => {
          item.on('updated', callback)
        },
        done: (callback) => {
          item.once('done', (_event, state) => callback(state))
        },
      })
      if (!accepted) event.preventDefault()
    })
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
    ElectronGuestFactory.downloadHandlers.set(contents, handlers)
    let favicon: string | null = null
    contents.on('page-favicon-updated', (_event, icons) => {
      favicon = icons.map((icon) => browserFaviconFrom(contents.getURL(), icon)).find((icon) => !!icon) ?? null
      handlers.onChanged?.()
    })
    const window = this.window
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
    contents.on('context-menu', (_event, params) => {
      if (!humanInput) return
      let url: URL
      try {
        url = new URL(params.linkURL)
      } catch {
        return
      }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return
      const win = window()
      if (!win || win.isDestroyed()) return
      Menu.buildFromTemplate([
        {
          label: t('Open in Ramu browser'),
          click: () => {
            if (humanInput) handlers.onOpenWindow(url.href)
          },
        },
        {
          label: t('Open in system browser'),
          click: () => {
            if (humanInput) void shell.openExternal(url.href)
          },
        },
      ]).popup({ window: win })
    })
    // The page is its own native view, so while it has focus the app's shortcuts never reach the renderer. Hand the
    // layout shortcuts back to the app window; everything else, including copy and paste, stays with the page.
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || !appShortcut(input)) return
      const host = window()
      if (!host || host.isDestroyed()) return
      event.preventDefault()
      host.webContents.focus()
      const modifiers = (['control', 'meta', 'alt', 'shift'] as const).filter((name) => input[name])
      host.webContents.sendInputEvent({ type: 'keyDown', keyCode: input.key, modifiers })
      host.webContents.sendInputEvent({ type: 'keyUp', keyCode: input.key, modifiers })
    })
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
    contents.on('did-navigate', () => {
      favicon = null
      handlers.onChanged?.()
    })
    contents.on('did-navigate-in-page', () => handlers.onChanged?.())
    contents.on('page-title-updated', () => handlers.onChanged?.())
    contents.on('unresponsive', () => handlers.onCrash())
    contents.on('render-process-gone', () => handlers.onCrash())
    // World 999 has its own JavaScript globals/prototypes. Website scripts never receive the observation map.
    const isolated = <T>(
      operation: 'inspect' | 'act' | 'invalidate' | 'focus',
      action?: Parameters<GuestPage['act']>[0],
    ) => contents.executeJavaScriptInIsolatedWorld(999, [{ code: browserGuestScript(operation, action) }]) as Promise<T>
    let attached = false
    // A page needs a real viewport and a place in the window to lay out and take pointer input, so every page stays
    // attached to the window and is parked off screen while its pane is hidden.
    const ensureAttached = () => {
      const win = window()
      if (!win || win.isDestroyed() || attached) return
      win.contentView.addChildView(view)
      attached = true
      view.setBounds(PARKED)
    }
    const history = (direction: 'back' | 'forward' | 'reload'): Promise<void> => {
      if (direction === 'back' && !contents.navigationHistory.canGoBack()) return Promise.resolve()
      if (direction === 'forward' && !contents.navigationHistory.canGoForward()) return Promise.resolve()
      return new Promise((resolve, reject) => {
        const finish = (error?: Error) => {
          clearTimeout(timer)
          contents.removeListener('did-stop-loading', loaded)
          contents.removeListener('destroyed', closed)
          if (error) reject(error)
          else resolve()
        }
        const loaded = () => finish()
        const closed = () => finish(new Error('The browser tab closed during navigation.'))
        const timer = setTimeout(
          () => finish(new Error('Browser navigation timed out. Inspect the page before continuing.')),
          15_000,
        )
        contents.once('did-stop-loading', loaded)
        contents.once('destroyed', closed)
        try {
          if (direction === 'reload') contents.reload()
          else if (direction === 'back') contents.navigationHistory.goBack()
          else contents.navigationHistory.goForward()
        } catch {
          finish(new Error('Browser navigation could not start. Inspect the page before continuing.'))
        }
      })
    }
    return {
      load: async (url) => {
        ensureAttached()
        // Attaching before the first navigation never settles on a page that has not loaded anything yet.
        const loaded = contents.loadURL(url)
        loaded.catch(() => {})
        await debuggerForPage().ensure()
        await loaded
      },
      url: () => contents.getURL(),
      title: () => contents.getTitle(),
      favicon: () => browserFaviconFrom(contents.getURL(), favicon),
      back: () => history('back'),
      forward: () => history('forward'),
      reload: () => history('reload'),
      inspect: () => isolated<PageSnapshot>('inspect'),
      focusedField: () => isolated<BrowserFieldFocus>('focus'),
      input: async (input) => {
        if (!humanInput) throw new Error('This device no longer controls the browser.')
        await debuggerForPage().remoteInput(input)
      },
      adjust: async (change: BrowserTabAdjust) => {
        if (change.hardReload)
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 15_000)
            contents.once('did-stop-loading', () => {
              clearTimeout(timer)
              resolve()
            })
            contents.reloadIgnoringCache()
          })
        if (change.zoom !== undefined) contents.setZoomFactor(change.zoom)
        if (change.colorScheme) await debuggerForPage().colorScheme(change.colorScheme)
        // Only the HTTP cache: cookies, storage and sign-ins in the profile are kept.
        if (change.clearCache) await contents.session.clearCache()
        handlers.onChanged?.()
      },
      act: async (action) => {
        const result = await isolated<{ ok: boolean; reason?: string; points?: { x: number; y: number }[] }>(
          'act',
          action,
        )
        if (!result.ok) return result
        if (action.kind === 'press') await debuggerForPage().key(action.key, action.shift, action.modifiers)
        else if (
          (action.kind === 'click' || action.kind === 'hover' || action.kind === 'drag') &&
          result.points?.length
        )
          await debuggerForPage().mouse(result.points, {
            kind: action.kind,
            ...(action.kind === 'click' ? { button: action.button, clickCount: action.clickCount } : {}),
          })
        return { ok: true }
      },
      nextFrame: (after) => debuggerForPage().nextFrame(after),
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
        ensureAttached()
        if (!attached) return
        view.setBounds({
          x: Math.round(bounds.x),
          y: Math.round(bounds.y),
          width: Math.max(0, Math.round(bounds.width)),
          height: Math.max(0, Math.round(bounds.height)),
        })
      },
      hide() {
        if (attached) view.setBounds(PARKED)
        const win = window()
        if (win && !win.isDestroyed() && contents.isFocused()) win.webContents.focus()
      },
      destroy() {
        ElectronGuestFactory.downloadHandlers.delete(contents)
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
