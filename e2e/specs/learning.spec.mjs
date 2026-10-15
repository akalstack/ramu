// Learning: response style and compression settings, review-first learning, managed skills, memory history and session checkpoints.
import assert from 'node:assert/strict'
import { fakeAgent, openSettings, saveSettings, select, showChat, startChat, startRamu } from '../support/index.mjs'

const ramu = await startRamu('learning', {
  repos: {
    demo: [
      {
        'notes.md': 'Saved project notes\n',
        'tsconfig.json': JSON.stringify({
          compilerOptions: { strict: true, module: 'esnext', target: 'esnext', moduleResolution: 'bundler' },
        }),
        'src/orders/queue.ts':
          'export class OrderQueue {\n  enqueueUrgent(order: Order): void {\n    this.items.unshift(order)\n  }\n}\n',
        '.agents/skills/smoke-skill/SKILL.md':
          '---\nname: smoke-skill\ndescription: Review the smoke fixture notes\n---\nRead notes.md and summarize it.\n',
      },
    ],
  },
})
let chat
let proposal
let note

ramu.test('response style and tool output compression persist independently', async () => {
  await openSettings(ramu, 'Chats')
  await select(ramu, 'Response style', 'ADHD-friendly')
  await select(ramu, 'Tool output compression', 'Aggressive')
  await ramu.shot('response-styles')
  await saveSettings(ramu)
  const { intelligence } = await ramu.api('settings.app.get')
  assert.equal(intelligence.responseStyle, 'adhd')
  assert.equal(intelligence.compression, 'aggressive')
})

ramu.test('review-first learning stages a proposal without applying it', async () => {
  const preferences = await ramu.api('settings.app.get')
  await ramu.api('settings.app.set', {
    ...preferences,
    intelligence: { ...preferences.intelligence, learning: 'review' },
  })
  const { project } = await ramu.api('projects.addFolder', ramu.repos.demo)
  chat = await startChat(ramu, {
    projectId: project.id,
    title: 'Learning smoke',
    prompt: '[learn-fixture] Verify the retry procedure',
    settings: { ...fakeAgent.claude, responseStyle: 'concise' },
  })
  await ramu.api('learning.run')
  proposal = await ramu.until(
    async () =>
      (await ramu.api('learning.get')).jobs.find(
        (job) => job.sessionId === chat.session.id && job.status === 'pending',
      ),
    'learning never staged a proposal',
  )
  assert.equal((await ramu.api('learning.get')).skills.length, 0)
})

ramu.test('a proposal can be reviewed, applied and pinned as a managed skill', async () => {
  const { page } = ramu
  await openSettings(ramu, 'Memory & skills')
  await page.getByText('Review proposed changes', { exact: true }).click()
  await page.getByText('Session checkpoint', { exact: true }).waitFor()
  await ramu.shot('learning-review')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  const skill = await ramu.until(
    async () => (await ramu.api('learning.get')).skills[0],
    'the approved skill never appeared',
  )
  await page.getByRole('button', { name: 'Pin', exact: true }).click()
  await ramu.until(async () => (await ramu.api('learning.get')).skills[0].pinned, 'the skill was not pinned')
  assert.ok(
    (await ramu.api('agent.checkpoint', chat.session.id)).summary.includes('no deployment'),
    'learning stores a source-session checkpoint',
  )
  assert.ok(
    (await ramu.api('skills.list', chat.task.id)).some((entry) => entry.name === skill.name),
    'managed skills reach the chat skill catalog',
  )
})

ramu.test('memory history restores an earlier revision', async () => {
  const { page } = ramu
  note = (await ramu.api('memory.get')).memories.find((memory) => memory.source.sessionId === chat.session.id)
  await ramu.api(
    'memory.save',
    {
      projectId: note.projectId ?? (await ramu.api('projects.list'))[0]?.id,
      kind: note.kind,
      title: note.title,
      content: 'User-confirmed retry guidance.',
      tags: [],
      importance: 3,
    },
    note.id,
  )
  await page.getByRole('button', { name: 'Memory history', exact: true }).click()
  const card = page.locator('.memory-card').filter({ hasText: 'Retry fixture guidance' })
  await card.getByText('Earlier revision', { exact: true }).first().waitFor({ state: 'attached' })
  const previous = card.locator('details').first()
  await previous.locator('summary').click()
  await ramu.shot('memory-history')
  await previous.getByRole('button', { name: 'Restore revision', exact: true }).click()
  await ramu.until(
    async () =>
      (await ramu.api('memory.get')).memories.find((memory) => memory.id === note.id).content === note.content,
    'the revision was not restored',
  )
  await page.getByRole('button', { name: 'History', exact: true }).last().click()
  await ramu.shot('managed-skills')
  await page.keyboard.press('Escape')
})

ramu.test('the saved checkpoint opens from its chat', async () => {
  const { page } = ramu
  await showChat(ramu, chat)
  await page.getByRole('button', { name: 'Session checkpoint', exact: true }).click()
  const dialog = page
    .getByRole('alertdialog')
    .filter({ has: page.getByRole('heading', { name: 'Session checkpoint', exact: true }) })
  await dialog.getByText('Progress for this chat only.', { exact: false }).waitFor()
  await dialog.getByText('no deployment', { exact: false }).waitFor()
  await ramu.shot('chat-checkpoint')
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
})

ramu.test('settings, applied learning and pinned skills survive a restart', async () => {
  await ramu.relaunch()
  assert.equal((await ramu.api('settings.app.get')).intelligence.responseStyle, 'adhd')
  assert.equal(
    (await ramu.api('learning.get')).jobs.find((job) => job.id === proposal.id).status,
    'applied',
    'no duplicate write',
  )
  assert.ok((await ramu.api('learning.get')).skills[0].pinned)
  ramu.noErrors()
})
