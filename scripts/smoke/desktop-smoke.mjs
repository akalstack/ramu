// One startup check for the built desktop app; no UI workflow suite.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
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
    await new Promise((done) => {
      const req = request({ socketPath, path: '/invoke', method: 'POST' }, (res) => {
        res.resume()
        res.on('end', done)
      })
      req.on('error', done)
      req.setTimeout(3_000, () => req.destroy())
      req.end(JSON.stringify({ method: 'background.stop', args: [] }))
    })
    await delay(300)
    rmSync(dir, { recursive: true, force: true })
  }
})
