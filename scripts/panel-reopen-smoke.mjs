// Run after pnpm build. Uses a fake agent and a throwaway repository/profile.
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
const cwd = resolve(import.meta.dirname, '..')
const fixture = mkdtempSync(join(tmpdir(), 'ramu-layout-'))
const repo = join(fixture, 'project')
mkdirSync(repo)
writeFileSync(join(repo, 'review.ts'), 'export const value = 1\n')
mkdirSync(join(repo, 'docs'))
for (let i = 0; i < 60; i++) writeFileSync(join(repo, 'docs', `document-${String(i).padStart(2, '0')}.md`), '# Layout fixture\n')
const git = (...args) => execFileSync('git', args, { cwd: repo })
git('init', '-q'); git('add', '.'); git('-c', 'user.name=Layout', '-c', 'user.email=layout@example.com', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'initial')
const env = { ...process.env, RAMU_USER_DATA: join(fixture, 'profile'), RAMU_FAKE_AGENT: '1' }
delete env.ELECTRON_RENDERER_URL
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: [cwd], cwd, env })
const page = await app.firstWindow()
await page.setViewportSize({ width: 1440, height: 900 })
const errors = []
page.on('console', message => { if (message.type() === 'error') console.log('renderer:', message.text()) })
page.on('requestfailed', request => console.log('request failed:', request.url(), request.failure()?.errorText))
page.on('pageerror', e => { if (e.message !== 'Canceled') errors.push(e.message) })
const api = (method, ...args) => page.evaluate(([m, a]) => window.ramu.invoke(m, ...a), [method, args])
const pane = page.locator('.task-pane:visible')
try {
  await page.waitForSelector('.shell')
  console.log(`Fixture and screenshots: ${fixture}`)
  const { project, repositories } = await api('projects.addFolder', repo)
  const task = await api('tasks.create', { projectId: project.id, title: 'Layout review', mode: 'current' })
  await api('tasks.setup', task.id)
  const session = await api('agent.start', task.id, 'Reply with a short greeting.', { provider: 'claude-code', model: 'fake-claude', effort: 'medium', access: 'full', autoFallback: false })
  await page.reload(); await page.locator('.task-row').first().waitFor()
  await page.locator('.task-row').first().click()
  await pane.locator('.agent-view:visible').waitFor()

  await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  await page.locator('.workspace-tools').getByRole('button', { name: 'review.ts', exact: true }).click()
  await pane.locator('.monaco-editor[role=code]').first().waitFor()
  await page.locator('.workspace-tools-header').getByRole('button', { name: 'Close', exact: true }).click()
  await page.evaluate(() => {
    window.__reopenChat = document.querySelector('.task-pane .agent-view')
    window.__reopenEditor = document.querySelector('.task-pane .monaco-editor')
  })
  const check = async (editor, terminal) => {
    await page.waitForTimeout(350)
    const geometry = await pane.evaluate(el => {
      const rect = selector => { const r = el.querySelector(selector)?.getBoundingClientRect(); return r ? { x: r.x, right: r.right, width: r.width } : null }
      return { body: rect('.task-body'), chat: rect('.main-chat'), editor: rect('.editor-area'), terminal: rect('.terminal-panel'), group: rect('.task-body > [data-workspace-split]') }
    })
    assert(Math.abs(geometry.body.width - geometry.group.width) < 1)
    assert(geometry.chat.width >= 300 && geometry.chat.right <= geometry.body.right + 1)
    if (editor) {
      assert(geometry.editor.width >= 230 && geometry.editor.right <= geometry.body.right + 1)
      assert(geometry.editor.x >= geometry.chat.right - 1)
    }
    if (terminal) {
      assert(geometry.terminal.width >= 230 && geometry.terminal.right <= geometry.body.right + 1)
      assert(geometry.terminal.x >= (editor ? geometry.editor.right : geometry.chat.right) - 1)
    }
    assert(await page.evaluate(() => document.querySelector('.task-pane .agent-view') === window.__reopenChat))
    if (editor) assert(await page.evaluate(() => document.querySelector('.task-pane .monaco-editor') === window.__reopenEditor))
    return geometry
  }
  const handle = pane.getByRole('separator', { name: 'Resize chat pane' })
  await handle.focus(); await page.keyboard.press('ArrowLeft')
  const beforeDrag = await check(true, false)
  const divider = await handle.boundingBox()
  await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2)
  await page.mouse.down()
  await page.mouse.move(divider.x + divider.width / 2 + 40, divider.y + divider.height / 2, { steps: 4 })
  await page.mouse.up()
  const saved = await check(true, false)
  const motion = await pane.locator('[data-workspace-split]').first().evaluate(el => getComputedStyle(el).transitionDuration)
  assert(motion.includes('0.26s'), 'Split geometry has the layout animation')
  assert(Math.abs(saved.chat.width - beforeDrag.chat.width - 40) < 1, 'Dragging the independent divider resizes the chat by the pointer movement')
  for (let i = 0; i < 3; i++) {
    await pane.getByRole('button', { name: 'Hide workspace', exact: true }).click()
    if (i === 0) {
      await page.waitForTimeout(60)
      const midway = await pane.locator('.main-chat').boundingBox()
      const full = await pane.locator('.task-body').boundingBox()
      assert(midway.width > saved.chat.width && midway.width < full.width - 1, 'Closing animates through intermediate geometry')
    }
    await check(false, false)
    await page.getByRole('button', { name: 'Show right panel', exact: true }).click()
    const restored = await check(true, false)
    assert(Math.abs(restored.chat.width - saved.chat.width) < 1, 'Editor split restores the resized chat width')
  }
  console.log('ok - repeated editor close/reopen restores sizes and preserves chat/editor DOM')
  await page.locator('.workspace-tool-buttons').getByRole('button', { name: 'Terminal', exact: true }).click()
  await pane.locator('.terminal-panel').waitFor()
  const border = await pane.locator('.terminal-panel').evaluate(el => ({ border: getComputedStyle(el).borderTopWidth, radius: getComputedStyle(el).borderTopLeftRadius }))
  assert.deepEqual(border, { border: '0px', radius: '0px' }, 'The terminal uses the split divider without an inset card border')
  await pane.getByRole('button', { name: 'Dock terminal on right', exact: true }).click()
  await check(true, true)
  await page.evaluate(() => { window.__reopenTerminal = document.querySelector('.task-pane .terminal-host') })
  for (let i = 0; i < 3; i++) {
    await pane.getByRole('button', { name: 'Hide terminal panel', exact: true }).click()
    await check(true, false)
    await page.locator('.workspace-tool-buttons').getByRole('button', { name: 'Terminal', exact: true }).click()
    await check(true, true)
    assert(await page.evaluate(() => document.querySelector('.task-pane .terminal-host') === window.__reopenTerminal))
    await pane.getByRole('button', { name: 'Hide workspace', exact: true }).click()
    await check(false, false)
    await page.getByRole('button', { name: 'Show right panel', exact: true }).click()
    await check(true, true)
  }
  console.log('ok - editor and right terminal reopen together without pushing either out of the workspace')
  await pane.getByRole('button', { name: 'Dock terminal at bottom', exact: true }).click()
  await check(true, false)
  await pane.getByRole('button', { name: 'Dock terminal on right', exact: true }).click()
  await check(true, true)
  assert(await page.evaluate(() => document.querySelector('.task-pane .terminal-host') === window.__reopenTerminal))
  assert.deepEqual(errors, [])
  console.log('ok - docking retains chat, editor and terminal instances without renderer exceptions')
  // Capture a real Changes review from a disposable file edited during a fake agent turn.
  await api('agent.send', session.id, 'Capture a layout review [slow]')
  await page.waitForTimeout(400)
  writeFileSync(join(repo, 'review.ts'), 'export const value = 2\n')
  await page.waitForFunction(async id => (await window.ramu.invoke('reviews.list', id)).some(review => review.state === 'ready' && review.files.length), session.id)
  await pane.getByRole('button', { name: 'View changes', exact: true }).last().click()
  await pane.locator('.changes-tab:visible .pair-review-bar').waitFor()
  await page.evaluate(() => { window.__reopenReview = document.querySelector('.changes-tab') })
  for (let i = 0; i < 3; i++) {
    await check(true, true)
    await pane.getByRole('button', { name: 'Hide workspace', exact: true }).click()
    await check(false, false)
    await page.getByRole('button', { name: 'Show right panel', exact: true }).click()
    await check(true, true)
    assert(await page.evaluate(() => document.querySelector('.changes-tab') === window.__reopenReview))
  }
  console.log('ok - actual Changes review repeatedly reopens beside the terminal without losing its view')
  // Content and old panel-library layouts cannot expand the independent grid tracks.
  await page.evaluate(() => {
    localStorage.setItem('ramu.layout.react-resizable-panels:task-columns:chat:editor:terminal-right', JSON.stringify({ chat: 9999, editor: 1, 'terminal-right': 1 }))
    const probe = document.createElement('div')
    probe.style.width = '4000px'
    probe.style.height = '1px'
    probe.dataset.splitProbe = 'true'
    document.querySelector('.main-chat').appendChild(probe)
  })
  await check(true, true)
  for (const width of [1000, 1440]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 800), width)
    await page.waitForTimeout(350)
    const bounds = await pane.evaluate(el => {
      const body = el.querySelector('.task-body').getBoundingClientRect()
      return [...el.querySelectorAll('.main-chat, .editor-area, .terminal-panel')].map(view => {
        const rect = view.getBoundingClientRect()
        return { width: rect.width, inside: rect.x >= body.x && rect.right <= body.right + 1 }
      })
    })
    assert(bounds.every(view => view.inside && view.width > 100), 'Compact windows keep all three panels inside the workspace')
  }
  await page.evaluate(() => document.querySelector('[data-split-probe]').remove())
  const beforeReload = await check(true, true)
  await page.reload()
  await page.locator('.task-row').first().waitFor()
  await page.locator('.task-row').first().click()
  await pane.locator('.changes-tab:visible .pair-review-bar').waitFor()
  await page.waitForTimeout(350)
  const restoredWidths = await pane.evaluate(el => ['.main-chat', '.editor-area', '.terminal-panel'].map(selector => el.querySelector(selector).getBoundingClientRect().width))
  assert(Math.abs(restoredWidths[0] - beforeReload.chat.width) < 1)
  assert(Math.abs(restoredWidths[1] - beforeReload.editor.width) < 1)
  assert(Math.abs(restoredWidths[2] - beforeReload.terminal.width) < 1)
  console.log('ok - each split restores its own size after reload and ignores the old panel layout')
  console.log('ok - oversized chat content and compact windows cannot push panels out of the grid')
  await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click()
  await page.waitForTimeout(350)
  assert(await page.getByRole('button', { name: 'Show sidebar', exact: true }).isVisible())
  assert((await page.locator('#sidebar').boundingBox()).width < 1)
  await page.getByRole('button', { name: 'Show sidebar', exact: true }).click()
  await page.waitForTimeout(350)
  assert((await page.locator('#sidebar').boundingBox()).width > 200)
  await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  await page.waitForTimeout(350)
  assert((await page.locator('.workspace-tools').boundingBox()).width > 220)
  await page.locator('.workspace-tools-header').getByRole('button', { name: 'Close', exact: true }).click()
  await page.locator('.workspace-tools').waitFor({ state: 'detached', timeout: 2000 })
  assert.equal(await page.locator('.workspace-tools').count(), 0)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await pane.locator('[data-workspace-split]').first().evaluate(el => getComputedStyle(el).transitionDuration), '0s')
  console.log('ok - animated sidebar/tools toggles settle correctly and reduced motion disables transitions')

} finally {
  await api('background.stop').catch(() => {})
  await app.close()
}
