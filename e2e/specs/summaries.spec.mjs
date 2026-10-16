// "What Ramu learned": a summary of automatic learning on Home and in Settings, a review chat started from it, and Dismiss.
import assert from 'node:assert/strict'
import { fakeAgent, openSettings, saveSettings, select, startChat, startRamu, useFakeModel } from '../support/index.mjs'

const ramu = await startRamu('summaries', { repos: { demo: [{ 'notes.md': 'Saved project notes\n' }] } })
let summary

ramu.test(
  'automatic learning produces a summary of what was saved, without a model call when nothing changed',
  async () => {
    await useFakeModel(ramu)
    const { project } = await ramu.api('projects.addFolder', ramu.repos.demo)
    const chat = await startChat(ramu, {
      projectId: project.id,
      title: 'Learning source',
      prompt: '[learn-fixture] Verify the retry procedure',
      settings: fakeAgent.claude,
    })
    await ramu.api('learning.run')
    await ramu.until(
      async () => (await ramu.api('memory.get')).memories.some((m) => m.source.sessionId === chat.session.id),
      'learning never saved a memory',
    )
    const result = await ramu.api('summaries.run')
    assert.equal(result.status, 'created')
    summary = (await ramu.api('summaries.get')).summaries[0]
    assert.equal(summary.status, 'unread')
    assert.ok(
      summary.items.some((item) => item.title === 'Retry fixture guidance'),
      'the saved memory is linked',
    )
    assert.ok(
      summary.items.some((item) => item.kind === 'skill'),
      'the created skill is linked',
    )
    const again = await ramu.api('summaries.run')
    assert.equal(again.status, 'skipped', 'nothing new means no second summary')
    assert.equal((await ramu.api('summaries.get')).summaries.length, 1)
  },
)

ramu.test('Home shows the summary with an unread dot and opens it', async () => {
  const { page } = ramu
  await ramu.reload()
  await page.getByRole('button', { name: 'Home', exact: true }).click()
  const card = page.locator('.learned-card')
  await card.getByText('What Ramu learned', { exact: true }).waitFor()
  await card.getByRole('img', { name: 'Unread' }).waitFor()
  await ramu.shot('summary-home')
  await card.getByRole('button').click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByText('What Ramu learned', { exact: true }) })
  await dialog.getByRole('button', { name: 'Retry fixture guidance' }).waitFor()
  await dialog.getByRole('button', { name: 'Looks good', exact: true }).waitFor()
  await ramu.until(
    async () => (await ramu.api('summaries.get')).summaries[0].status === 'read',
    'opening did not mark it read',
  )
  await ramu.shot('summary-view')
})

ramu.test('sending from the summary starts a labelled review thread linked back', async () => {
  const { page } = ramu
  const dialog = page.getByRole('dialog').filter({ has: page.getByText('What Ramu learned', { exact: true }) })
  await dialog.locator('[data-composer-input]').fill('Why did you save the retry note?')
  await dialog.getByRole('button', { name: 'Start review thread', exact: true }).click()
  const chat = await ramu.until(
    async () => (await ramu.api('tasks.list')).find((task) => task.kind === 'library-review'),
    'no review thread was started',
  )
  assert.equal(chat.projectId, 'no-project')
  assert.deepEqual((await ramu.api('summaries.get')).summaries[0].chatIds, [chat.id])
  await page.locator('.task-row').filter({ hasText: 'Review' }).locator('.task-kind').waitFor()
  await ramu.shot('summary-review-chat')
})

ramu.test('settings control the interval, list the history, and Dismiss hides the summary from Home', async () => {
  const { page } = ramu
  await openSettings(ramu, 'Memory & skills')
  await select(ramu, 'Summary', 'Daily')
  await saveSettings(ramu)
  assert.equal((await ramu.api('settings.app.get')).intelligence.summaryInterval, 'daily')
  await openSettings(ramu, 'Memory & skills')
  await page.getByText('What Ramu learned', { exact: true }).first().waitFor()
  await page
    .getByText(/Discussed in thread/)
    .first()
    .waitFor()
  await page
    .getByRole('button', { name: /Retry|Ramu saved/ })
    .first()
    .click()
  await page.getByRole('button', { name: 'Looks good', exact: true }).last().click()
  await ramu.until(
    async () => (await ramu.api('summaries.get')).summaries[0].status === 'dismissed',
    'Dismiss did not stick',
  )
  await page.keyboard.press('Escape')
  await page.locator('.learned-card').waitFor({ state: 'detached' })
  ramu.noErrors()
})
