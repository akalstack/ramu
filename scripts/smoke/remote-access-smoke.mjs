// Remote access in the real desktop app: turn on network access, pair a device, revoke it, then pair this app with a
// second server and switch between live computer views. Isolated profiles, no model calls.
// Run after pnpm build: node scripts/smoke/remote-access-smoke.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import { _electron as electron } from 'playwright-core'

const root = resolve(import.meta.dirname, '..', '..'),
  appDir = join(root, 'apps', 'desktop')
const dir = mkdtempSync(join(tmpdir(), 'ramu-remote-'))
const shots = join(appDir, 'output', 'playwright', 'remote-access')
mkdirSync(shots, { recursive: true })
const base = { ...process.env, RAMU_FAKE_AGENT: '1', RAMU_WORKTREES: join(dir, 'worktrees') }
delete base.ELECTRON_RENDERER_URL
const log = (message) => console.log(`ok - ${message}`)
const errors = []
let app, page, host, secondHost

const hostProfile = join(dir, 'host'),
  hostSocket = join(dir, 'h.sock')
const startHost = async () => {
  host = spawn(process.execPath, [join(root, 'apps/server/dist/cli.js'), 'serve'], {
    env: { ...base, RAMU_USER_DATA: hostProfile, RAMU_SOCKET: hostSocket },
    stdio: 'ignore',
  })
  for (let i = 0; i < 60; i++) {
    if (
      await hostInvoke('background.status').then(
        () => true,
        () => false,
      )
    )
      return
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error('host server did not start')
}
const hostInvoke = (method, ...args) => socketInvoke(hostSocket, method, ...args)
const socketInvoke = (socketPath, method, ...args) =>
  new Promise((resolve, reject) => {
    const req = httpRequest({ socketPath, path: '/invoke', method: 'POST' }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString())
          body.error ? reject(new Error(body.error)) : resolve(body.value)
        } catch (e) {
          reject(e)
        }
      })
    })
    req.on('error', reject)
    req.end(JSON.stringify({ method, args }))
  })

const profile = join(dir, 'app')
const launch = async () => {
  app = await electron.launch({
    args: [appDir],
    cwd: appDir,
    env: { ...base, RAMU_USER_DATA: profile },
    timeout: 30_000,
  })
  page = await app.firstWindow()
  page.on('pageerror', (e) => {
    if (!/^(Canceled|Make sure the ref is set)/.test(e.message)) errors.push(e.message)
  })
  await page.waitForSelector('.shell', { timeout: 20_000 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
}
const invoke = (method, ...args) =>
  page.evaluate(({ method, args }) => window.ramu.invoke(method, ...args), { method, args })
const openRemote = async () => {
  await invoke('computers.open', 'local')
  await page.evaluate(() => window.dispatchEvent(new Event('ramu:settings')))
  await page.locator('.settings-page').waitFor()
  await page.locator('.settings-navigation').getByRole('button', { name: 'Remote access' }).click()
  await page.getByText('Let other devices connect').waitFor()
}
const expect = async (check, timeout = 10_000) => {
  const end = Date.now() + timeout
  for (;;) {
    try {
      return await check()
    } catch (error) {
      if (Date.now() > end) throw error
      await new Promise((r) => setTimeout(r, 200))
    }
  }
}
const shot = (name) => page.screenshot({ path: join(shots, `${name}.png`) })

try {
  await startHost()
  await launch()
  assert.equal(
    await page.locator('.workspace-computer-indicator').count(),
    0,
    'local workspace has no remote indicator',
  )
  await invoke('settings.app.set', { ...(await invoke('settings.app.get')), language: 'en', recapsEnabled: false })
  await page.reload()
  await page.waitForSelector('.shell')

  // --- This computer: allow devices, pair one, revoke it.
  await openRemote()
  await shot('01-off')
  assert.equal((await invoke('network.status')).enabled, false)
  // A port of our own, so a real Ramu on 7788 cannot interfere.
  await page.getByRole('textbox', { name: 'Port' }).fill('47810')
  await page.getByRole('switch', { name: 'Allow other devices' }).click()
  await page.getByRole('alertdialog').getByText('Ramu does not encrypt this connection').waitFor()
  await shot('02-confirm')
  await page.getByRole('button', { name: 'Turn on' }).click()
  await page.getByText(/^Listening on /).waitFor({ timeout: 10_000 })
  await shot('03-on')
  log('network access turns on from Settings and starts listening')

  await page.getByRole('button', { name: 'Pair a device…' }).click()
  const code = (await page.getByText(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/).textContent()).trim()
  assert.match(code, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/)
  await shot('04-pair-dialog')
  const status = await invoke('network.status')
  const pairUrl = `http://127.0.0.1:${status.port}`
  const paired = await fetch(`${pairUrl}/pair`, {
    method: 'POST',
    body: JSON.stringify({ code, name: 'Smoke phone' }),
  }).then((r) => r.json())
  assert.ok(paired.token)
  await page.getByText('Smoke phone is paired').waitFor({ timeout: 10_000 })
  await shot('05-paired')
  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByText('Smoke phone', { exact: true }).waitFor()
  await shot('06-devices')
  log('a pairing code pairs a device and the dialog notices')

  const statusOf = (token) =>
    fetch(`${pairUrl}/invoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ method: 'background.status', args: [] }),
    }).then((r) => r.status)
  assert.equal(await statusOf(paired.token), 200)
  await page.getByRole('button', { name: 'Revoke' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Revoke' }).click()
  await page.getByText('No devices paired yet.').waitFor()
  assert.equal(await statusOf(paired.token), 401)
  log('revoking stops the device immediately')

  await page.getByRole('switch', { name: 'Allow other devices' }).click()
  await page.getByText(/^Listening on /).waitFor({ state: 'detached', timeout: 10_000 })
  assert.equal(
    await fetch(`${pairUrl}/health`).then(
      (r) => r.status,
      () => 0,
    ),
    0,
  )
  log('turning access off closes the port')

  // --- Computers: the second server is the host. Pair it from the UI; both stay connected at once.
  await hostInvoke('network.configure', { enabled: true, host: '127.0.0.1', port: 47811, acceptUnencrypted: false })
  await new Promise((r) => setTimeout(r, 800))
  const offer = await hostInvoke('network.pair')
  assert.equal(await page.locator('.computer-switcher').count(), 0, 'no switcher until a second computer is paired')
  await page.getByPlaceholder('Address, for example 100.64.0.7:7788').fill('127.0.0.1:47811')
  await page.getByPlaceholder('Pairing code').fill(offer.code)
  await page.getByPlaceholder('Name (optional)').fill('Studio')
  await shot('07-connect-form')
  await page.getByRole('button', { name: 'Pair', exact: true }).click()
  await page.getByText('http://127.0.0.1:47811').waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Open', exact: true }).waitFor({ timeout: 10_000 })
  await shot('08-computers')
  const list = await invoke('computers.list')
  assert.deepEqual(
    list.computers.map((c) => [c.local, c.status]),
    [
      [true, 'connected'],
      [false, 'connected'],
    ],
  )
  assert.equal(list.current, 'local')
  assert.ok(!JSON.stringify(list).includes('token'))
  assert.equal((await hostInvoke('network.status')).devices.length, 1)
  assert.ok(
    !readFileSync(join(profile, 'remote-servers.json'), 'utf8').match(/[a-f0-9]{64}/),
    'token must not be stored in plain text',
  )
  log(
    'pairing from the app adds a computer that stays connected, with its token out of the renderer and out of plain text',
  )

  // A host restart announces availability after the client has finished its quick retry window.
  assert.ok(readFileSync(join(hostProfile, 'presence.json'), 'utf8').includes('127.0.0.1'))
  host.kill('SIGTERM')
  await expect(async () => assert.equal((await invoke('computers.list')).computers[1].status, 'offline'))
  await new Promise((resolve) => setTimeout(resolve, 9000))
  await startHost()
  await expect(async () => assert.equal((await invoke('computers.list')).computers[1].status, 'connected'))
  log('a signed startup announcement wakes an offline computer without periodic checks')

  // Manage a second remote environment independently while Studio remains connected.
  const secondSocket = join(dir, 's.sock')
  secondHost = spawn(
    process.execPath,
    [join(root, 'apps/server/dist/cli.js'), 'serve', '--listen', '127.0.0.1:47812'],
    { env: { ...base, RAMU_USER_DATA: join(dir, 'second'), RAMU_SOCKET: secondSocket }, stdio: 'ignore' },
  )
  await expect(async () => assert.equal((await socketInvoke(secondSocket, 'background.status')).running, true))
  const secondOffer = await socketInvoke(secondSocket, 'network.pair')
  await page.getByRole('button', { name: 'Add a computer', exact: true }).click()
  await page.getByPlaceholder('Address, for example 100.64.0.7:7788').fill('127.0.0.1:47812')
  await page.getByPlaceholder('Pairing code').fill(secondOffer.code)
  await page.getByPlaceholder('Name (optional)').fill('Server')
  await page.getByRole('button', { name: 'Pair', exact: true }).click()
  await expect(async () =>
    assert.deepEqual(
      (await invoke('computers.list')).computers.map((c) => c.status),
      ['connected', 'connected', 'connected'],
    ),
  )
  await page.getByRole('button', { name: 'Manage Server', exact: true }).click()
  const settings = page.getByRole('dialog')
  await settings.getByRole('textbox', { name: 'Computer name' }).fill('Build server')
  await settings.getByRole('switch', { name: 'Keep connected' }).click()
  await shot('08-connection-settings')
  await settings.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(async () =>
    assert.deepEqual(
      (await invoke('computers.list')).computers.map((c) => c.status),
      ['connected', 'connected', 'paused'],
    ),
  )
  const card = page.getByRole('article', { name: 'Build server', exact: true })
  await card.getByRole('button', { name: 'Resume', exact: true }).click()
  await expect(async () =>
    assert.deepEqual(
      (await invoke('computers.list')).computers.map((c) => c.status),
      ['connected', 'connected', 'connected'],
    ),
  )
  await shot('08-multiple-computers')
  log('three environments stay connected; renaming, pausing and resuming one leaves the others connected')
  await card.getByRole('button', { name: 'Forget', exact: true }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Forget', exact: true }).click()
  await expect(async () => assert.equal((await invoke('computers.list')).computers.length, 2))

  // The switcher appears once there are two computers. Settings is modal, so close it first.
  await page.keyboard.press('Escape')
  await page.locator('.settings-page').waitFor({ state: 'detached' })
  await page.locator('.computer-switcher').waitFor({ timeout: 10_000 })
  await shot('09-switcher')
  await page.locator('.computer-switcher').click()
  await page.getByRole('menuitemradio', { name: /Studio/ }).waitFor()
  await shot('10-switcher-open')

  // --- Open it: a second window, its own server, this computer's window untouched.
  const hostPid = (await hostInvoke('background.status')).pid,
    localPid = (await invoke('background.status')).pid
  assert.notEqual(hostPid, localPid)
  await page.getByRole('menuitemradio', { name: /Studio/ }).click()
  await expect(async () => assert.equal(app.windows().length, 2))
  const remote = app.windows().find((w) => w !== page)
  remote.on('pageerror', (e) => {
    if (!/^(Canceled|Make sure the ref is set)/.test(e.message)) errors.push(e.message)
  })
  await remote.waitForSelector('.shell', { timeout: 30_000 })
  const call = (target, method, ...args) =>
    target.evaluate(
      ({ method, args }) =>
        window.ramu.invoke(method, ...args).then(
          (value) => ({ value }),
          (error) => ({ error: error.message }),
        ),
      { method, args },
    )
  assert.equal(
    (await call(remote, 'background.status')).value.pid,
    hostPid,
    'the second window talks to the paired computer',
  )
  assert.equal(
    (await call(page, 'background.status')).value.pid,
    localPid,
    'this computer’s window still talks to this computer',
  )
  await remote.locator('.computer-switcher').getByText('Studio').waitFor()
  await remote.locator('.workspace-computer-indicator').getByText('Remote', { exact: true }).waitFor()
  await remote.locator('.workspace-computer-indicator').getByText('Studio', { exact: true }).waitFor()
  assert.match(
    await remote.locator('.workspace-computer-indicator').getAttribute('title'),
    /Files, terminals and agents run on that computer/,
  )
  await remote.emulateMedia({ reducedMotion: 'reduce' })
  await remote.screenshot({ path: join(shots, '11-studio-window.png') })
  await remote.getByRole('button', { name: 'Hide sidebar', exact: true }).click()
  await remote.locator('.shell.no-sidebar').waitFor()
  assert.equal(
    await remote.locator('.workspace-computer-indicator').isVisible(),
    true,
    'remote origin stays visible with the sidebar hidden',
  )
  await remote.screenshot({ path: join(shots, '11-studio-sidebar-hidden.png') })
  await remote.getByRole('button', { name: 'Show sidebar', exact: true }).click()
  log('opening a computer shows its own window; the local window keeps its own server')

  // Host-only controls and desktop dialogs stay off a paired computer's window.
  assert.match((await call(remote, 'network.status')).error, /managed from the computer running Ramu/)
  assert.match((await call(remote, 'background.restart')).error, /Not available while connected/)
  assert.match((await call(remote, 'repos.pick', 'project')).error, /not available from another computer/)
  assert.match((await call(remote, 'attachments.save', 'x')).error, /Not available while connected/)
  log('a paired computer’s window cannot open host dialogs, restart services or change network access')

  // Each window keeps its own browser storage.
  await remote.evaluate(() => localStorage.setItem('probe', 'studio'))
  assert.equal(await page.evaluate(() => localStorage.getItem('probe')), null)
  log('each computer has its own storage')

  // Switch back through the switcher in the remote window.
  await remote.locator('.computer-switcher').click()
  await remote.getByRole('menuitemradio', { name: /This computer/ }).click()
  await page.waitForFunction(() => document.hasFocus(), null, { timeout: 5_000 }).catch(() => {})
  const visible = () =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.length)
  await expect(async () => assert.equal(await visible(), 0))
  const back = await call(remote, 'computers.list')
  assert.equal(back.value.current, list.computers[1].id)
  await page
    .getByText(/This computer/)
    .first()
    .waitFor()
  log('switching back and forth keeps both windows alive')

  // --- Revoke on the host: the client must stop, show Pair again, and not lock itself out by retrying.
  await invoke('computers.open', list.computers[1].id)
  const deviceId = (await hostInvoke('network.status')).devices[0].id
  await hostInvoke('network.revoke', deviceId)
  await expect(async () => assert.equal((await invoke('computers.list')).computers[1].status, 'rejected'), 20_000)
  await remote.locator('.workspace-computer-indicator').getByText('Pair again', { exact: true }).waitFor()
  assert.equal(
    await remote.locator('.status-activity').count(),
    0,
    'offline background retries do not show an activity spinner',
  )
  await shot('12-rejected')
  assert.match(
    await invoke('computers.open', list.computers[1].id).then(
      () => '',
      (e) => e.message,
    ),
    /no longer accepts/,
  )
  const offer2 = await hostInvoke('network.pair')
  const repaired = await fetch('http://127.0.0.1:47811/pair', {
    method: 'POST',
    body: JSON.stringify({ code: offer2.code, name: 'again' }),
  })
  assert.equal(repaired.status, 200, 'a revoked device that stopped retrying can pair again')
  log('a revoked computer shows Pair again, stops retrying and can be paired again')

  // --- Forget closes its window and goes back to this computer.
  await openRemote()
  await page.getByRole('button', { name: 'Forget' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Forget' }).click()
  await expect(async () => assert.equal((await invoke('computers.list')).computers.length, 1))
  await expect(async () => assert.equal(app.windows().length, 1))
  await page.keyboard.press('Escape')
  await page.locator('.settings-page').waitFor({ state: 'detached' })
  await page.locator('.computer-switcher').waitFor({ state: 'detached' })
  log('forgetting a computer closes its window and removes the switcher')
  await shot('13-forgotten')

  // Re-pair an address while its old workspace is visible: the old view and storage must be released.
  const offer3 = await hostInvoke('network.pair')
  const added = await invoke('computers.pair', '127.0.0.1:47811', offer3.code, 'Studio')
  const oldId = added.computers.find((c) => !c.local).id
  await expect(async () => assert.equal((await invoke('computers.list')).computers[1].status, 'connected'))
  await invoke('computers.open', oldId)
  await expect(async () => assert.equal(app.windows().length, 2))
  const oldView = app.windows().find((w) => w !== page)
  await oldView.waitForSelector('.shell')
  const offer4 = await hostInvoke('network.pair')
  const replaced = await invoke('computers.pair', '127.0.0.1:47811', offer4.code, 'Studio again')
  const newId = replaced.computers.find((c) => !c.local).id
  assert.notEqual(newId, oldId)
  await expect(async () => assert.equal(app.windows().length, 1))
  assert.equal(await visible(), 0)
  log('pairing the same address again releases its old workspace and returns to this computer')

  // Even with the local service offline, forgetting the visible remote computer must return to local controls.
  await expect(async () => assert.equal((await invoke('computers.list')).computers[1].status, 'connected'))
  await invoke('computers.open', newId)
  await expect(async () => assert.equal(app.windows().length, 2))
  await invoke('background.stop')
  await expect(async () => assert.equal((await invoke('computers.list')).computers[0].status, 'offline'))
  await invoke('computers.forget', newId)
  await expect(async () => assert.equal(app.windows().length, 1))
  assert.equal(await visible(), 0)
  log('forgetting the visible computer still works when the local service is offline')
} catch (error) {
  await page?.screenshot({ path: join(shots, 'failure.png') }).catch(() => {})
  console.error(error)
  process.exitCode = 1
} finally {
  // The app starts a background server that outlives the window; stop it so nothing is left running.
  await page?.evaluate(() => window.ramu.invoke('background.stop')).catch(() => {})
  await app?.close().catch(() => {})
}
host?.kill()
secondHost?.kill()
await new Promise((r) => setTimeout(r, 500))
rmSync(dir, { recursive: true, force: true })
if (errors.length) {
  console.error('page errors:', errors)
  process.exitCode = 1
}
if (!process.exitCode) console.log('remote access smoke passed')
