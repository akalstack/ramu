// Rendering limits: reviews, review file trees and search results mount a bounded number of rows and diff editors no
// matter how much data they hold. Seeds reviews straight into the profile database. On demand: `pnpm test:e2e:perf rendering`.
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { showTask, startRamu } from '../support/index.mjs'

const ramu = await startRamu('rendering', {
  repos: {
    search: Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [
        `match-${String(index).padStart(2, '0')}.txt`,
        Array.from({ length: 100 }, (_, line) => `performance_fixture_token ${line}`).join('\n'),
      ]),
    ),
  },
})
const { page } = ramu
const countEditors = () => page.locator('.review-diff .monaco-diff-editor').count()
const oldContent = Array.from({ length: 30 }, (_, index) => `value${index} = ${index}`).join('\n')
let task
let treeRows = 0

/** A ready review of `count` one-line edits, shaped like the server's stored review. */
const review = (count) => ({
  id: `render-${count}`,
  taskId: task.id,
  sessionId: null,
  createdAt: Date.now() - count,
  state: 'ready',
  roots: [],
  comments: [],
  aiState: 'idle',
  aiSummary: null,
  files: Array.from({ length: count }, (_, index) => ({
    id: `file-${index}`,
    repoId: 'general',
    repoName: 'Fixture',
    path: `src/section-${String(Math.floor(index / 100)).padStart(2, '0')}/file-${String(index).padStart(4, '0')}.txt`,
    status: 'modified',
    binary: false,
    oldHash: 'old',
    newHash: 'new',
    oldContent,
    newContent: oldContent.replace('value15 = 15', 'value15 = 150'),
    addedLines: 1,
    removedLines: 1,
  })),
})

/** Shows the seeded review of `count` files as the task's only view. */
async function openReview(count) {
  const id = `view-${count}`
  await showTask(
    ramu,
    task,
    { views: [{ id, kind: 'review', taskId: task.id, reviewId: `render-${count}` }], activeViewId: id },
    { openTaskIds: [task.id] },
  )
  await page.locator('.changes-page:visible .review-file-card').first().waitFor()
  await page.locator('.changes-page:visible .monaco-diff-editor').first().waitFor()
}

ramu.test('reviews defer off-screen cards and release diff editors on scroll and tab hide', async () => {
  await ramu.api('settings.app.set', { ...(await ramu.api('settings.app.get')), language: 'en', recapsEnabled: false })
  task = await ramu.api('tasks.create', { projectId: 'no-project', title: 'Rendering performance', mode: 'current' })
  const db = new DatabaseSync(join(ramu.profile, 'ramu.db'))
  for (const count of [24, 5000]) {
    const value = review(count)
    db.prepare('INSERT INTO change_reviews VALUES (?, ?, ?, ?, ?, ?)').run(
      value.id,
      task.id,
      null,
      'ready',
      JSON.stringify(value),
      value.createdAt,
    )
  }
  db.close()

  await openReview(24)
  assert.ok((await countEditors()) <= 4, 'opening a review constructs every diff editor')
  // Visited cards stay mounted so their drafts survive, but cards never scrolled near are not built.
  await page.locator('.changes-page:visible').evaluate((element) => (element.scrollTop = element.scrollHeight))
  await page.locator('.review-file-card[data-file-id="file-23"]').waitFor()
  const scrolled = await countEditors()
  assert.ok(scrolled < 12, `scrolling a 24-file review built ${scrolled} diff editors`)
  await page.getByRole('button', { name: 'Home', exact: true }).click()
  await ramu.until(
    () => page.evaluate(() => !document.querySelector('.review-diff .monaco-diff-editor')),
    'a hidden review kept its diff editors',
  )
})

ramu.test('a 5,000-file review keeps its tree and cards bounded, reaches the last file and keeps drafts', async () => {
  await openReview(5000)
  // A docked, narrow review folds its file tree away until asked for.
  const showTree = page.getByRole('button', { name: 'Show file tree', exact: true })
  if (await showTree.isVisible()) await showTree.click()
  await page.locator('.review-tree-row').first().waitFor()
  // Asserted by the last step, so a regression there does not hide the checks that follow.
  treeRows = await page.locator('.review-tree-row').count()
  await page.locator('.review-tree-row').first().focus()
  await page.keyboard.press('End')
  await ramu.until(
    () => page.evaluate(() => document.activeElement?.textContent?.startsWith('file-4999.txt')),
    'End did not reach the last file',
  )
  await page.keyboard.press('Enter')
  const card = page.locator('.review-file-card[data-file-id="file-4999"]')
  await card.locator('.monaco-diff-editor').waitFor()
  await card.getByRole('button', { name: 'File comment', exact: true }).click()
  const draft = card.getByRole('textbox', { name: /Comment on/ })
  await draft.fill('Keep this draft while browsing.')
  await page.getByRole('button', { name: 'Show all files', exact: true }).click()
  await ramu.until(
    () => page.evaluate(() => document.querySelectorAll('.review-file-slot').length === 5000),
    'Show all did not list every file',
  )
  assert.ok((await page.locator('.review-file-card').count()) < 20, 'Show all mounts thousands of card bodies')
  assert.equal(await draft.inputValue(), 'Keep this draft while browsing.')
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('ramu:review-line', { detail: { fileId: 'file-2500', side: 'new', line: 16, endLine: 16 } }),
    ),
  )
  await page.locator('.review-file-card[data-file-id="file-2500"] .monaco-diff-editor').waitFor()
  assert.ok((await countEditors()) <= 6, 'navigation activated every deferred editor')
})

ramu.test('a 500-match search stays bounded and the keyboard opens the final match', async () => {
  const { project } = await ramu.api('projects.addFolder', ramu.repos.search)
  const searchTask = await ramu.api('tasks.create', {
    projectId: project.id,
    title: 'Large search results',
    mode: 'current',
  })
  await showTask(ramu, searchTask, { views: [], activeViewId: null }, { openTaskIds: [searchTask.id] })
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search project files', exact: true }).fill('performance_fixture_token')
  await page.locator('.search-summary', { hasText: '500' }).waitFor()
  assert.ok((await page.locator('.search-results [data-virtual-index]').count()) < 70, 'search mounts every row')
  await page.locator('.search-results button').first().focus()
  await page.keyboard.press('End')
  await ramu.until(
    () => page.evaluate(() => document.activeElement?.getAttribute('title')?.includes(':100:1')),
    'End did not reach the last match',
  )
  await page.keyboard.press('Enter')
  await page.locator('.file-view:visible').waitFor()
  ramu.noErrors()
})

ramu.test('a large review tree mounts a bounded number of rows', () => {
  assert.ok(treeRows < 60, `the 5,000-file review tree mounted ${treeRows} rows`)
})
