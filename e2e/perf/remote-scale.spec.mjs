// Workspace view cache under pressure: six paired computers (loopback proxies in front of one fake-agent host) stay
// connected while only four clean workspace views are kept warm. Views with unfinished settings, unsaved file edits or
// an open terminal are pinned; evicted ones restore their storage and draft. On demand: `pnpm test:e2e:perf remote-scale`.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { join } from 'node:path'
import { after } from 'node:test'
import { modifier, startRamu, startServer } from '../support/index.mjs'

const COMPUTERS = 6
const ramu = await startRamu('remote-scale', { launch: false })
const host = await startServer({ name: 'host', dir: ramu.dir })
const counters = Array.from({ length: COMPUTERS }, () => new Map())
const terminalIds = new Map()
const proxies = []

await host.invoke('settings.app.set', { ...(await host.invoke('settings.app.get')), language: 'en', recapsEnabled: false })

/** A loopback HTTP front for the host's socket that counts the methods called through it and notes opened terminals. */
async function startProxy(index) {
  const proxy = createServer((req, res) => {
    let method
    const upstream = request({ socketPath: host.socket, path: req.url, method: req.method, headers: req.headers }, (response) => {
      if (method === 'term.open') {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          try {
            const reply = JSON.parse(Buffer.concat(chunks))
            if (reply.value?.id) terminalIds.set(index, reply.value.id)
          } catch {}
        })
      }
      res.writeHead(response.statusCode, response.headers)
      response.pipe(res)
    })
    const body = []
    req.on('data', (chunk) => body.push(chunk))
    req.on('end', () => {
      if (!body.length) return
      try {
        method = JSON.parse(Buffer.concat(body)).method
        counters[index].set(method, (counters[index].get(method) ?? 0) + 1)
      } catch {}
    })
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502)
      res.end()
    })
    res.on('close', () => upstream.destroy())
    req.pipe(upstream)
  })
  await new Promise((done) => proxy.listen(0, '127.0.0.1', done))
  proxies.push(proxy)
  return {
    id: `computer-${index}`,
    name: `Computer ${index}`,
    url: `http://127.0.0.1:${proxy.address().port}`,
    token: 'fixture',
    sealed: false,
    pairedAt: Date.now(),
  }
}
after(() => {
  for (const proxy of proxies) {
    proxy.closeAllConnections()
    proxy.close()
  }
})

const servers = []
for (let i = 0; i < COMPUTERS; i++) servers.push(await startProxy(i))
mkdirSync(ramu.profile, { recursive: true })
writeFileSync(join(ramu.profile, 'remote-servers.json'), JSON.stringify({ servers }), { mode: 0o600 })
await ramu.launch()
const local = ramu.page
const invoke = (method, ...args) =>
  local.evaluate(({ method, args }) => window.ramu.invoke(method, ...args), { method, args })
const connected = async () => (await invoke('computers.list')).computers.filter((c) => c.status === 'connected').length
const resume = (taskId, tasks) =>
  JSON.stringify({
    workspace: { openTaskIds: [taskId], activeTaskId: taskId, sidebar: 'projects' },
    tasks,
    composing: null,
    composingWorkspace: null,
  })

/** Opens a computer and returns the page of its workspace once it has loaded. */
async function open(id) {
  await invoke('computers.open', id)
  return ramu.until(
    async () => {
      for (const page of ramu.app.windows()) {
        if (page === local || page.isClosed()) continue
        const current = await page
          .evaluate(() => window.ramu?.invoke('computers.list').then((state) => state.current))
          .catch(() => null)
        if (current === id) {
          await page.waitForSelector('.shell')
          return page
        }
      }
      return null
    },
    `workspace ${id} never loaded`,
    { attempts: 200 },
  )
}

let first, protectedView
ramu.test('six remote streams stay connected while clean workspace views are limited to four', async () => {
  await ramu.until(async () => (await connected()) === COMPUTERS + 1, 'not every computer connected')
  first = await open('computer-0')
  await first.evaluate(() => localStorage.setItem('scale.marker', 'preserved'))
  await first.locator('[data-composer-input]').first().fill('Keep this unsent scale-test draft')
  protectedView = await open('computer-1')
  await protectedView.evaluate(() => window.dispatchEvent(new Event('ramu:settings')))
  await protectedView.locator('.settings-page').waitFor()
  for (let i = 2; i < COMPUTERS; i++) await open(`computer-${i}`)
  await ramu.until(() => first.isClosed(), 'the oldest clean view was never released')
  // Four remote views plus the fixed local renderer.
  await ramu.until(() => ramu.app.windows().length === 5, 'the view cache did not settle at four remote views')
  assert.equal(protectedView.isClosed(), false, 'unfinished settings stay protected')
  assert.equal(await connected(), COMPUTERS + 1, 'eviction dropped a connection')
})

ramu.test('protected hidden workspaces stop polling and off-screen rendering', async () => {
  const polled = () => counters[1].get('activity.status') ?? 0
  await ramu.sleep(1000)
  const before = polled()
  await ramu.sleep(3500)
  assert.equal(polled(), before, 'a hidden workspace must not poll activity')
  assert.equal(await protectedView.evaluate(() => document.documentElement.hasAttribute('data-workspace-hidden')), true)
})

ramu.test('an evicted workspace restores its isolated storage and unsent draft without reconnecting', async () => {
  const restored = await open('computer-0')
  assert.equal(await restored.evaluate(() => localStorage.getItem('scale.marker')), 'preserved')
  await ramu.until(
    async () =>
      (await restored.locator('[data-composer-input]').first().getAttribute('data-draft')) ===
      'Keep this unsent scale-test draft',
    'the unsent draft was lost',
  )
  assert.equal(await connected(), COMPUTERS + 1)
})

ramu.test('unsaved file buffers remain intact through view-cache pressure', async () => {
  const task = await host.invoke('tasks.create', { projectId: 'no-project', title: 'Protected edits', mode: 'current' })
  const [binding] = await host.invoke('tasks.bindings', task.id)
  writeFileSync(join(binding.cwd, 'notes.txt'), 'original file contents')
  const editor = await open('computer-1')
  await editor.keyboard.press('Escape')
  await editor.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [
      'ramu.workspace.resume',
      resume(task.id, {
        [task.id]: {
          views: [{ id: 'scale-file', kind: 'file', repoId: binding.repoId, path: 'notes.txt', preview: false }],
          activeViewId: 'scale-file',
          dockHidden: false,
        },
      }),
    ],
  )
  await editor.reload()
  await editor.waitForSelector('.shell')
  const line = (text) => editor.locator('.monaco-editor .view-line').filter({ hasText: text })
  await line('original file contents').waitFor()
  await editor.locator('.monaco-editor').first().click()
  await editor.keyboard.press(`${modifier}+a`)
  await editor.keyboard.type('Unsaved scale safety edits')
  await line('Unsaved scale safety edits').waitFor()
  for (const id of ['computer-2', 'computer-3', 'computer-4', 'computer-5', 'computer-0']) await open(id)
  await ramu.sleep(1000)
  assert.equal(editor.isClosed(), false, 'unsaved file edits must pin their workspace')
  const returned = await open('computer-1')
  assert.equal(returned, editor)
  await line('Unsaved scale safety edits').waitFor()
})

ramu.test('hidden terminals keep their shell and replay buffered output on return', async () => {
  const task = await host.invoke('tasks.create', { projectId: 'no-project', title: 'Protected shell', mode: 'current' })
  const terminal = await open('computer-2')
  await terminal.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [
      'ramu.workspace.resume',
      resume(task.id, {
        [task.id]: {
          views: [{ id: 'scale-terminal', kind: 'terminal', title: 'Protected shell' }],
          activeViewId: 'scale-terminal',
          activeTerminalId: 'scale-terminal',
          terminalOpen: true,
        },
      }),
    ],
  )
  await terminal.reload()
  await terminal.waitForSelector('.xterm-screen')
  await ramu.until(() => terminalIds.get(2), 'the terminal never opened on the host')
  const terminalId = terminalIds.get(2)
  for (const id of ['computer-3', 'computer-4', 'computer-5', 'computer-0']) await open(id)
  assert.equal(terminal.isClosed(), false, 'open terminals must pin their workspace')
  await host.invoke('term.write', terminalId, "printf 'scale-hidden-terminal-output\n'\r")
  const again = await open('computer-2')
  assert.equal(again, terminal)
  await again.waitForFunction(() =>
    document.querySelector('.xterm-accessibility-tree')?.textContent.includes('scale-hidden-terminal-output'),
  )
  assert.equal(terminalIds.get(2), terminalId, 'switching must not create a replacement shell')
})
