import { chromium } from 'playwright-core'
import type { InteractiveCheck, InteractivePreview, InteractiveNetwork } from '@ramu/shared/interactive'
import { interactiveHtml, interactiveCsp, OFFLINE_NETWORK } from '@ramu/shared/interactive'

import { Agent, fetch } from 'undici'
import { isIP } from 'node:net'
import { isPublicMcpAddress, sharedMcpLookup } from '../mcp/http'
import { ensureInteractiveBrowser } from './browser'
export { interactiveBrowserPath } from './browser'

let running = 0

/**
 * Runs before the page: a WebGL canvas keeps its last frame so it can be read back, and the page notes each canvas
 * that asked for WebGL and whether it got it.
 */
const WEBGL_WATCH = `(()=>{const g=HTMLCanvasElement.prototype.getContext;const seen=window.__ramuWebgl=[];
HTMLCanvasElement.prototype.getContext=function(type,options){const gl=/^(webgl2?|experimental-webgl)$/.test(type);const c=g.call(this,type,gl?{...options,preserveDrawingBuffer:true}:options);if(gl&&!seen.some(e=>e.canvas===this))seen.push({canvas:this,ok:!!c});return c}})()`

/** What the page's WebGL canvases show once it has run a moment: one entry per canvas that asked for WebGL. */
const WEBGL_SAMPLE = `(()=>{const out=[];for(const {canvas,ok} of window.__ramuWebgl||[]){const r=canvas.getBoundingClientRect();if(!canvas.isConnected||r.width<8||r.height<8)continue;if(!ok){out.push('failed');continue}
const s=document.createElement('canvas');s.width=48;s.height=48;const x=s.getContext('2d');x.drawImage(canvas,0,0,48,48);const d=x.getImageData(0,0,48,48).data;let same=true;for(let i=4;i<d.length;i+=4)if(Math.abs(d[i]-d[0])+Math.abs(d[i+1]-d[1])+Math.abs(d[i+2]-d[2])+Math.abs(d[i+3]-d[3])>12){same=false;break}out.push(same?'blank':'drawn')}return out})()`
/** Isolated temporary browser with no saved profile. Only the document itself and https subresources load. */
export async function previewInteractive(
  html: string,
  checks: InteractiveCheck[],
  signal?: AbortSignal,
  network: InteractiveNetwork = OFFLINE_NETWORK,
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
    // SwiftShader draws WebGL in software, so a 3D page renders on a host with no GPU.
    browser = await chromium.launch({
      executablePath,
      headless: true,
      chromiumSandbox: true,
      timeout: 10_000,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    })
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
    const source = interactiveHtml(html, 'preview', null, undefined, network, 'fake')
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
          ? network.connect
          : network.resources
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
    await context.addInitScript(WEBGL_WATCH)
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
    // A 3D page gets a moment to load its models and draw; a canvas still one color then fails, as clipped text does.
    if (await page.evaluate<boolean>('(window.__ramuWebgl||[]).length>0')) {
      await page.waitForTimeout(1500)
      for (const state of await page.evaluate<string[]>(WEBGL_SAMPLE))
        if (state !== 'drawn' && errors.length < 20)
          errors.push(
            state === 'failed'
              ? 'WebGL did not start in this canvas. Check the renderer is created once, on a canvas in the page.'
              : 'A 3D canvas stayed one color after the page loaded: nothing was drawn. Check the camera faces the scene, the scene has lights and the loop renders every frame.',
          )
    }
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
    // Boxes marked data-ramu-fit (a deck's text) size their type to their own width, so text that spills out here
    // spills out at every size, in print and in the exported file.
    const spilled = await page.evaluate<string[]>(
      '[...document.querySelectorAll("[data-ramu-fit]")].filter(e=>e.scrollHeight>e.clientHeight+1||e.scrollWidth>e.clientWidth+1).map(e=>e.getAttribute("data-ramu-fit")).slice(0,20)',
    )
    for (const label of spilled)
      if (errors.length < 20)
        errors.push(
          label?.startsWith('Frame ')
            ? `${label} has content past its edges. Make the content fit or give the frame more height.`
            : `${label} does not fit on the slide. Shorten it or split the slide.`,
        )
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
