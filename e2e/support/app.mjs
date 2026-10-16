// The one launcher every spec uses: an isolated profile, simulated providers, hidden windows, and an API client for
// the workspace server's local socket. Specs never import playwright-core or spawn Electron themselves.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, test } from 'node:test'
import { _electron as electron } from 'playwright-core'
import { createRepo, sleep, until } from './util.mjs'

const root = resolve(import.meta.dirname, '..', '..')
export const appDir = process.env.RAMU_E2E_APP_DIR
  ? resolve(process.env.RAMU_E2E_APP_DIR)
  : join(root, 'apps', 'desktop')
export const outputDir = process.env.RAMU_E2E_SCREENSHOTS
  ? resolve(process.env.RAMU_E2E_SCREENSHOTS)
  : join(root, 'e2e', 'output')
/** `RAMU_E2E_HEADED=1` shows the windows; otherwise they stay hidden and never take focus. */
export const headed = process.env.RAMU_E2E_HEADED === '1'
export const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

// Monaco's own teardown noise: a cancelled token firing on dispose, and the inline-edit gutter animating after it is torn down.
const MONACO_NOISE = /^(Canceled|Make sure the ref is set before accessing the element)/

/** Calls a workspace server method over its local socket, so it works before the window exists and while the app is closed. */
export const socketInvoke = (socketPath, method, ...args) =>
  new Promise((resolve, reject) => {
    const req = request({ socketPath, path: '/invoke', method: 'POST' }, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          const response = JSON.parse(data)
          response.error ? reject(new Error(response.error)) : resolve(response.value)
        } catch (error) {
          reject(error)
        }
      })
    })
    req.on('error', reject)
    req.end(JSON.stringify({ method, args }))
  })

/** The socket the desktop app's server listens on for a given profile (mirrors `runtimeSocket` in @ramu/client-runtime). */
export const profileSocket = (profile) =>
  join(tmpdir(), `ramu-${process.getuid()}-${createHash('sha256').update(profile).digest('hex').slice(0, 20)}.sock`)

/**
 * Prepares a disposable app profile and returns a handle for one spec file:
 *
 *   const ramu = await startRamu('settings')
 *   ramu.test('does a thing', async () => { await ramu.page.click(...) })
 *
 * `ramu.test` registers a node:test case; after the first failure the remaining cases are skipped (a spec is a
 * journey, so later steps depend on earlier ones) and a failure screenshot, renderer errors and the server log are
 * saved under `e2e/output/<name>/`. The app is closed and the temp directory removed when the file finishes.
 *
 * Options: `launch: false` to prepare only (call `ramu.launch()` later), `env` for extra app environment (an object, or a
 * function of `{ dir, profile }` when a value depends on the temp directory), `repos` ({ key: files | [files, options] })
 * to create repositories under `ramu.dir` before launch.
 */
export async function startRamu(name, { launch = true, env = {}, repos = {} } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `ramu-e2e-${name}-`)))
  const profile = join(dir, 'profile')
  const shots = join(outputDir, name)
  mkdirSync(shots, { recursive: true })
  const appEnv = {
    ...process.env,
    RAMU_USER_DATA: profile,
    RAMU_WORKTREES: join(dir, 'worktrees'),
    RAMU_FAKE_AGENT: '1',
    ...(headed ? {} : { RAMU_E2E_HEADLESS: '1' }),
    ...(typeof env === 'function' ? env({ dir, profile }) : env),
  }
  // Electron must not run as plain Node, and the renderer must come from the build, not a dev server.
  delete appEnv.ELECTRON_RENDERER_URL
  delete appEnv.ELECTRON_RUN_AS_NODE
  const socketPath = profileSocket(profile)
  let failed = false
  let lastStep = 'start'
  // `ramu.app` and `ramu.page` always point at the current window, so `const { page } = ramu` survives a relaunch.
  const live = { app: null, page: null }
  const follow = (key) =>
    new Proxy(
      {},
      {
        get(_, property) {
          const target = live[key]
          if (!target) throw new Error(`The app is not running (ramu.${key}); call ramu.launch() first`)
          const value = target[property]
          return typeof value === 'function' ? value.bind(target) : value
        },
      },
    )

  const ramu = {
    name,
    dir,
    profile,
    shots,
    socketPath,
    app: follow('app'),
    page: follow('page'),
    /** Renderer exceptions since launch (Monaco noise filtered). Assert `ramu.noErrors()` at the end of a spec. */
    errors: [],
    consoleErrors: [],
    repos: {},
    api: (method, ...args) => socketInvoke(socketPath, method, ...args),
    until,
    sleep,
    check(value, message) {
      assert.ok(value, message)
      lastStep = message
      console.log(`ok - ${message}`)
    },
    noErrors() {
      assert.deepEqual(ramu.errors, [], `Renderer errors: ${ramu.errors.join(' | ')}`)
    },
    async launch() {
      const packaged = process.env.RAMU_PACKAGED_EXECUTABLE
      ramu.errors = []
      ramu.consoleErrors = []
      live.app = await electron.launch({
        ...(packaged ? { executablePath: packaged, args: [] } : { args: [appDir] }),
        cwd: appDir,
        env: appEnv,
        timeout: 30_000,
      })
      const page = (live.page = await live.app.firstWindow())
      page.on('pageerror', (e) => {
        if (!MONACO_NOISE.test(e.message)) ramu.errors.push(`[after: ${lastStep}] ${e.message}`)
      })
      page.on('console', (m) => m.type() === 'error' && ramu.consoleErrors.push(m.text()))
      // A hidden window is never focused; make the page believe it is so focus-gated code (polling, shortcuts) runs.
      if (!headed)
        await (await page.context().newCDPSession(page)).send('Emulation.setFocusEmulationEnabled', { enabled: true })
      await page.waitForSelector('.shell', { timeout: 20_000 })
      return page
    },
    /** Closes the window; the background server keeps running, as it does when a user quits the app. */
    async closeApp() {
      const app = live.app
      live.app = live.page = null
      if (!app) return
      // Quitting can stall (for example with the local service stopped under a connected paired computer); don't let
      // that keep the test process alive forever.
      const forced = setTimeout(() => app.process().kill('SIGKILL'), 15_000)
      await app.close().catch(() => {})
      clearTimeout(forced)
    },
    /** Quits and reopens the app against the same profile, optionally after `between()` ran with the app closed. */
    async relaunch(between) {
      await ramu.closeApp()
      await between?.()
      return ramu.launch()
    },
    /** Reloads the renderer and waits for the shell. */
    async reload() {
      await ramu.page.reload()
      await ramu.page.waitForSelector('.shell')
    },
    shot: (file) =>
      live.page.screenshot({ path: join(shots, file.endsWith('.png') ? file : `${file}.png`), animations: 'disabled' }),
    /** Creates `ramu.repos[key]` for each fixture: files plus Git options, under `ramu.dir`. */
    repo(key, files, options) {
      return (ramu.repos[key] = createRepo(join(dir, key), files, options))
    },
    test(title, fn) {
      return test(title, async (t) => {
        if (failed) return t.skip('an earlier step failed')
        try {
          await fn(ramu)
        } catch (error) {
          failed = true
          await ramu.diagnose(error)
          throw error
        }
      })
    },
    async diagnose(error) {
      console.error(`Failure after "${lastStep}":`, error?.message)
      console.error('Renderer errors:', ramu.errors, 'Console errors:', ramu.consoleErrors.slice(-10))
      await live.page?.screenshot({ path: join(shots, 'failure.png') }).catch(() => {})
      console.error(
        await live.page
          ?.locator('body')
          .innerText()
          .catch(() => 'No renderer'),
      )
      try {
        console.error(readFileSync(join(profile, 'background.log'), 'utf8').slice(-4000))
      } catch {}
    },
    async close() {
      await ramu.closeApp()
      await ramu.api('background.stop').catch(() => {})
      await sleep(300)
      rmSync(dir, { recursive: true, force: true })
    },
  }
  for (const [key, spec] of Object.entries(repos)) ramu.repo(key, ...(Array.isArray(spec) ? spec : [spec]))
  after(() => ramu.close())
  if (launch)
    await ramu.launch().catch(async (error) => {
      await ramu.close()
      throw error
    })
  return ramu
}
