import { existsSync } from 'node:fs'
import { chromium } from 'playwright-core'
import type { InteractiveCheck, InteractivePreview } from '@ramu/shared/interactive'
import { interactiveHtml, INTERACTIVE_CSP } from '@ramu/shared/interactive'

export function interactiveBrowserPath(): string | undefined {
  return [
    process.env.RAMU_INTERACTIVE_BROWSER,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    ...(process.platform === 'win32'
      ? [
          `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
        ]
      : []),
  ].find((path) => path && existsSync(path))
}
let running = 0
/** Isolated temporary browser, no saved profile, no network/assets outside the submitted bundle. */
export async function previewInteractive(
  html: string,
  checks: InteractiveCheck[],
  signal?: AbortSignal,
): Promise<Omit<InteractivePreview, 'id' | 'digest' | 'createdAt'>> {
  if (signal?.aborted) throw new Error('Preview cancelled')
  if (running >= 2) throw new Error('Two previews are already running. Try again shortly.')
  const executablePath = interactiveBrowserPath()
  if (!executablePath)
    throw new Error(
      'Install Chromium/Chrome on the host or set RAMU_INTERACTIVE_BROWSER to its executable. No preview was validated.',
    )
  running++
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const close = () => {
    void browser?.close().catch(() => {})
  }
  try {
    browser = await chromium.launch({ executablePath, headless: true, chromiumSandbox: true, timeout: 10_000 })
    signal?.addEventListener('abort', close, { once: true })
    if (signal?.aborted) throw new Error('Preview cancelled')
    timer = setTimeout(close, 20_000)
    const context = await browser.newContext({
      viewport: { width: 390, height: 740 },
      serviceWorkers: 'block',
      acceptDownloads: false,
      reducedMotion: 'reduce',
    })
    const source = interactiveHtml(html, 'preview')
    await context.route('**/*', (route) =>
      route.request().isNavigationRequest() &&
      route.request().url() === 'https://ramu-content.invalid/' &&
      route.request().frame() === page.mainFrame()
        ? route.fulfill({
            body: source,
            contentType: 'text/html',
            headers: { 'Content-Security-Policy': `${INTERACTIVE_CSP}; sandbox allow-scripts` },
          })
        : route.abort('blockedbyclient'),
    )
    await context.routeWebSocket('**/*', (socket) => socket.close())
    const page = await context.newPage()
    page.setDefaultTimeout(2000)
    page.on('dialog', (dialog) => {
      void dialog.dismiss()
    })
    const errors: string[] = []
    page.on('pageerror', (error) => {
      if (errors.length < 20) errors.push(error.message.slice(0, 1000))
    })
    page.on('console', (message) => {
      if (message.type() === 'error' && errors.length < 20) errors.push(message.text().slice(0, 1000))
    })
    await page.goto('https://ramu-content.invalid/', { waitUntil: 'load', timeout: 5000 })
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
          '({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight,overflow:document.documentElement.scrollWidth>innerWidth+1})',
        ),
      )
    }
    await measure()
    const height = await page.evaluate<number>('Math.min(2000, Math.max(120, document.documentElement.scrollHeight))')
    const screenshot = `data:image/png;base64,${(await page.screenshot({ timeout: 3000 })).toString('base64')}`
    // Report actual overflow at both widths; this is browser evidence, not native-device validation.
    await page.setViewportSize({ width: 900, height: 740 })
    await page.screenshot({ timeout: 3000 })
    await measure()
    return { screenshot, height, checks: results, errors, layouts }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', close)
    await browser?.close().catch(() => {})
    running--
  }
}
