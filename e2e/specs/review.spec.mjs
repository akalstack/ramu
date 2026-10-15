// Captured reviews and undo: comments, viewed state, sending review feedback, and restoring files from chat Edit.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fakeAgent, showTask, startRamu } from '../support/index.mjs'

const ramu = await startRamu('review')
const { page, api, until, check } = ramu
const settings = { ...fakeAgent.claude, access: 'edits' }
let task, session, review

const openReview = () =>
  showTask(ramu, task, {
    views: [{ id: `review-${review.id}`, kind: 'review', taskId: task.id, reviewId: review.id }],
    activeViewId: `review-${review.id}`,
  }).then(() => page.locator('.changes-page:visible').waitFor())
const userEvents = async () => (await api('agent.events', session.id)).filter((e) => e.kind === 'user')

ramu.test('a run that changes files captures a review', async () => {
  task = await api('tasks.create', { projectId: 'no-project', title: 'Review fixture', mode: 'current' })
  session = await api('agent.start', task.id, 'Continue in background', settings)
  await until(async () => (await api('agent.get', session.id)).state === 'needs-input', 'permission request')
  const request = (await api('agent.events', session.id)).findLast((e) => e.kind === 'permission-request')
  // Change only a disposable fixture while the run is paused, exercising before/after capture.
  writeFileSync(join(session.cwd, 'review.txt'), 'Changed during the agent run\n')
  await api('agent.replyPermission', session.id, request.requestId, true)
  await until(async () => (await api('agent.get', session.id)).state === 'idle', 'run to finish')
  review = await until(
    async () => (await api('reviews.list', session.id)).find((r) => r.state === 'ready' && r.files.length),
    'captured changes',
  )
})

ramu.test('file and line comments save without sending', async () => {
  await openReview()
  await page.getByRole('button', { name: 'File comment', exact: true }).click()
  await page.getByRole('textbox', { name: 'Comment on review.txt', exact: true }).fill('Keep the existing behavior too')
  await page.getByRole('button', { name: 'Comment', exact: true }).click()
  await until(async () => (await api('reviews.get', review.id)).comments.length === 1, 'file comment saved')
  check((await userEvents()).length === 1, 'Saving a review comment does not send it')
  check(
    (await api('reviews.get', review.id)).comments[0].scope === 'file',
    'Header comment action saves a file comment',
  )
  const viewed = page.getByRole('checkbox', { name: 'Mark review.txt as viewed', exact: true })
  await viewed.check()
  check((await page.locator('.review-file-card.viewed .review-diff').count()) === 0, 'Viewed collapses the file diff')
  await page.getByText('1 / 1 viewed', { exact: true }).waitFor({ state: 'attached' })
  await openReview()
  check(await viewed.isChecked(), 'Viewed persists when reopening the review')
  await viewed.uncheck()
  await page.locator('.review-file-card .review-diff').waitFor()
  await page.locator('.review-file-card .review-diff .editor.modified .line-numbers').first().click()
  await page.locator('.review-inline-interaction textarea').fill('Line-specific feedback')
  await page.locator('.review-inline-interaction').getByRole('button', { name: 'Comment', exact: true }).click()
  const current = await until(async () => {
    const r = await api('reviews.get', review.id)
    return r.comments.length === 2 && r
  }, 'line comment saved')
  const line = current.comments.find((c) => c.text === 'Line-specific feedback')
  check(line.scope === 'line' && line.line >= 1, 'Selection comment saves line scope')
  await api('reviews.removeComment', review.id, line.id)
  await ramu.shot('review')
})

ramu.test('comments alone can be sent with pinned file context', async () => {
  await api('agent.configure', session.id, { ...settings, access: 'full' })
  await page.getByRole('button', { name: 'Open chat', exact: true }).click()
  const chat = page.locator('.agent-view:visible')
  await chat.getByLabel('1 review comment attached', { exact: true }).waitFor()
  check(await chat.getByRole('button', { name: 'Send', exact: true }).isEnabled(), 'Review comments enable Send')
  writeFileSync(
    join(session.cwd, 'feedback-context.txt'),
    'Additional context for the review: preserve compatibility.\n',
  )
  const file = (await api('files.all', session.taskId)).find((f) => f.path === 'feedback-context.txt')
  check(!!file, 'Review context file is available in the chat workspace')
  await chat.locator('.composer').evaluate((element, file) => {
    const transfer = new DataTransfer()
    transfer.setData('application/x-ramu-file', JSON.stringify(file))
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }))
  }, file)
  await chat.getByRole('button', { name: 'Remove feedback-context.txt', exact: true }).waitFor()
  await chat.getByRole('button', { name: 'Send', exact: true }).click()
  await until(
    async () =>
      (await userEvents()).some(
        (e) =>
          e.text.includes('Changed during the agent run') &&
          e.text.includes('Keep the existing behavior too') &&
          e.text.includes('<file-context>') &&
          e.text.includes('preserve compatibility'),
      ),
    'feedback with recorded code and file context',
  )
  await until(async () => (await api('agent.get', session.id)).state === 'idle', 'feedback run to finish')
})

ramu.test('undo lives in chat Edit, refuses stale and conflicted files, and keeps history', async () => {
  await openReview()
  check(
    (await page.getByRole('button', { name: 'Preview restore', exact: true }).count()) === 0,
    'Undo is not offered on the Changes page',
  )
  await page.getByRole('button', { name: 'Open chat', exact: true }).click()
  await page.locator('.agent-view:visible').getByRole('button', { name: 'Edit message', exact: true }).first().click()
  await page.getByRole('button', { name: 'Preview restore', exact: true }).click()
  const undo = page.getByRole('alertdialog', { name: 'Restore files before this message' })
  const restore = (count) => undo.getByRole('button', { name: `Restore selected files · ${count}`, exact: true })
  await undo.getByRole('checkbox', { name: 'Restore review.txt' }).waitFor()
  check(
    await undo.getByRole('checkbox', { name: 'Restore review.txt' }).isChecked(),
    'Undo preview selects eligible files',
  )
  await ramu.shot('undo')
  writeFileSync(join(session.cwd, 'review.txt'), 'Later user edit\n')
  await restore(1).click()
  await undo.getByText(/changed after preview/).waitFor()
  check(
    readFileSync(join(session.cwd, 'review.txt'), 'utf8') === 'Later user edit\n',
    'Stale undo refuses to overwrite later edits',
  )
  await undo.getByRole('button', { name: 'Refresh preview', exact: true }).click()
  await undo.getByText('The added file has later edits; it will not be removed').first().waitFor()
  check(await restore(0).isDisabled(), 'Conflicted files cannot be undone')
  writeFileSync(join(session.cwd, 'review.txt'), 'Changed during the agent run\n')
  await undo.getByRole('button', { name: 'Refresh preview', exact: true }).click()
  await restore(1).click()
  await until(() => !existsSync(join(session.cwd, 'review.txt')), 'undo to remove the added file')
  await until(async () => (await api('reviews.get', review.id)).undoFileIds?.length === 1, 'undo metadata saved')
  const editing = page.getByRole('region', { name: 'Editing message', exact: true })
  check(
    await editing.getByText('Selected files restored.', { exact: true }).isVisible(),
    'Edit offers file restore before resending',
  )
  await editing.getByRole('textbox', { name: 'Edit your message', exact: true }).fill('Revised request after restoring')
  await editing.getByRole('button', { name: 'Send', exact: true }).click()
  await until(
    async () =>
      (await userEvents()).some(
        (e) => e.text.includes('Revised request after restoring') && e.text.includes('were restored using Ramu'),
      ),
    'edited request with restore context',
  )
  await until(async () => (await api('agent.get', session.id)).state === 'idle', 'revised request to finish')
  ramu.noErrors()
})
