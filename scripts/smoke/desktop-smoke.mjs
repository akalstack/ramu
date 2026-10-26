/* global document, window, parent */
// One startup check for the built desktop app; no UI workflow suite.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { _electron as electron } from 'playwright-core'

const root = resolve(import.meta.dirname, '../..')
const output = join(root, 'output/desktop-smoke')

test('desktop shell starts without fatal errors', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ramu-smoke-')))
  const profile = join(dir, 'profile')
  const socketPath = join(
    tmpdir(),
    `ramu-${process.getuid()}-${createHash('sha256').update(profile).digest('hex').slice(0, 20)}.sock`,
  )
  const env = {
    ...process.env,
    RAMU_USER_DATA: profile,
    RAMU_WORKTREES: join(dir, 'worktrees'),
    RAMU_FAKE_AGENT: '1',
    RAMU_E2E_HEADLESS: '1',
  }
  delete env.ELECTRON_RENDERER_URL
  delete env.ELECTRON_RUN_AS_NODE
  const errors = []
  let app
  let page
  let logs = ''
  rmSync(output, { recursive: true, force: true })
  try {
    app = await electron.launch({
      ...(env.RAMU_PACKAGED_EXECUTABLE
        ? { executablePath: env.RAMU_PACKAGED_EXECUTABLE, args: [] }
        : { args: [join(root, 'apps/desktop')] }),
      cwd: join(root, 'apps/desktop'),
      env,
      timeout: 30_000,
    })
    for (const stream of [app.process().stdout, app.process().stderr]) {
      stream?.on('data', (chunk) => (logs += chunk.toString()))
    }
    app.on('window', (window) => window.on('pageerror', (error) => errors.push(error.message)))
    page = await app.firstWindow({ timeout: 15_000 })
    await page.waitForSelector('.shell', { state: 'attached', timeout: 15_000 })
    await delay(8_000)
    // The built local preview must boot its own editor/worker realm without a workspace bridge.
    await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const frame = document.createElement('iframe')
          frame.name = 'theme-startup-preview'
          frame.sandbox = 'allow-scripts allow-same-origin'
          frame.style.cssText = 'position:fixed;inset:0;width:800px;height:240px'
          frame.src = 'ramu-theme://preview/theme-editor.html#startup-check'
          const roles = [
            'window',
            'canvas',
            'raised',
            'subtle',
            'bubble',
            'codeBackground',
            'text',
            'textBody',
            'soft',
            'muted',
            'placeholder',
            'primary',
            'primaryHover',
            'primaryInk',
            'accent',
            'ok',
            'warn',
            'bad',
          ]
          const variant = {
            overlay: 'black',
            colors: {
              ...Object.fromEntries(roles.map((role) => [role, '#445566'])),
              canvas: '#fafafa',
              textBody: '#222222',
            },
          }
          const send = (view, request) =>
            frame.contentWindow.postMessage(
              {
                ramuThemePreview: 1,
                instance: 'startup-check',
                type: 'update',
                request,
                appearance: 'light',
                view,
                split: true,
                variant,
              },
              '*',
            )
          const timeout = setTimeout(() => {
            window.removeEventListener('message', receive)
            reject(new Error('Local theme editor did not start'))
          }, 20000)
          function receive(event) {
            if (event.source !== frame.contentWindow || event.data?.instance !== 'startup-check') return
            if (event.data.type === 'ready') send('code', 1)
            if (event.data.type === 'error') {
              clearTimeout(timeout)
              window.removeEventListener('message', receive)
              reject(new Error('Local theme editor failed'))
            }
            if (event.data.type === 'applied' && event.data.request === 1) send('diff', 2)
            if (event.data.type === 'applied' && event.data.request === 2) {
              clearTimeout(timeout)
              window.removeEventListener('message', receive)
              resolve()
            }
          }
          frame.onload = () => send('code', 1)
          window.addEventListener('message', receive)
          document.body.append(frame)
        }),
    )
    const preview = page.frame({ name: 'theme-startup-preview' })
    assert.ok(preview, 'Local theme preview frame is missing')
    await preview.waitForSelector('.monaco-diff-editor .char-insert', { state: 'attached', timeout: 10000 })
    assert.deepEqual(
      await preview.evaluate(() => {
        let parentAccess = false
        try {
          parentAccess = Boolean(parent.ramu)
        } catch {}
        return { bridge: typeof window.ramu, parentAccess }
      }),
      { bridge: 'undefined', parentAccess: false },
    )
    await page.locator('iframe[name="theme-startup-preview"]').evaluate((frame) => frame.remove())
    assert.equal(app.process().exitCode, null, 'Electron exited during startup')
    assert.equal(page.isClosed(), false, 'The desktop window closed during startup')
    assert.deepEqual(errors, [], 'Renderer errors during startup')
    assert.doesNotMatch(
      logs,
      /Cannot find module|MODULE_NOT_FOUND|Refused to execute|Uncaught (?:Error|TypeError|ReferenceError)/,
    )
  } catch (error) {
    mkdirSync(output, { recursive: true })
    await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
    try {
      logs += '\nBackground service:\n' + readFileSync(join(profile, 'background.log'), 'utf8')
    } catch {}
    writeFileSync(join(output, 'startup.log'), `${error.stack}\n${errors.join('\n')}\n${logs}`)
    throw error
  } finally {
    if (app) {
      const forced = setTimeout(() => app.process().kill('SIGKILL'), 5_000)
      try {
        await app.close().catch(() => {})
      } finally {
        clearTimeout(forced)
      }
    }
    // Closing the desktop leaves its service running; stop only this disposable profile's service.
    // The service speaks only its WebSocket: ask it to stop with one call, then leave.
    await new Promise((done) => {
      const WebSocket = createRequire(join(root, 'packages/client-runtime/package.json'))('ws')
      const ws = new WebSocket(`ws+unix://${socketPath}:/socket`)
      const give = setTimeout(() => (ws.terminate(), done()), 3_000)
      const finish = () => (clearTimeout(give), done())
      ws.on('error', finish)
      ws.on('close', finish)
      ws.on('message', (data) => {
        const frame = JSON.parse(data.toString())
        if (frame.t === 'ready') ws.send(JSON.stringify({ t: 'invoke', id: 1, method: 'background.stop', args: [] }))
        else if (frame.t === 'result' || frame.t === 'error') ws.close()
      })
    })
    await delay(300)
    rmSync(dir, { recursive: true, force: true })
  }
})
