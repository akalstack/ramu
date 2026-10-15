// Remote access in the real desktop app: turn on network access, pair a device, revoke it, then pair this app with other
// standalone servers and switch between live computer views. Isolated profiles, no model calls.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { freePort, openSettings, startRamu, startServer } from '../support/index.mjs'

const ramu = await startRamu('remote-access')
const { page } = ramu
const invoke = (method, ...args) =>
  ramu.page.evaluate(({ method, args }) => window.ramu.invoke(method, ...args), { method, args })
const call = (target, method, ...args) =>
  target.evaluate(
    ({ method, args }) =>
      window.ramu.invoke(method, ...args).then(
        (value) => ({ value }),
        (error) => ({ error: error.message }),
      ),
    { method, args },
  )
const statuses = async () => (await invoke('computers.list')).computers.map((c) => c.status)
const forgetDialog = () => ramu.page.getByRole('alertdialog').getByRole('button', { name: 'Forget', exact: true })
const addressField = () => ramu.page.getByPlaceholder('Address, for example 100.64.0.7:7788')
/** Pairs this app with `server` through the Computers form. */
async function pairFromForm(server, name) {
  const offer = await server.invoke('network.pair')
  await addressField().fill(`127.0.0.1:${server.port}`)
  await ramu.page.getByPlaceholder('Pairing code').fill(offer.code)
  await ramu.page.getByPlaceholder('Name (optional)').fill(name)
  await ramu.page.getByRole('button', { name: 'Pair', exact: true }).click()
}
const openRemote = async () => {
  await invoke('computers.open', 'local')
  await openSettings(ramu, 'Remote access')
  await page.getByText('Let other devices connect').waitFor()
}
const openWindows = () => ramu.app.windows().length
const hiddenViews = () =>
  ramu.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.length)

let host, remote, studioId, hostPid, localPid, listUrl

ramu.test('this computer has no remote origin until a second computer is paired', async () => {
  assert.equal(await page.locator('.computer-switcher').count(), 0)
  await invoke('settings.app.set', { ...(await invoke('settings.app.get')), language: 'en', recapsEnabled: false })
  await ramu.reload()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  ramu.check(true, 'local workspace has no switcher')
})

ramu.test('network access turns on from Settings, pairs a device and revokes it', async () => {
  await openRemote()
  assert.equal((await invoke('network.status')).enabled, false)
  // A port of our own, so a real Ramu on 7788 cannot interfere.
  await page.getByRole('textbox', { name: 'Port' }).fill(String(await freePort()))
  await page.getByRole('switch', { name: 'Allow other devices' }).click()
  await page.getByRole('alertdialog').getByText('Ramu does not encrypt this connection').waitFor()
  await page.getByRole('button', { name: 'Turn on' }).click()
  await page.getByText(/^Listening on /).waitFor()
  ramu.check(true, 'network access turns on from Settings and starts listening')

  await page.getByRole('button', { name: 'Pair a device…' }).click()
  const code = (await page.getByText(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/).textContent()).trim()
  const pairUrl = `http://127.0.0.1:${(await invoke('network.status')).port}`
  const paired = await fetch(`${pairUrl}/pair`, {
    method: 'POST',
    body: JSON.stringify({ code, name: 'Smoke phone' }),
  }).then((r) => r.json())
  assert.ok(paired.token)
  await page.getByText('Smoke phone is paired').waitFor()
  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByText('Smoke phone', { exact: true }).waitFor()
  ramu.check(true, 'a pairing code pairs a device and the dialog notices')

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
  ramu.check(true, 'revoking stops the device immediately')

  await page.getByRole('switch', { name: 'Allow other devices' }).click()
  await page.getByText(/^Listening on /).waitFor({ state: 'detached' })
  assert.equal(
    await fetch(`${pairUrl}/health`).then(
      (r) => r.status,
      () => 0,
    ),
    0,
  )
  ramu.check(true, 'turning access off closes the port')
})

ramu.test(
  'pairing from the app adds a computer that stays connected, token out of the renderer and plain text',
  async () => {
    host = await startServer({ name: 'host', dir: ramu.dir, listen: true })
    assert.equal(await page.locator('.computer-switcher').count(), 0, 'no switcher until a second computer is paired')
    await pairFromForm(host, 'Studio')
    await page.getByText(host.url).waitFor()
    await page.getByRole('button', { name: 'Open', exact: true }).waitFor()
    const list = await invoke('computers.list')
    assert.deepEqual(
      list.computers.map((c) => [c.local, c.status]),
      [
        [true, 'connected'],
        [false, 'connected'],
      ],
    )
    assert.equal(list.current, 'local')
    studioId = list.computers[1].id
    assert.ok(!JSON.stringify(list).includes('token'))
    assert.equal((await host.invoke('network.status')).devices.length, 1)
    assert.ok(
      !readFileSync(join(ramu.profile, 'remote-servers.json'), 'utf8').match(/[a-f0-9]{64}/),
      'token must not be stored in plain text',
    )
    ramu.check(true, 'paired computer stays connected; its token is out of the renderer and out of plain text')
  },
)

ramu.test('a signed startup announcement wakes an offline computer without periodic checks', async () => {
  assert.ok(readFileSync(join(host.profile, 'presence.json'), 'utf8').includes('127.0.0.1'))
  await host.stop()
  await ramu.until(async () => (await statuses())[1] === 'offline', 'computer never went offline', { attempts: 100 })
  // The announcement only lands after the client has finished its quick retry window.
  await ramu.sleep(9000)
  await host.start()
  await ramu.until(async () => (await statuses())[1] === 'connected', 'computer never reconnected', { attempts: 150 })
  ramu.check(true, 'restarted host announces itself and reconnects')
})

ramu.test('several computers stay connected; renaming, pausing and resuming one leaves the others', async () => {
  const second = await startServer({ name: 'second', dir: ramu.dir, listen: true })
  await page.getByRole('button', { name: 'Add a computer', exact: true }).click()
  await pairFromForm(second, 'Server')
  await ramu.until(
    async () => (await statuses()).join() === 'connected,connected,connected',
    'three computers never connected',
  )
  await page.getByRole('button', { name: 'Manage Server', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: 'Computer name' }).fill('Build server')
  await dialog.getByRole('switch', { name: 'Keep connected' }).click()
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await ramu.until(async () => (await statuses()).join() === 'connected,connected,paused', 'computer never paused')
  const card = page.getByRole('article', { name: 'Build server', exact: true })
  await card.getByRole('button', { name: 'Resume', exact: true }).click()
  await ramu.until(async () => (await statuses()).join() === 'connected,connected,connected', 'computer never resumed')
  await ramu.sleep(1500)
  await card.getByRole('button', { name: 'Forget', exact: true }).click()
  await forgetDialog().click()
  await ramu.until(async () => (await invoke('computers.list')).computers.length === 2, 'computer never forgotten')
  ramu.check(true, 'renaming, pausing, resuming and forgetting one computer leaves the others connected')
})

ramu.test('opening a computer shows its own window while this computer keeps its own server', async () => {
  await page.keyboard.press('Escape')
  await page.locator('.settings-page').waitFor({ state: 'detached' })
  await page.locator('.computer-switcher').click()
  hostPid = (await host.invoke('background.status')).pid
  localPid = (await invoke('background.status')).pid
  assert.notEqual(hostPid, localPid)
  await page.getByRole('menuitemradio', { name: /Studio/ }).click()
  await ramu.until(() => openWindows() === 2, 'remote window never opened')
  remote = ramu.app.windows().find((w) => w !== page)
  await remote.waitForSelector('.shell', { timeout: 30_000 })
  assert.equal((await call(remote, 'background.status')).value.pid, hostPid)
  assert.equal((await call(page, 'background.status')).value.pid, localPid)
  const switcher = remote.locator('.computer-switcher')
  await switcher.getByText('Studio', { exact: true }).waitFor()
  await switcher.getByText('Remote', { exact: true }).waitFor()
  ramu.check(true, 'the remote window talks to the paired computer; this window keeps its own server')

  // Host-only controls and desktop dialogs stay off a paired computer's window.
  assert.match((await call(remote, 'network.status')).error, /managed from the computer running Ramu/)
  assert.match((await call(remote, 'background.restart')).error, /Not available while connected/)
  assert.match((await call(remote, 'repos.pick', 'project')).error, /not available from another computer/)
  assert.match((await call(remote, 'attachments.save', 'x')).error, /Not available while connected/)
  ramu.check(true, 'a paired computer’s window cannot open host dialogs, restart services or change network access')

  await remote.evaluate(() => localStorage.setItem('probe', 'studio'))
  assert.equal(await page.evaluate(() => localStorage.getItem('probe')), null)
  ramu.check(true, 'each computer has its own storage')

  await switcher.click()
  await remote.getByRole('menuitemradio', { name: /This computer/ }).click()
  await ramu.until(async () => (await hiddenViews()) === 0, 'remote view never hid')
  assert.equal((await call(remote, 'computers.list')).value.current, studioId)
  ramu.check(true, 'switching back and forth keeps both windows alive')
})

ramu.test('a host-revoked computer shows Pair again, stops retrying and can be paired again', async () => {
  await invoke('computers.open', studioId)
  await host.invoke('network.revoke', (await host.invoke('network.status')).devices[0].id)
  await ramu.until(async () => (await statuses())[1] === 'rejected', 'computer never rejected', { attempts: 200 })
  await remote.locator('.computer-switcher').getByText('Pair again', { exact: false }).first().waitFor()
  assert.equal(await remote.locator('.status-activity').count(), 0, 'rejected retries show no activity spinner')
  const error = await invoke('computers.open', studioId).then(
    () => '',
    (e) => e.message,
  )
  assert.match(error, /no longer accepts/)
  const offer = await host.invoke('network.pair')
  const repaired = await fetch(`${host.url}/pair`, {
    method: 'POST',
    body: JSON.stringify({ code: offer.code, name: 'again' }),
  })
  assert.equal(repaired.status, 200, 'a revoked device that stopped retrying can pair again')
})

ramu.test('forgetting a computer closes its window and removes the switcher', async () => {
  await openRemote()
  await page.getByRole('button', { name: 'Forget' }).click()
  await forgetDialog().click()
  await ramu.until(async () => (await invoke('computers.list')).computers.length === 1, 'computer never forgotten')
  await ramu.until(() => openWindows() === 1, 'remote window never closed')
  await page.keyboard.press('Escape')
  await page.locator('.settings-page').waitFor({ state: 'detached' })
  await page.locator('.computer-switcher').waitFor({ state: 'detached' })
})

ramu.test('pairing the same address again releases its old workspace and returns to this computer', async () => {
  const added = await invoke(
    'computers.pair',
    `127.0.0.1:${host.port}`,
    (await host.invoke('network.pair')).code,
    'Studio',
  )
  const oldId = added.computers.find((c) => !c.local).id
  await ramu.until(async () => (await statuses())[1] === 'connected', 'computer never connected')
  await invoke('computers.open', oldId)
  await ramu.until(() => openWindows() === 2, 'old workspace never opened')
  const replaced = await invoke(
    'computers.pair',
    `127.0.0.1:${host.port}`,
    (await host.invoke('network.pair')).code,
    'Studio again',
  )
  const newId = replaced.computers.find((c) => !c.local).id
  assert.notEqual(newId, oldId)
  await ramu.until(() => openWindows() === 1, 'old workspace never released')
  assert.equal(await hiddenViews(), 0)
  listUrl = newId
})

ramu.test('forgetting the visible computer still works when the local service is offline', async () => {
  await ramu.until(async () => (await statuses())[1] === 'connected', 'computer never connected')
  await invoke('computers.open', listUrl)
  await ramu.until(() => openWindows() === 2, 'workspace never opened')
  await invoke('background.stop')
  await ramu.until(async () => (await statuses())[0] === 'offline', 'local service never went offline')
  await invoke('computers.forget', listUrl)
  await ramu.until(() => openWindows() === 1, 'window never closed')
  assert.equal(await hiddenViews(), 0)
  ramu.noErrors()
})
