// Native Electron rendering regression checks. Uses only a disposable profile and seeded reviews.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron } from 'playwright-core'

const root = resolve(import.meta.dirname, '..'), dir = mkdtempSync(join(tmpdir(), 'ramu-rendering-'))
const profile = join(dir, 'profile'), env = { ...process.env, RAMU_USER_DATA: profile, RAMU_WORKTREES: join(dir, 'worktrees'), RAMU_FAKE_AGENT: '1' }
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
let app, page
const errors = []
let step = 'launch'
const invoke = (method, ...args) => page.evaluate(({ method, args }) => window.ramu.invoke(method, ...args), { method, args })
const countEditors = () => page.locator('.review-diff .monaco-diff-editor').count()
try {
  app = await electron.launch({ args: [root], cwd: root, env, timeout: 30000 })
  page = await app.firstWindow()
  page.on('pageerror', (error) => { if (!/^(Canceled|Make sure the ref is set)/.test(error.message)) errors.push(`[${step}] ${error.message}\n${error.stack}`) })
  await page.locator('.shell').waitFor()
  await invoke('settings.app.set', { ...await invoke('settings.app.get'), language: 'en', recapsEnabled: false })
  const task = await invoke('tasks.create', { projectId: 'no-project', title: 'Rendering performance', mode: 'current' })
  const oldContent = Array.from({ length: 30 }, (_, index) => `value${index} = ${index}`).join('\n')
  const review = (count) => ({ id: `render-${count}`, taskId: task.id, sessionId: null, createdAt: Date.now() - count, state: 'ready', roots: [], comments: [], aiState: 'idle', aiSummary: null, files: Array.from({ length: count }, (_, index) => ({ id: `file-${index}`, repoId: 'general', repoName: 'Fixture', path: `src/section-${String(Math.floor(index / 100)).padStart(2, '0')}/file-${String(index).padStart(4, '0')}.txt`, status: 'modified', binary: false, oldHash: 'old', newHash: 'new', oldContent, newContent: oldContent.replace('value15 = 15', 'value15 = 150'), addedLines: 1, removedLines: 1 })) })
  const db = new DatabaseSync(join(profile, 'ramu.db'))
  for (const count of [24, 5000]) { const value = review(count); db.prepare('INSERT INTO change_reviews VALUES (?, ?, ?, ?, ?, ?)').run(value.id, task.id, null, 'ready', JSON.stringify(value), value.createdAt) }
  db.close()
  const open = async (count) => {
    const id = `view-${count}`, ui = await invoke('ui.get')
    await invoke('ui.setTask', task.id, { views: [{ id, kind: 'review', taskId: task.id, reviewId: `render-${count}` }], activeViewId: id })
    await invoke('ui.setWorkspace', { ...ui.workspace, openTaskIds: [task.id], activeTaskId: task.id })
    await page.reload(); await page.locator('.shell').waitFor()
    await page.locator('.task-row').filter({ has: page.getByText(task.title, { exact: true }) }).click()
    await page.locator('.changes-page:visible .review-file-card').first().waitFor()
    await page.locator('.changes-page:visible .monaco-diff-editor').first().waitFor()
  }
  step = 'open 24'; await open(24)
  assert.ok(await countEditors() <= 4, 'Opening a review must not construct every diff editor')
  step = 'scroll 24'; await page.locator('.changes-page:visible').evaluate((element) => { element.scrollTop = 3500 })
  await page.waitForFunction(() => !document.querySelector('[data-file-id="file-0"] .monaco-diff-editor'))
  assert.ok(await countEditors() <= 5, 'Scrolled reviews keep editor count bounded')
  step = 'hide review'; await page.getByRole('button', { name: 'Home', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.review-diff .monaco-diff-editor'))
  console.log('ok - Reviews defer off-screen cards and release diff editors on scroll and tab hide')

  step = 'open 5000'; await open(5000)
  assert.ok(await page.locator('.review-tree-row').count() < 60, 'Large review trees must bound mounted rows')
  const firstRow = page.locator('.review-tree-row').first()
  step = 'last file'; await firstRow.focus(); await page.keyboard.press('End')
  await page.waitForFunction(() => document.activeElement?.getAttribute('title')?.endsWith('file-4999.txt'))
  await page.keyboard.press('Enter')
  const card = page.locator('.review-file-card[data-file-id="file-4999"]')
  await card.waitFor(); await card.locator('.monaco-diff-editor').waitFor()
  await card.getByRole('button', { name: 'File comment', exact: true }).click()
  const draft = card.getByRole('textbox', { name: /Comment on/ })
  await draft.fill('Keep this draft while browsing.')
  step = 'show all'; await page.getByRole('button', { name: 'Show all files', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.review-file-slot').length === 5000)
  assert.ok(await page.locator('.review-file-card').count() < 20, 'Show all must not mount thousands of card bodies')
  assert.equal(await draft.inputValue(), 'Keep this draft while browsing.')
  step = 'line reveal'; await page.evaluate(() => window.dispatchEvent(new CustomEvent('ramu:review-line', { detail: { fileId: 'file-2500', side: 'new', line: 16, endLine: 16 } })))
  await page.locator('.review-file-card[data-file-id="file-2500"] .monaco-diff-editor').waitFor()
  assert.ok(await countEditors() <= 6, 'Navigation must not activate all deferred editors')
  console.log('ok - A 5,000-file review keeps its tree/cards bounded, reaches the last file, and preserves drafts and line navigation')
  step = 'search results'
  const repo = join(dir, 'search-fixture'); mkdirSync(repo)
  execFileSync('git', ['init', '-q'], { cwd: repo })
  for (let index = 0; index < 10; index++) writeFileSync(join(repo, `match-${String(index).padStart(2, '0')}.txt`), Array.from({ length: 100 }, (_, line) => `performance_fixture_token ${line}`).join('\n'))
  const { project } = await invoke('projects.addFolder', repo)
  const searchTask = await invoke('tasks.create', { projectId: project.id, title: 'Large search results', mode: 'current' })
  const ui = await invoke('ui.get')
  await invoke('ui.setWorkspace', { ...ui.workspace, openTaskIds: [searchTask.id], activeTaskId: searchTask.id })
  await page.reload(); await page.locator('.shell').waitFor()
  await page.locator('.task-row').filter({ has: page.getByText(searchTask.title, { exact: true }) }).click()
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search project files', exact: true }).fill('performance_fixture_token')
  await page.waitForFunction(() => document.querySelector('.search-summary')?.textContent?.includes('500'))
  assert.ok(await page.locator('.search-results [data-virtual-index]').count() < 70, 'Search results must bound mounted rows')
  await page.locator('.search-results button').first().focus(); await page.keyboard.press('End')
  await page.waitForFunction(() => document.activeElement?.getAttribute('title')?.includes(':100:1'))
  await page.keyboard.press('Enter')
  await page.locator('.file-view:visible').waitFor()
  console.log('ok - A 500-match search stays bounded and keyboard navigation opens the final match')
  assert.deepEqual(errors, [])
  await invoke('background.stop')
} finally {
  if (page && app) await invoke('background.stop').catch(() => {})
  await app?.close().catch(() => {})
  rmSync(dir, { recursive: true, force: true })
}
