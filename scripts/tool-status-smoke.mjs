// Run after pnpm build. Verifies mixed command progress with a fake provider.
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
const cwd = resolve(import.meta.dirname, '..', 'apps', 'desktop')
const fixture = mkdtempSync(join(tmpdir(), 'ramu-tool-status-')), repo = join(fixture, 'repo')
mkdirSync(repo); writeFileSync(join(repo, 'file.txt'), 'fixture\n')
for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'initial']]) execFileSync('git', args, { cwd: repo })
const env = { ...process.env, RAMU_USER_DATA: join(fixture, 'profile'), RAMU_FAKE_AGENT: '1' }
delete env.ELECTRON_RENDERER_URL
const app = await electron.launch({ args: [cwd], cwd, env })
const page = await app.firstWindow()
const api = (method, ...args) => page.evaluate(([m, a]) => window.ramu.invoke(m, ...a), [method, args])
try {
  await page.waitForSelector('.shell')
  const { project } = await api('projects.addFolder', repo)
  const task = await api('tasks.create', { projectId: project.id, title: 'Tool progress', mode: 'current' })
  await api('tasks.setup', task.id)
  const session = await api('agent.start', task.id, '[tool progress]', { provider: 'claude-code', model: 'fake-claude', effort: 'medium', access: 'full', autoFallback: false })
  await page.reload(); await page.locator('.task-row').first().click()
  const group = page.locator('.tool-group').filter({ has: page.locator('.tool-group-label', { hasText: 'Running 3 commands' }) })
  await group.waitFor()
  await page.waitForFunction(() => [...document.querySelectorAll('.tool-summary')].filter(el => el.textContent.startsWith('Ran ')).length === 2)
  assert.deepEqual(await group.locator('.tool-summary').allTextContents(), ['Ran echo command-1', 'Ran echo command-2', 'Running echo command-3'])
  await page.screenshot({ path: join(fixture, 'running.png') })
  await page.waitForFunction(async id => (await window.ramu.invoke('agent.events', id)).some(event => event.kind === 'result'), session.id)
  const work = page.getByRole('button', { name: /Worked for/ })
  await work.waitFor(); await work.click()
  const completed = page.locator('.tool-group').filter({ has: page.locator('.tool-group-label', { hasText: 'Ran 3 commands' }) })
  if (await completed.getAttribute('data-open') === null) await completed.locator('[data-slot=collapsible-trigger]').first().click()
  assert.deepEqual(await completed.locator('.tool-summary').allTextContents(), ['Ran echo command-1', 'Ran echo command-2', 'Ran echo command-3'])
  const findButton = page.getByRole('button', { name: 'Find in conversation', exact: true })
  assert(await page.locator('.agent-header').getByRole('button', { name: 'Find in conversation', exact: true }).isVisible())
  assert(await page.locator('.task-header').getByRole('button', { name: 'Find in conversation', exact: true }).count() === 0)
  await findButton.click()
  const find = page.getByRole('textbox', { name: 'Find in conversation', exact: true })
  await find.fill('command-')
  await page.locator('.chat-find-count', { hasText: '1 of 3' }).waitFor()
  const findBox = await page.locator('.chat-find-bar').boundingBox()
  const chatBox = await page.locator('.main-chat').boundingBox()
  assert(findBox.width <= 420 && findBox.width < chatBox.width / 2)
  await find.press('Enter')
  await page.locator('.chat-find-count', { hasText: '2 of 3' }).waitFor()
  await page.screenshot({ path: join(fixture, 'conversation-find.png') })
  await find.press('Escape')
  assert(await page.locator('.chat-find-bar').count() === 0)
  assert(await page.locator('[data-composer-input]').evaluate(el => el === document.activeElement))
  console.log('ok - chat header search opens a compact find panel, steps through matches and restores composer focus')
  console.log('ok - group and rows reflect mixed running/completed commands and settle to Ran')
  console.log(`Screenshots: ${fixture}`)
} finally { await api('background.stop').catch(() => {}); await app.close() }
