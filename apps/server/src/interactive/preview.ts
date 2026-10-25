import { chromium } from 'playwright-core'
import type { InteractiveCheck, InteractivePreview, InteractiveNetwork } from '@ramu/shared/interactive'
import { interactiveHtml, interactiveCsp } from '@ramu/shared/interactive'

import { Agent, fetch } from 'undici'
import { isIP } from 'node:net'
import { isPublicMcpAddress, sharedMcpLookup } from '../mcp/http'
import { ensureInteractiveBrowser } from './browser'
export { interactiveBrowserPath } from './browser'

let running = 0
/** Isolated temporary browser with no saved profile. Only the document itself and https subresources load. */
export async function previewInteractive(
  html: string,
  checks: InteractiveCheck[],
  signal?: AbortSignal,
  network?: InteractiveNetwork,
): Promise<Omit<InteractivePreview, 'id' | 'digest' | 'createdAt'>> {
  if (signal?.aborted) throw new Error('Preview cancelled')
  if (running >= 2) throw new Error('Two previews are already running. Try again shortly.')
  running++
  const dispatcher = new Agent({
    connections: 4,
    connect: { lookup: sharedMcpLookup(false), timeout: 10_000 },
    headersTimeout: 10_000,
    bodyTimeout: 15_000,
  })
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const close = () => {
    void browser?.close().catch(() => {})
  }
  try {
    const executablePath = await ensureInteractiveBrowser(signal)
    browser = await chromium.launch({ executablePath, headless: true, chromiumSandbox: true, timeout: 10_000 })
    signal?.addEventListener('abort', close, { once: true })
    if (signal?.aborted) throw new Error('Preview cancelled')
    timer = setTimeout(close, 45_000)
    const context = await browser.newContext({
      viewport: { width: 390, height: 740 },
      serviceWorkers: 'block',
      acceptDownloads: false,
      reducedMotion: 'reduce',
      colorScheme: 'dark',
    })
    const source = interactiveHtml(html, 'preview', null, undefined, network)
    await context.route('**/*', async (route) => {
      const request = route.request()
      if (request.isNavigationRequest())
        return request.url() === 'https://ramu-content.invalid/' && request.frame() === page.mainFrame()
          ? route.fulfill({
              body: source,
              contentType: 'text/html',
              headers: { 'Content-Security-Policy': `${interactiveCsp(network)}; sandbox allow-scripts` },
            })
          : route.abort('blockedbyclient')
      // Fetch through vetted DNS answers; the socket cannot resolve an allowed name a second time to a local IP.
      try {
        const url = new URL(request.url())
        const address = url.hostname.replace(/^\[|\]$/g, '')
        const origins = ['fetch', 'xhr', 'eventsource'].includes(request.resourceType())
          ? network?.connect
          : network?.resources
        if (
          url.protocol !== 'https:' ||
          url.username ||
          url.password ||
          (isIP(address) && !isPublicMcpAddress(address)) ||
          (origins && !origins.includes(url.origin))
        )
          return route.abort('blockedbyclient')
        const headers: Record<string, string> = {}
        for (const name of ['accept', 'content-type', 'origin', 'range']) {
          const value = request.headers()[name]
          if (value) headers[name] = value
        }
        const response = await fetch(url, {
          dispatcher,
          redirect: 'manual',
          method: request.method(),
          headers,
          ...(request.postDataBuffer() ? { body: request.postDataBuffer() } : {}),
          signal: AbortSignal.timeout(15_000),
        })
        const chunks: Buffer[] = []
        let size = 0
        if (response.body)
          for await (const chunk of response.body) {
            size += chunk.byteLength
            if (size > 8_000_000) {
              await response.body.cancel().catch(() => {})
              throw new Error('Resource exceeds 8 MB')
            }
            chunks.push(Buffer.from(chunk))
          }
        const safeHeaders: Record<string, string> = {}
        for (const name of [
          'content-type',
          'access-control-allow-origin',
          'access-control-allow-methods',
          'access-control-allow-headers',
          'location',
        ]) {
          const value = response.headers.get(name)
          if (value) safeHeaders[name] = value
        }
        return route.fulfill({ status: response.status, headers: safeHeaders, body: Buffer.concat(chunks) })
      } catch {
        return route.abort('blockedbyclient')
      }
    })
    await context.routeWebSocket('**/*', (socket) => socket.close())
    const page = await context.newPage()
    page.setDefaultTimeout(2000)
    page.on('dialog', (dialog) => {
      void dialog.dismiss()
    })
    const errors: string[] = []
    const logs: string[] = []
    const failedRequests: string[] = []
    page.on('pageerror', (error) => {
      if (errors.length < 20) errors.push(error.message.slice(0, 1000))
    })
    page.on('console', (message) => {
      const type = message.type()
      if (type === 'error') {
        if (errors.length < 20) errors.push(message.text().slice(0, 1000))
      } else if (['log', 'info', 'warning'].includes(type) && logs.length < 50)
        logs.push(`${type === 'warning' ? 'warn' : type}: ${message.text().slice(0, 500)}`)
    })
    const failed = (url: string, reason: string) => {
      if (url.startsWith('https://ramu-content.invalid/') || failedRequests.length >= 20) return
      failedRequests.push(`${url.slice(0, 300)} (${reason})`)
    }
    page.on('requestfailed', (request) => failed(request.url(), request.failure()?.errorText ?? 'failed'))
    page.on('response', (response) => {
      if (response.status() >= 400) failed(response.url(), `HTTP ${response.status()}`)
    })
    // Remote libraries need time to arrive; the document's own bytes are local.
    await page.goto('https://ramu-content.invalid/', { waitUntil: 'load', timeout: 20_000 })
    const results: InteractivePreview['checks'] = []
    for (const check of checks) {
      try {
        const target = page
          .getByLabel(check.label, { exact: true })
          .or(page.getByRole('button', { name: check.label, exact: true }))
          .first()
        if (check.action === 'click') await target.click()
        else if (check.action === 'select') await target.selectOption(check.value ?? '')
        else if (check.action === 'check') await target.setChecked(check.value !== 'false')
        else if ((await target.getAttribute('type')) === 'range') {
          await target.evaluate(
            '(element,value)=>{element.value=value;element.dispatchEvent(new Event("input",{bubbles:true}));element.dispatchEvent(new Event("change",{bubbles:true}))}',
            check.value ?? '',
          )
        } else await target.fill(check.value ?? '')
        await page.getByText(check.expect, { exact: false }).first().waitFor({ state: 'visible' })
        results.push({ label: check.label, passed: true, detail: `Observed: ${check.expect}` })
      } catch {
        results.push({
          label: check.label,
          passed: false,
          detail: `Could not perform ${check.action} or observe ${JSON.stringify(check.expect)}`,
        })
      }
    }
    const layouts: NonNullable<InteractivePreview['layouts']> = []
    const measure = async () => {
      layouts.push(
        await page.evaluate(
          '({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,overflow:document.documentElement.scrollWidth>innerWidth+1,scheme:matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light"})',
        ),
      )
    }
    await measure()
    const height = await page.evaluate<number>('Math.min(2000, Math.max(120, document.documentElement.scrollHeight))')
    const screenshot = `data:image/png;base64,${(await page.screenshot({ timeout: 3000 })).toString('base64')}`
    // Report actual overflow at both widths; this is browser evidence, not native-device validation.
    await page.setViewportSize({ width: 900, height: 740 })
    const wideScreenshot = `data:image/png;base64,${(await page.screenshot({ timeout: 3000 })).toString('base64')}`
    await measure()
    for (const width of [320, 768]) {
      await page.setViewportSize({ width, height: 740 })
      await measure()
    }
    await page.emulateMedia({ colorScheme: 'light' })
    await page.setViewportSize({ width: 390, height: 740 })
    await measure()
    const lightScreenshot = `data:image/png;base64,${(await page.screenshot({ timeout: 3000 })).toString('base64')}`
    return {
      screenshot,
      wideScreenshot,
      lightScreenshot,
      height,
      checks: results,
      errors,
      logs,
      failedRequests,
      layouts,
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', close)
    await browser?.close().catch(() => {})
    void dispatcher.close()
    running--
  }
}
