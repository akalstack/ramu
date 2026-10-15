// Electron integration journey against an isolated profile; no model calls or real project writes.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { request } from 'node:http'
import { createHash } from 'node:crypto'
import { _electron as electron } from 'playwright-core'
const appDir = process.env.RAMU_E2E_APP_DIR
    ? resolve(process.env.RAMU_E2E_APP_DIR)
    : resolve(import.meta.dirname, '..', '..', 'apps', 'desktop'),
  dir = mkdtempSync(join(tmpdir(), 'ramu-learning-ui-'))
const profile = join(dir, 'profile'),
  repo = join(dir, 'demo')
const shots = process.env.RAMU_E2E_SCREENSHOTS
  ? resolve(process.env.RAMU_E2E_SCREENSHOTS)
  : join(appDir, 'output', 'playwright', 'learning')
mkdirSync(shots, { recursive: true })
mkdirSync(repo)
execFileSync('git', ['init', '-q'], { cwd: repo })
writeFileSync(join(repo, 'notes.md'), 'Saved project notes\n')
writeFileSync(join(repo, 'other.ts'), 'export const example = 1\n')
writeFileSync(
  join(repo, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: { strict: true, module: 'esnext', target: 'esnext', moduleResolution: 'bundler' },
  }),
)
mkdirSync(join(repo, 'src', 'orders'), { recursive: true })
writeFileSync(
  join(repo, 'src', 'orders', 'queue.ts'),
  'export class OrderQueue {\n  enqueueUrgent(order: Order): void {\n    this.items.unshift(order)\n  }\n}\n',
)
writeFileSync(join(repo, 'format-me.ts'), 'const   x=1\ndebugger\n')
mkdirSync(join(repo, '.agents', 'skills', 'smoke-skill'), { recursive: true })
writeFileSync(
  join(repo, '.agents', 'skills', 'smoke-skill', 'SKILL.md'),
  '---\nname: smoke-skill\ndescription: Review the smoke fixture notes\n---\nRead notes.md and summarize it.\n',
)
const env = { ...process.env, RAMU_USER_DATA: profile, RAMU_WORKTREES: join(dir, 'worktrees'), RAMU_FAKE_AGENT: '1' }
delete env.ELECTRON_RENDERER_URL
const socketPath = join(
  tmpdir(),
  `ramu-${process.getuid()}-${createHash('sha256').update(profile).digest('hex').slice(0, 20)}.sock`,
)
const api = (method, args = []) =>
  new Promise((resolve, reject) => {
    const req = request({ socketPath, path: '/invoke', method: 'POST' }, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => {
        try {
          const response = JSON.parse(data)
          response.error ? reject(new Error(response.error)) : resolve(response.value)
        } catch (e) {
          reject(e)
        }
      })
    })
    req.on('error', reject)
    req.end(JSON.stringify({ method, args }))
  })
let lastStep = 'start'
const check = (value, message) => {
  if (!value) throw new Error(message)
  lastStep = message
  console.log(`ok - ${message}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// The daemon scheduler ticks every 5 s, so schedule runs can take two ticks to start and complete.
async function until(fn, message, attempts = 100) {
  for (let i = 0; i < attempts; i++) {
    const result = await fn()
    if (result) return result
    await sleep(100)
  }
  throw new Error(message)
}
let app, page
const errors = []
// Monaco's own teardown noise: a cancelled token firing on dispose, and the inline-edit gutter animating after it is torn down.
const MONACO_NOISE = /^(Canceled|Make sure the ref is set before accessing the element)/
async function launch() {
  app = await electron.launch({
    ...(process.env.RAMU_PACKAGED_EXECUTABLE
      ? { executablePath: process.env.RAMU_PACKAGED_EXECUTABLE, args: [] }
      : { args: [appDir] }),
    cwd: appDir,
    env,
    timeout: 30000,
  })
  page = await app.firstWindow()
  page.on(
    'pageerror',
    (e) =>
      !MONACO_NOISE.test(e.message) &&
      errors.push(process.env.RAMU_E2E_STACKS ? `[after: ${lastStep}] ${e.message}\n${e.stack}` : e.message),
  )
  await page.waitForSelector('.shell', { timeout: 20000 })
}
// Focused desktop flow for settings, staged learning, memory history and persistence.
try {
  await launch()
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'chats' } })))
  await page.getByRole('combobox', { name: 'Response style', exact: true }).click()
  await page.getByRole('option', { name: 'ADHD-friendly', exact: true }).click()
  await page.getByRole('combobox', { name: 'Tool output compression', exact: true }).click()
  await page.getByRole('option', { name: 'Aggressive', exact: true }).click()
  await page.getByRole('option').first().waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await until(
    async () => (await api('settings.app.get')).intelligence.responseStyle === 'adhd',
    'Style was not persisted',
  )
  check(
    (await api('settings.app.get')).intelligence.compression === 'aggressive',
    'Response style and independent compression settings persist',
  )
  await page.screenshot({ path: join(shots, 'response-styles.png') })
  await page.keyboard.press('Escape')
  const preferences = await api('settings.app.get')
  await api('settings.app.set', [{ ...preferences, intelligence: { ...preferences.intelligence, learning: 'review' } }])
  const { project } = await api('projects.addFolder', [repo])
  const task = await api('tasks.create', [{ projectId: project.id, title: 'Learning smoke', mode: 'current' }])
  const session = await api('agent.start', [
    task.id,
    '[learn-fixture] Verify the retry procedure',
    {
      provider: 'claude-code',
      model: 'fake-claude',
      effort: 'medium',
      access: 'full',
      autoFallback: false,
      responseStyle: 'concise',
    },
  ])
  await until(async () => (await api('agent.get', [session.id])).state === 'idle', 'Fixture chat did not finish')
  await api('learning.run')
  const proposal = await until(
    async () =>
      (await api('learning.get')).jobs.find((job) => job.sessionId === session.id && job.status === 'pending'),
    'Learning did not stage a proposal',
  )
  check((await api('learning.get')).skills.length === 0, 'Review-first learning leaves proposals unapplied')
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'memory' } })))
  await page.getByText('Review proposed changes', { exact: true }).click()
  await page.getByText('Session checkpoint', { exact: true }).waitFor()
  await page.screenshot({ path: join(shots, 'learning-review.png') })
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  const learned = await until(async () => (await api('learning.get')).skills[0], 'Approved skill did not appear')
  await page.getByRole('button', { name: 'Pin', exact: true }).click()
  check((await api('learning.get')).skills[0].pinned, 'Managed skills can be reviewed, applied and pinned')
  check(
    (await api('agent.checkpoint', [session.id])).summary.includes('no deployment'),
    'Learning stores a source-session checkpoint',
  )
  check(
    (await api('skills.list', [task.id])).some((skill) => skill.name === learned.name),
    'Managed skills appear in the chat skill catalog',
  )
  const note = (await api('memory.get')).memories.find((memory) => memory.source.sessionId === session.id)
  await api('memory.save', [
    {
      projectId: project.id,
      kind: note.kind,
      title: note.title,
      content: 'User-confirmed retry guidance.',
      tags: [],
      importance: 3,
    },
    note.id,
  ])
  await page.getByRole('button', { name: 'Memory history', exact: true }).click()
  const memoryCard = page.locator('.memory-card').filter({ hasText: 'Retry fixture guidance' })
  await memoryCard.getByText('Earlier revision', { exact: true }).first().waitFor({ state: 'attached' })
  const previous = memoryCard.locator('details').first()
  await previous.locator('summary').click()
  await page.screenshot({ path: join(shots, 'memory-history.png') })
  await previous.getByRole('button', { name: 'Restore revision', exact: true }).click()
  check(
    (await api('memory.get')).memories.find((memory) => memory.id === note.id).content === note.content,
    'Memory history restores an earlier revision',
  )
  await page.getByRole('button', { name: 'History', exact: true }).last().click()
  await page.screenshot({ path: join(shots, 'managed-skills.png') })
  await page.keyboard.press('Escape')
  const ui = await api('ui.get'),
    viewId = `checkpoint-${session.id}`
  await api('ui.setTask', [
    task.id,
    { views: [{ id: viewId, kind: 'agent', sessionId: session.id }], activeViewId: viewId, activeAgentViewId: viewId },
  ])
  await api('ui.setWorkspace', [{ ...ui.workspace, openTaskIds: [task.id], activeTaskId: task.id }])
  await page.reload()
  await page.waitForSelector('.shell')
  await page
    .locator('.task-row')
    .filter({ has: page.getByText(task.title, { exact: true }) })
    .click()
  await page.getByRole('button', { name: 'Session checkpoint', exact: true }).click()
  const checkpointDialog = page
    .getByRole('alertdialog')
    .filter({ has: page.getByRole('heading', { name: 'Session checkpoint', exact: true }) })
  await checkpointDialog.getByText('Progress for this chat only.', { exact: false }).waitFor()
  await checkpointDialog.getByText('no deployment', { exact: false }).waitFor()
  await page.screenshot({ path: join(shots, 'chat-checkpoint.png'), animations: 'disabled' })
  await checkpointDialog.getByRole('button', { name: 'Done', exact: true }).click()
  check(true, 'Saved checkpoint is available in its chat with historical context')
  await app.close()
  app = null
  await launch()
  check((await api('settings.app.get')).intelligence.responseStyle === 'adhd', 'Response style survives restart')
  check(
    (await api('learning.get')).jobs.find((job) => job.id === proposal.id).status === 'applied',
    'Applied learning survives restart without a duplicate write',
  )
  check((await api('learning.get')).skills[0].pinned, 'Pinned managed skills survive restart')
  check(errors.length === 0, `No renderer errors: ${errors.join(', ')}`)
  console.log(`Screenshots: ${shots}`)
} catch (error) {
  await page?.screenshot({ path: join(shots, 'failure.png') }).catch(() => {})
  console.error(
    await page
      ?.locator('body')
      .innerText()
      .catch(() => 'No renderer'),
  )
  throw error
} finally {
  await app?.close().catch(() => {})
  await api('background.stop').catch(() => {})
  await sleep(300)
  rmSync(dir, { recursive: true, force: true })
}
