// Real Electron view-cache verification, using six loopback proxies to one isolated fake-agent server.
// Run after pnpm build: node scripts/remote-scale-smoke.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer, request } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

const root = resolve(import.meta.dirname, '..'), appDir = join(root, 'apps/desktop')
const dir = mkdtempSync(join(tmpdir(), 'ramu-scale-ui-')), socketPath = join(dir, 'h.sock')
const termIds = new Map()
const profile = join(dir, 'app'), proxies = [], counters = Array.from({ length: 6 }, () => new Map())
const env = { ...process.env, RAMU_FAKE_AGENT: '1', RAMU_WORKTREES: join(dir, 'worktrees') }
delete env.ELECTRON_RENDERER_URL
let app, local
const host = spawn(process.execPath, [join(root, 'apps/server/dist/cli.js'), 'serve'], { env: { ...env, RAMU_USER_DATA: join(dir, 'host'), RAMU_SOCKET: socketPath }, stdio: 'ignore' })
const hostInvoke = (method, ...args) => new Promise((resolve, reject) => {
  const req = request({ socketPath, path: '/invoke', method: 'POST' }, (res) => {
    const chunks = []; res.on('data', (chunk) => chunks.push(chunk)); res.on('end', () => { try { const body = JSON.parse(Buffer.concat(chunks)); body.error ? reject(new Error(body.error)) : resolve(body.value) } catch (error) { reject(error) } })
  }); req.on('error', reject); req.end(JSON.stringify({ method, args }))
})
const until = async (check, timeout = 20000) => {
  const deadline = Date.now() + timeout
  for (;;) { try { return await check() } catch (error) { if (Date.now() > deadline) throw error; await new Promise((resolve) => setTimeout(resolve, 100)) } }
}
const invoke = (method, ...args) => local.evaluate(({ method, args }) => window.ramu.invoke(method, ...args), { method, args })
const open = async (id) => {
  await invoke('computers.open', id)
  return until(async () => {
    for (const page of app.windows()) {
      if (page === local || page.isClosed()) continue
      const current = await page.evaluate(() => window.ramu?.invoke('computers.list').then((state) => state.current)).catch(() => null)
      if (current === id) { await page.waitForSelector('.shell'); return page }
    }
    throw new Error(`Workspace ${id} is not loaded yet`)
  })
}
try {
  await until(async () => assert.equal((await hostInvoke('background.status')).running, true))
  const prefs = await hostInvoke('settings.app.get')
  await hostInvoke('settings.app.set', { ...prefs, language: 'en', recapsEnabled: false })
  const saved = []
  for (let i = 0; i < 6; i++) {
    const proxy = createServer((req, res) => {
      let method
      const up = request({ socketPath, path: req.url, method: req.method, headers: req.headers }, (response) => {
        if (method === 'term.open') { const chunks = []; response.on('data', (chunk) => chunks.push(chunk)); response.on('end', () => { try { const reply = JSON.parse(Buffer.concat(chunks)); if (reply.value?.id) termIds.set(i, reply.value.id) } catch {} }) }
        res.writeHead(response.statusCode, response.headers); response.pipe(res)
      })
      const body = []
      req.on('data', (chunk) => body.push(chunk))
      req.on('end', () => { if (body.length) { try { method = JSON.parse(Buffer.concat(body)).method; counters[i].set(method, (counters[i].get(method) ?? 0) + 1) } catch {} } })
      up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
      res.on('close', () => up.destroy())
      req.pipe(up)
    })
    await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve))
    proxies.push(proxy)
    saved.push({ id: `computer-${i}`, name: `Computer ${i}`, url: `http://127.0.0.1:${proxy.address().port}`, token: 'fixture', sealed: false, pairedAt: Date.now() })
  }
  mkdirSync(profile)
  writeFileSync(join(profile, 'remote-servers.json'), JSON.stringify({ servers: saved }), { mode: 0o600 })
  app = await electron.launch({ args: [appDir], cwd: appDir, env: { ...env, RAMU_USER_DATA: profile }, timeout: 30000 })
  local = await app.firstWindow(); await local.waitForSelector('.shell')
  await until(async () => assert.equal((await invoke('computers.list')).computers.filter((computer) => computer.status === 'connected').length, 7))
  const first = await open('computer-0')
  await first.evaluate(() => localStorage.setItem('scale.marker', 'preserved'))
  const composer = first.locator('[data-composer-input]').first()
  await composer.fill('Keep this unsent scale-test draft')
  const protectedView = await open('computer-1')
  await protectedView.evaluate(() => window.dispatchEvent(new Event('ramu:settings')))
  await protectedView.locator('.settings-page').waitFor()
  for (let i = 2; i < 6; i++) await open(`computer-${i}`)
  await until(async () => assert.equal(first.isClosed(), true))
  await until(async () => assert.equal(app.windows().length, 5)) // Four remote views plus the fixed local renderer.
  assert.equal(protectedView.isClosed(), false, 'unfinished settings stay protected')
  assert.equal((await invoke('computers.list')).computers.filter((computer) => computer.status === 'connected').length, 7)
  console.log('ok - six remote streams stay connected while clean workspace views are limited to four')
  await new Promise((resolve) => setTimeout(resolve, 1000))
  const before = counters[1].get('activity.status') ?? 0
  await new Promise((resolve) => setTimeout(resolve, 3500))
  assert.equal(counters[1].get('activity.status') ?? 0, before, 'hidden workspace must not poll activity')
  assert.equal(await protectedView.evaluate(() => document.documentElement.hasAttribute('data-workspace-hidden')), true)
  console.log('ok - protected hidden workspaces stop polling and off-screen rendering')
  const restored = await open('computer-0')
  assert.equal(await restored.evaluate(() => localStorage.getItem('scale.marker')), 'preserved')
  await until(async () => assert.equal(await restored.locator('[data-composer-input]').first().getAttribute('data-draft'), 'Keep this unsent scale-test draft'))
  assert.equal((await invoke('computers.list')).computers.filter((computer) => computer.status === 'connected').length, 7)
  console.log('ok - an evicted workspace restores its isolated storage and unsent draft without reconnecting')

  // Dirty file buffers remain pinned instead of being discarded by the cache.
  const task = await hostInvoke('tasks.create', { projectId: 'no-project', title: 'Protected edits', mode: 'current' })
  const [binding] = await hostInvoke('tasks.bindings', task.id)
  writeFileSync(join(binding.cwd, 'notes.txt'), 'original file contents')
  const editorPage = await open('computer-1')
  await editorPage.keyboard.press('Escape')
  await editorPage.evaluate(({ taskId, repoId }) => localStorage.setItem('ramu.workspace.resume', JSON.stringify({
    workspace: { openTaskIds: [taskId], activeTaskId: taskId, sidebar: 'projects' },
    tasks: { [taskId]: { views: [{ id: 'scale-file', kind: 'file', repoId, path: 'notes.txt', preview: false }], activeViewId: 'scale-file', dockHidden: false } },
    composing: null, composingWorkspace: null,
  })), { taskId: task.id, repoId: binding.repoId })
  await editorPage.reload(); await editorPage.waitForSelector('.shell')
  await editorPage.locator('.monaco-editor .view-line').filter({ hasText: 'original file contents' }).waitFor()
  await editorPage.locator('.monaco-editor').first().click()
  await editorPage.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
  await editorPage.keyboard.type('Unsaved scale safety edits')
  await editorPage.locator('.monaco-editor .view-line').filter({ hasText: 'Unsaved scale safety edits' }).waitFor()
  for (const id of ['computer-2', 'computer-3', 'computer-4', 'computer-5', 'computer-0']) await open(id)
  await new Promise((resolve) => setTimeout(resolve, 1000))
  assert.equal(editorPage.isClosed(), false, 'unsaved file edits must pin their workspace')
  const returned = await open('computer-1')
  assert.equal(returned, editorPage)
  await returned.locator('.monaco-editor .view-line').filter({ hasText: 'Unsaved scale safety edits' }).waitFor()
  console.log('ok - unsaved file buffers remain intact through view-cache pressure')

  const terminalTask = await hostInvoke('tasks.create', { projectId: 'no-project', title: 'Protected shell', mode: 'current' })
  const terminalPage = await open('computer-2')
  await terminalPage.evaluate(({ taskId }) => localStorage.setItem('ramu.workspace.resume', JSON.stringify({
    workspace: { openTaskIds: [taskId], activeTaskId: taskId, sidebar: 'projects' },
    tasks: { [taskId]: { views: [{ id: 'scale-terminal', kind: 'terminal', title: 'Protected shell' }], activeViewId: 'scale-terminal', activeTerminalId: 'scale-terminal', terminalOpen: true } },
    composing: null, composingWorkspace: null,
  })), { taskId: terminalTask.id })
  await terminalPage.reload(); await terminalPage.waitForSelector('.xterm-screen')
  await until(async () => assert.ok(termIds.get(2)))
  const terminalId = termIds.get(2)
  for (const id of ['computer-3', 'computer-4', 'computer-5', 'computer-0']) await open(id)
  assert.equal(terminalPage.isClosed(), false, 'open terminals must pin their workspace')
  await hostInvoke('term.write', terminalId, "printf 'scale-hidden-terminal-output\n'\r")
  await new Promise((resolve) => setTimeout(resolve, 500))
  const shellAgain = await open('computer-2')
  assert.equal(shellAgain, terminalPage)
  await shellAgain.waitForFunction(() => document.querySelector('.xterm-accessibility-tree')?.textContent.includes('scale-hidden-terminal-output'))
  assert.equal(termIds.get(2), terminalId, 'switching must not create a replacement shell')
  console.log('ok - hidden terminals keep their shell and replay buffered output on return')
} catch (error) {
  console.error(error); process.exitCode = 1
} finally {
  await local?.evaluate(() => window.ramu.invoke('background.stop')).catch(() => {})
  await app?.close().catch(() => {})
  host.kill()
  for (const proxy of proxies) { proxy.closeAllConnections(); proxy.close() }
  await new Promise((resolve) => setTimeout(resolve, 500))
  rmSync(dir, { recursive: true, force: true })
}
