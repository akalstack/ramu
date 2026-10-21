import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, type Browser, type BrowserContext, type Page, type CDPSession, type Dialog } from 'playwright-core'
import { readdirSync, rmSync } from 'node:fs'
import type { BrowserDiagnostics, BrowserDialog, BrowserScreenshot } from '@ramu/shared/browserBridge'
import { browserGuestScript } from '@ramu/shared/browserGuestScript'
import { HostDownloads } from './hostDownloads'
import { browserFaviconFrom } from '@ramu/shared/browserLinks'
import { allowedGuestUrl, type GuestFactory, type GuestHandlers, type GuestPage, type PageSnapshot } from './browserRuntime'

/** Host-owned Chromium. No public debugging port, external executable arguments or page-supplied JS. */
export class HostGuestFactory implements GuestFactory {
  private contexts = new Map<string, Promise<BrowserContext>>()
  private readonly references = new Map<string, number>()
  private readonly idle = new Map<string, NodeJS.Timeout>()
  private readonly downloadFrames = new Map<string, GuestHandlers>()
  private readonly titles = new Map<string, (title: string) => void>()
  private readonly temporaryBrowsers = new Map<string, Browser>()
  private readonly downloadBridges = new Map<string, HostDownloads>()
  private closing = new Set<Promise<unknown>>()
  private closed = false
  constructor(private readonly root: string, private readonly executable: string) {
    try { for (const name of readdirSync(root)) if (/^temporary-[a-f0-9-]{36}$/.test(name)) rmSync(join(root, name), { recursive: true, force: true }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Temporary host browser data could not be cleaned. Check host storage before Setup.') }
  }
  private async temporary(partition: string): Promise<BrowserContext> {
    const browser = await chromium.launch({ executablePath: this.executable, headless: true, chromiumSandbox: true, timeout: 15_000 })
    try {
      const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, acceptDownloads: false, permissions: [] })
      this.temporaryBrowsers.set(partition, browser)
      return context
    } catch (error) { await browser.close(); throw error }
  }
  async preflight(): Promise<void> {
    const browser = await chromium.launch({ executablePath: this.executable, headless: true, chromiumSandbox: true, timeout: 15_000 })
    await browser.close()
  }
  private context(partition: string): Promise<BrowserContext> {
    if (this.closed) return Promise.reject(new Error('The host browser stopped.'))
    let context = this.contexts.get(partition)
    if (!context) {
      if (this.contexts.size >= 8) throw new Error('Close browser tabs in an unused profile before opening another identity (maximum eight active profiles).')
      // Partitions originate in BrowserRuntime, never from a renderer path.
      const id = partition.replace(/^persist:ramu-browser:/, '').replace(/^ramu-browser-temp:/, 'temporary-')
      if (!/^[a-z0-9-]{1,100}$/.test(id)) throw new Error('Invalid host browser partition.')
      const directory = join(this.root, id)
      context = (async () => {
        await Promise.allSettled([...this.closing])
        await mkdir(directory, { recursive: true, mode: 0o700 })
        const context = partition.startsWith('ramu-browser-temp:') ? await this.temporary(partition) : await chromium.launchPersistentContext(directory, {
          executablePath: this.executable, headless: true, chromiumSandbox: true, timeout: 15_000,
          viewport: { width: 1024, height: 768 }, acceptDownloads: false, permissions: [],
        })
        try {
        await context.route('**/*', route => {
          const request = route.request()
          if (request.isNavigationRequest() && !allowedGuestUrl(request.url())) return route.abort('blockedbyclient')
          return route.continue()
        })
        // Persistent Chromium creates an initial empty page. It is never treated as a thread tab.
        for (const page of context.pages()) await page.close()
        const browser = context.browser()
        if (!browser) { await context.close(); throw new Error('This Chromium runtime cannot provide a private download channel.') }
        const downloadProtocol = await browser.newBrowserCDPSession()
        for (const name of ['camera', 'microphone', 'geolocation', 'notifications', 'clipboard-read', 'clipboard-write'])
          await downloadProtocol.send('Browser.setPermission', { permission: { name }, setting: 'denied' })
        downloadProtocol.on('Target.targetInfoChanged', event => this.titles.get(event.targetInfo.targetId)?.(event.targetInfo.title))
        await downloadProtocol.send('Target.setDiscoverTargets', { discover: true })
        const downloads = new HostDownloads(downloadProtocol, join(directory, 'ramu-downloads'), id => this.downloadFrames.get(id))
        this.downloadBridges.set(partition, downloads)
        const tracked = this.contexts.get(partition)
        context.on('close', () => { if (this.contexts.get(partition) === tracked) this.contexts.delete(partition) })
        if (this.closed) { await context.close(); throw new Error('The host browser stopped.') }
        return context
        } catch (error) {
          await context.close().catch(() => {})
          await this.temporaryBrowsers.get(partition)?.close().catch(() => {})
          this.temporaryBrowsers.delete(partition)
          this.downloadBridges.delete(partition)
          throw error
        }
      })().catch(error => { if (this.contexts.get(partition) === context) this.contexts.delete(partition); throw error })
      this.contexts.set(partition, context)
    }
    return context
  }
  create(partition: string, handlers: GuestHandlers): GuestPage {
    this.references.set(partition, (this.references.get(partition) ?? 0) + 1)
    const idle = this.idle.get(partition)
    if (idle) clearTimeout(idle)
    this.idle.delete(partition)
    let url = '', title = '', destroyed = false, human = false
    let dialog: { info: BrowserDialog; native: Dialog } | null = null
    const diagnostics: BrowserDiagnostics = { console: [], network: [], truncated: false }
    const push = <T>(entries: T[], value: T) => {
      if (entries.length >= 40) { entries.shift(); diagnostics.truncated = true }
      entries.push(value)
    }
    let frameId: string | undefined
    let downloadFrameId: string | undefined
    let targetId: string | undefined
    let cdp: CDPSession | undefined
    let page: Page | undefined
    const ready = Promise.resolve().then(() => this.context(partition)).then(async context => {
      if (destroyed) throw new Error('That browser tab is closed.')
      page = await context.newPage()
      page.setDefaultTimeout(10_000)
      page.on('crash', () => handlers.onCrash())
      page.on('close', () => { if (!destroyed) handlers.onCrash() })
      page.on('dialog', native => {
        dialog = { native, info: { id: randomUUID(), type: native.type() as BrowserDialog['type'], message: native.message().slice(0, 1000) } }
        handlers.onChanged?.()
      })
      // Source files belong to the execution host, so a remote phone never opens an OS picker on the wrong device.
      page.on('filechooser', () => handlers.onChanged?.())
      page.on('popup', popup => {
        const address = popup.url()
        void popup.close().catch(() => {})
        if (allowedGuestUrl(address)) handlers.onOpenWindow(address)
      })
      page.on('framenavigated', frame => {
        if (frame !== page!.mainFrame()) return
        url = frame.url()
        frameId = undefined
        if (!handlers.onNavigate(url) && url !== 'about:blank') void page!.close().catch(() => {})
        void page!.title().then(value => { title = value.slice(0, 1000); handlers.onChanged?.() }).catch(() => {})
        handlers.onChanged?.()
      })
      page.on('console', message => push(diagnostics.console, { level: message.type(), message: message.text().slice(0, 500) }))
      page.on('response', response => {
        const address = allowedGuestUrl(response.url())
        if (address) push(diagnostics.network, { origin: address.origin, method: response.request().method().slice(0, 10), status: response.status() })
      })
      page.on('requestfailed', request => {
        const address = allowedGuestUrl(request.url())
        if (address) push(diagnostics.network, { origin: address.origin, method: request.method().slice(0, 10), error: 'Request failed' })
      })
      cdp = await context.newCDPSession(page)
      const targetInfo = (await cdp.send('Target.getTargetInfo')).targetInfo
      targetId = targetInfo.targetId
      await this.downloadBridges.get(partition)?.enable(targetInfo.browserContextId)
      this.titles.set(targetId, value => { title = value.slice(0, 1000); handlers.onChanged?.() })
      await cdp.send('Page.enable')
      const bindDownload = (id: string) => {
        if (downloadFrameId) this.downloadFrames.delete(downloadFrameId)
        downloadFrameId = id
        this.downloadFrames.set(id, handlers)
      }
      bindDownload((await cdp.send('Page.getFrameTree')).frameTree.frame.id)
      cdp.on('Page.frameNavigated', event => { if (!event.frame.parentId) bindDownload(event.frame.id) })
      if (destroyed) { await page.close(); throw new Error('That browser tab is closed.') }
      return page
    })
    ready.catch(() => {})
    const isolated = async <T>(operation: 'inspect' | 'act', action?: Parameters<GuestPage['act']>[0]): Promise<T> => {
      await ready
      if (!frameId) {
        const { frameTree } = await cdp!.send('Page.getFrameTree')
        frameId = frameTree.frame.id
      }
      const { executionContextId } = await cdp!.send('Page.createIsolatedWorld', { frameId, worldName: 'ramu-browser' })
      const result = await cdp!.send('Runtime.evaluate', { expression: browserGuestScript(operation, action), contextId: executionContextId, returnByValue: true, awaitPromise: true })
      if (result.exceptionDetails) throw new Error('The page changed or refused the action. Take a new snapshot.')
      return result.result.value as T
    }
    const history = async (kind: 'back' | 'forward' | 'reload') => {
      const page = await ready
      const options = { waitUntil: 'domcontentloaded' as const, timeout: 15_000 }
      if (kind === 'back') await page.goBack(options)
      else if (kind === 'forward') await page.goForward(options)
      else await page.reload(options)
    }
    return {
      load: async address => { const page = await ready; await page.goto(address, { waitUntil: 'domcontentloaded', timeout: 15_000 }); url = page.url(); title = (await page.title()).slice(0, 1000) },
      url: () => url, title: () => title, favicon: () => {
        const page = allowedGuestUrl(url)
        return page ? browserFaviconFrom(url, new URL('/favicon.ico', page).href) : null
      }, back: () => history('back'), forward: () => history('forward'), reload: () => history('reload'),
      inspect: () => isolated<PageSnapshot>('inspect'),
      act: async action => {
        const result = await isolated<{ ok: boolean; reason?: string; points?: { x: number; y: number }[] }>('act', action)
        if (!result.ok) return result
        const page = await ready
        if (action.kind === 'press') {
          const key = action.key === 'Space' ? ' ' : action.key
          if (!(key.length === 1 || /^(Enter|Escape|Tab|Arrow(Up|Down|Left|Right)|Backspace|Delete|Home|End|PageUp|PageDown|F([1-9]|1[0-2]))$/.test(key))) throw new Error('Unsupported browser key.')
          const modifiers = [...new Set([...(action.modifiers ?? []), ...(action.shift ? ['Shift'] : [])])]
          await page.keyboard.press([...modifiers, key].join('+'))
        } else if (result.points?.length && ['click', 'hover', 'drag'].includes(action.kind)) {
          const point = result.points[0]!
          await page.mouse.move(point.x, point.y)
          if (action.kind === 'click') await page.mouse.click(point.x, point.y, { button: action.button ?? 'left', clickCount: action.clickCount ?? 1 })
          else if (action.kind === 'drag') {
            await page.mouse.down()
            try { for (const point of result.points.slice(1)) await page.mouse.move(point.x, point.y, { steps: 5 }) }
            finally { await page.mouse.up() }
          }
        }
        return { ok: true }
      },
      setHumanInput: enabled => { human = enabled },
      input: async input => {
        if (!human || destroyed) throw new Error('This device no longer controls the browser.')
        const page = await ready
        if (!human || destroyed) throw new Error('This device no longer controls the browser.')
        if (input.kind === 'click') await page.mouse.click(input.x * 1024, input.y * 768, { button: input.button, clickCount: input.clickCount })
        else if (input.kind === 'scroll') await page.mouse.wheel(input.x, input.y)
        else if (input.kind === 'text') await page.keyboard.insertText(input.text)
        else {
          if (!/^(Enter|Escape|Tab|Arrow(Up|Down|Left|Right)|Backspace|Delete|Home|End|PageUp|PageDown)$/.test(input.key)) throw new Error('Unsupported browser key.')
          await page.keyboard.press(input.key)
        }
      },
      screenshot: async (): Promise<BrowserScreenshot> => {
        const page = await ready
        for (const quality of [50, 30, 15]) {
          const bytes = await page.screenshot({ type: 'jpeg', quality, timeout: 5000 })
          if (bytes.length <= 128000) return { mimeType: 'image/jpeg', data: bytes.toString('base64'), width: 1024, height: 768 }
        }
        throw new Error('This page image is too large. Use its text snapshot.')
      },
      diagnostics: () => ({ console: diagnostics.console.map(entry => ({ ...entry })), network: diagnostics.network.map(entry => ({ ...entry })), truncated: diagnostics.truncated }),
      dialog: () => dialog?.info ?? null,
      handleDialog: async (id, accept, text) => {
        if (!dialog || dialog.info.id !== id) throw new Error('That website dialog changed.')
        const native = dialog.native
        dialog = null
        if (accept) await native.accept(text); else await native.dismiss()
      },
      show() {}, hide() {},
      destroy: () => {
        if (destroyed) return
        destroyed = true
        if (downloadFrameId) this.downloadFrames.delete(downloadFrameId)
        if (targetId) this.titles.delete(targetId)
        human = false
        this.references.set(partition, Math.max(0, (this.references.get(partition) ?? 1) - 1))
        const closing = ready.catch(() => undefined).then(() => page?.close({ runBeforeUnload: false })).catch(() => {})
        this.closing.add(closing)
        void closing.finally(() => this.closing.delete(closing))
        if (!this.references.get(partition) && partition.startsWith('persist:')) {
          const timer = setTimeout(() => {
            this.idle.delete(partition)
            if (this.references.get(partition)) return
            const context = this.contexts.get(partition)
            this.contexts.delete(partition)
            const finishing = Promise.resolve(context).then(context => context?.close()).catch(() => {})
            this.closing.add(finishing)
            void finishing.finally(() => this.closing.delete(finishing))
          }, 5000)
          timer.unref()
          this.idle.set(partition, timer)
        }
      },
    }
  }
  async clearTemporary(partition: string): Promise<void> {
    const context = this.contexts.get(partition)
    this.contexts.delete(partition)
    await Promise.all([...this.closing])
    await (await context)?.close()
    await this.temporaryBrowsers.get(partition)?.close()
    this.temporaryBrowsers.delete(partition)
    this.downloadBridges.delete(partition)
    await rm(join(this.root, partition.replace(/^ramu-browser-temp:/, 'temporary-')), { recursive: true, force: true })
  }
  async clearProfile(profileId: string): Promise<void> {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(profileId)) throw new Error('Invalid browser profile.')
    const partition = `persist:ramu-browser:${profileId}`
    const idle = this.idle.get(partition)
    if (idle) clearTimeout(idle)
    this.idle.delete(partition)
    const context = this.contexts.get(partition)
    this.contexts.delete(partition)
    await Promise.all([...this.closing])
    await (await context)?.close()
    await rm(join(this.root, profileId), { recursive: true, force: true })
  }
  async close(): Promise<void> {
    this.closed = true
    this.downloadFrames.clear()
    this.titles.clear()
    for (const timer of this.idle.values()) clearTimeout(timer)
    this.idle.clear(); this.references.clear()
    await Promise.allSettled([...this.closing])
    await Promise.allSettled([...this.contexts.values()].map(async context => (await context).close()))
    this.contexts.clear()
    await Promise.allSettled([...this.temporaryBrowsers.values()].map(browser => browser.close()))
    this.temporaryBrowsers.clear(); this.downloadBridges.clear()
  }
}
