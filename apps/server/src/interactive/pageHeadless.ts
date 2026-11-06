import { chromium } from 'playwright-core'
import type { JsonValue } from '@ramu/shared/interactive'
import { interactiveCsp, interactiveHtml } from '@ramu/shared/interactive'
import type { ArtifactInfo, ArtifactRecordQuery } from '@ramu/shared/artifacts'
import type { PageFunction } from './pageAi'
import type { PageStore } from './pages'
import { ensureInteractiveBrowser } from './browser'

/** A page opened on the host with no device: the functions it registered, and a way to call them. */
export interface HeadlessPage {
  functions: PageFunction[]
  call(name: string, input: Record<string, JsonValue>): Promise<JsonValue>
  /** A PNG of the element a person pointed at with Edit, at phone width, or null when it is gone. */
  screenshot(selector: string): Promise<Buffer | null>
  close(): Promise<void>
}

/** Whether a page offers functions to its runs, so a scheduled run needs the page loaded to use them. */
export const registersFunctions = (html: string) => /ramuContent\.ai\.tool\s*\(/.test(html)

/**
 * Loads a page in the sandboxed preview browser for a run nobody started from a device (a schedule or a trigger), so
 * the run can use the functions the page registers. The frame reads its records through the host with the same grants;
 * it has no network, and anything else it asks for is refused.
 */
export async function openHeadlessPage(
  page: ArtifactInfo,
  pages: PageStore,
  signal?: AbortSignal,
): Promise<HeadlessPage> {
  const document = pages.document(page.id)
  const executablePath = await ensureInteractiveBrowser(signal)
  const browser = await chromium.launch({ executablePath, headless: true, chromiumSandbox: true, timeout: 10_000 })
  const close = async () => {
    await browser.close().catch(() => {})
  }
  const timer = setTimeout(() => void close(), 5 * 60_000)
  try {
    const context = await browser.newContext({
      serviceWorkers: 'block',
      acceptDownloads: false,
      viewport: { width: 390, height: 740 },
      colorScheme: 'dark',
    })
    const instance = `headless:${page.id}`
    const state = pages.state(page.id).state
    const source = interactiveHtml(document.html, instance, state, undefined, document.reference.network)
    await context.route('**/*', (route) =>
      route.request().isNavigationRequest() && route.request().url() === 'https://ramu-content.invalid/'
        ? route.fulfill({
            body: source,
            contentType: 'text/html',
            headers: {
              'Content-Security-Policy': `${interactiveCsp(document.reference.network)}; sandbox allow-scripts`,
            },
          })
        : route.abort('blockedbyclient'),
    )
    await context.routeWebSocket('**/*', (socket) => socket.close())
    const view = await context.newPage()
    let functions: PageFunction[] = []
    let ready = false
    const results = new Map<string, { resolve(value: JsonValue): void; reject(error: Error): void }>()
    const post = (message: Record<string, unknown>) =>
      view
        .evaluate((data) => window.dispatchEvent(new MessageEvent('message', { data })), {
          ramuInteractive: 1,
          instance,
          ...message,
        })
        .catch(() => {})
    const answer = (requestId: string, work: () => unknown) => {
      Promise.resolve()
        .then(work)
        .then(
          (value) => post({ type: 'reply', requestId, value: value ?? null }),
          (error: Error) => post({ type: 'reply', requestId, error: error.message }),
        )
    }
    await view.exposeFunction('__ramuHost', (text: string) => {
      if (typeof text !== 'string' || text.length > 200_000) return
      let m: { ramuInteractive?: number; instance?: string; type?: string; value?: unknown; requestId?: string }
      try {
        m = JSON.parse(text)
      } catch {
        return
      }
      if (m.ramuInteractive !== 1 || m.instance !== instance) return
      if (m.type === 'ready') ready = true
      if (m.type === 'tools' && Array.isArray(m.value)) functions = (m.value as PageFunction[]).slice(0, 16)
      if (m.type === 'tool-result' && m.value && typeof m.value === 'object') {
        const result = m.value as { id: string; value?: JsonValue; error?: string }
        const pending = results.get(result.id)
        results.delete(result.id)
        if (result.error) pending?.reject(new Error(result.error))
        else pending?.resolve(result.value ?? null)
      }
      if (m.type !== 'call' || !m.requestId || !m.value || typeof m.value !== 'object') return
      const { method, args } = m.value as { method: string; args: unknown[] }
      const [collection, second, third, fourth] = args as [string, unknown, unknown, unknown]
      answer(m.requestId, () => {
        switch (method) {
          case 'records.list':
            return pages.records(page.id, collection, (second ?? {}) as ArtifactRecordQuery)
          case 'records.get':
            return pages.record(page.id, collection, String(second))
          case 'records.sum':
            return pages.sum(
              page.id,
              collection,
              String(second),
              third ? String(third) : undefined,
              (fourth ?? {}) as ArtifactRecordQuery,
            )
          case 'files.get':
            return pages.file(page.id, String(collection))
          default:
            // A page loaded for a run only reads; its functions change records through the run's own tools.
            throw new Error(`${method} is not available while the page runs on its own.`)
        }
      })
    })
    await view.addInitScript(() => {
      Object.defineProperty(window, 'ReactNativeWebView', {
        value: {
          postMessage: (text: string) => (window as unknown as { __ramuHost(text: string): void }).__ramuHost(text),
        },
      })
    })
    await view.goto('https://ramu-content.invalid/', { waitUntil: 'load', timeout: 20_000 })
    // Pages register their functions as they start; give them a moment after they report ready.
    for (let waited = 0; waited < 5_000 && !(ready && functions.length); waited += 100)
      await new Promise((resolve) => setTimeout(resolve, 100))
    let next = 0
    return {
      functions,
      call: (name, input) =>
        new Promise<JsonValue>((resolve, reject) => {
          const id = `headless-${++next}`
          const timeout = setTimeout(() => {
            results.delete(id)
            reject(new Error(`The page did not answer ${name} in time.`))
          }, 30_000)
          results.set(id, {
            resolve: (value) => {
              clearTimeout(timeout)
              resolve(value)
            },
            reject: (error) => {
              clearTimeout(timeout)
              reject(error)
            },
          })
          void post({ type: 'tool-call', value: { id, name, input } })
        }),
      screenshot: async (selector) => {
        if (!/^[\w#.\- >]{1,600}$/.test(selector)) return null
        const target = view.locator(`body > ${selector}`).first()
        if (!(await target.count())) return null
        return target.screenshot({ timeout: 3000 }).catch(() => null)
      },
      close: async () => {
        clearTimeout(timer)
        await close()
      },
    }
  } catch (error) {
    clearTimeout(timer)
    await close()
    throw error
  }
}
