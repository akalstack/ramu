// Screenshots of goals and file changes for design review: pinned and finished goals, the turn's changes card, and the Changes tab.
// Isolated profile, fake agents and a seeded review; no model calls. Run after `pnpm build`: node scripts/goal-changes-shots.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron } from 'playwright-core'

const root = resolve(import.meta.dirname, '..'), dir = mkdtempSync(join(tmpdir(), 'ramu-goal-changes-'))
const profile = join(dir, 'profile'), shots = join(root, 'output', 'playwright', 'goal-changes'); mkdirSync(shots, { recursive: true })
const env = { ...process.env, RAMU_USER_DATA: profile, RAMU_WORKTREES: join(dir, 'worktrees'), RAMU_FAKE_AGENT: '1' }
delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL
const theme = process.env.THEME ?? 'dark'
let app, page, repo
const errors = []
const invoke = (method, ...args) => page.evaluate(({ method, args }) => window.ramu.invoke(method, ...args), { method, args })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, message) { for (let i = 0; i < 150; i++) { const value = await fn(); if (value) return value; await sleep(100) } throw new Error(message) }
// Icons inside buttons should stay at the compact/regular icon size; anything larger is reported.
const oversized = new Map()
const scanIcons = async (where) => { for (const hit of await page.evaluate(() => [...document.querySelectorAll('button svg, [role="button"] svg, a svg')].filter((svg) => { const r = svg.getBoundingClientRect(); return r.width > 18 && r.width < 200 && svg.closest('.chat-changes-icon, .ramu-loader, .empty-media, [data-slot="empty-media"], [aria-label="Animate Ramu logo"]') === null }).map((svg) => { const b = svg.closest('button, [role="button"], a'); return `${Math.round(svg.getBoundingClientRect().width)}px ${b?.getAttribute('aria-label') || b?.textContent?.trim().slice(0, 30) || '?'} [${(b?.className || '').toString().split(' ').slice(0, 3).join(' ')}]` }))) if (!oversized.has(hit)) oversized.set(hit, where) }
const shot = async (name, locator) => { await scanIcons(name); await sleep(300); await (locator ?? page).screenshot({ path: join(shots, `${theme}-${name}.png`), animations: 'disabled' }); console.log(`shot ${name}`) }
async function openView(task, view) {
  const ui = await invoke('ui.get')
  await invoke('ui.setTask', task.id, { views: [view], activeViewId: view.id })
  await invoke('ui.setWorkspace', { ...ui.workspace, openTaskIds: [...new Set([...ui.workspace.openTaskIds, task.id])], activeTaskId: task.id })
  await page.reload(); await page.locator('.shell').waitFor()
  await page.locator('.task-row').filter({ has: page.getByText(task.title, { exact: true }) }).click()
}
const file = (id, path, before, after, added, removed) => ({ id, repoId: repo.id, repoName: repo.name, path, status: before ? 'modified' : 'added', binary: false, oldHash: 'old', newHash: 'new', oldContent: before, newContent: after, addedLines: added, removedLines: removed })
try {
  app = await electron.launch({ args: [root], cwd: root, env, timeout: 30000 })
  page = await app.firstWindow(); page.on('pageerror', (e) => { if (!/^(Canceled|Make sure the ref is set)/.test(e.message)) errors.push(e.message) })
  await page.locator('.shell').waitFor()
  await invoke('settings.app.set', { ...await invoke('settings.app.get'), language: 'en', recapsEnabled: false })
  await page.setViewportSize?.({ width: 1440, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const codex = { provider: 'codex', model: 'fake-codex', effort: null, serviceTier: 'standard', access: 'full', autoFallback: false }
  const claude = { provider: 'claude-code', model: 'fake-claude', effort: 'medium', access: 'full', autoFallback: false, serviceTier: 'standard' }

  // A real repo holding the changed files, so the Changes tab reads as it does in use.
  const before = Array.from({ length: 24 }, (_, i) => `export const line${i} = ${i}`).join('\n') + '\n'
  const after = { 'src/components/reset/ResetForm.tsx': before.replace('line3 = 3', 'line3 = 30').replace('line9 = 9', 'line9 = 90') + 'export const extra = true\n', 'src/components/reset/ResetPage.tsx': before.replace('line12 = 12', 'line12 = 120'), 'src/api/password.ts': 'export async function reset(email: string) {\n  return fetch(`/api/reset?email=${email}`)\n}\n', 'src/routes.ts': before.replace('line1 = 1', 'line1 = 10'), 'README.md': before.replace('line20 = 20\n', '') }
  const repoDir = join(dir, 'web'); mkdirSync(repoDir, { recursive: true })
  const git = (...args) => execFileSync('git', args, { cwd: repoDir, stdio: 'pipe' })
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 'shots@example.com'); git('config', 'user.name', 'Shots'); git('config', 'commit.gpgsign', 'false')
  for (const [path, content] of Object.entries(after)) { mkdirSync(join(repoDir, path, '..'), { recursive: true }); writeFileSync(join(repoDir, path), content) }
  git('add', '.'); git('commit', '-q', '-m', 'init')
  const { project } = await invoke('projects.addFolder', realpathSync(repoDir))
  repo = (await invoke('repos.list', project.id))[0]
  // A goal the agent finished, with a changes card in the same turn.
  const done = await invoke('tasks.create', { projectId: project.id, title: 'Password reset flow', mode: 'current' })
  const doneSession = await invoke('agent.start', done.id, 'Verify goals [goal tool]', codex)
  await until(async () => (await invoke('agent.goal', doneSession.id))?.status === 'completed' && (await invoke('agent.get', doneSession.id)).state === 'idle', 'Goal did not complete')
  const files = [
    file('a', 'src/components/reset/ResetForm.tsx', before, before.replace('line3 = 3', 'line3 = 30').replace('line9 = 9', 'line9 = 90') + 'export const extra = true\n', 3, 2),
    file('b', 'src/components/reset/ResetPage.tsx', before, before.replace('line12 = 12', 'line12 = 120'), 1, 1),
    file('c', 'src/api/password.ts', '', 'export async function reset(email: string) {\n  return fetch(`/api/reset?email=${email}`)\n}\n', 3, 0),
    file('d', 'src/routes.ts', before, before.replace('line1 = 1', 'line1 = 10'), 1, 1),
    file('e', 'README.md', before, before.replace('line20 = 20\n', ''), 0, 1),
  ]
  const events = await invoke('agent.events', doneSession.id)
  const review = { id: 'shot-review', taskId: done.id, sessionId: doneSession.id, createdAt: Date.now(), state: 'ready', roots: [], comments: [], aiState: 'idle', aiSummary: null, startSeq: 0, endSeq: events.length + 1000, files }
  const db = new DatabaseSync(join(profile, 'ramu.db'))
  for (const value of [review]) db.prepare('INSERT INTO change_reviews VALUES (?, ?, ?, ?, ?, ?)').run(value.id, done.id, doneSession.id, 'ready', JSON.stringify(value), value.createdAt)
  db.close()
  await openView(done, { id: 'shot-done', kind: 'agent', sessionId: doneSession.id })
  await page.locator('.chat-changes:visible').first().waitFor()
  await shot('chat-goal-done')
  await shot('detail-changes-card', page.locator('.chat-changes:visible').first())
  await shot('detail-goal-done', page.locator('.goal-done:visible').first())
  await page.locator('.chat-changes:visible').getByRole('button', { name: 'View changes', exact: true }).click()
  await page.locator('.changes-page:visible .review-file-card').first().waitFor()
  await sleep(800)
  await shot('changes-tab')
  await page.getByRole('button', { name: 'Show file tree', exact: true }).click()
  await shot('changes-tab-tree')
  await page.setViewportSize({ width: 2400, height: 1000 })
  await page.getByRole('button', { name: 'Hide file tree', exact: true }).click()
  await page.getByRole('button', { name: 'Show file tree', exact: true }).click()
  await sleep(800)
  await shot('changes-tab-wide')
  await page.setViewportSize({ width: 1440, height: 900 })

  // A goal in progress: paused after Stop, pinned above the composer.
  const paused = await invoke('tasks.create', { projectId: 'no-project', title: 'Paused goal', mode: 'current' })
  const pausedSession = await invoke('agent.start', paused.id, '/goal Ship the password reset flow with tests and docs, including the email template, rate limiting on the reset endpoint, and a migration for the reset token table', codex)
  await invoke('agent.stop', pausedSession.id)
  await openView(paused, { id: 'shot-paused', kind: 'agent', sessionId: pausedSession.id })
  await page.locator('.goal-bar:visible').waitFor()
  await shot('chat-goal-paused')
  await shot('detail-goal-paused', page.locator('.chat-tray:visible'))
  await page.locator('.goal-bar:visible .goal-summary').click()
  await shot('detail-goal-paused-open', page.locator('.chat-tray:visible'))

  // Changing the model while idle: the separator shows old → new.
  await invoke('agent.configure', pausedSession.id, { ...claude, effort: 'high' })
  await page.locator('.conversation-separator:visible').filter({ hasText: '→' }).first().waitFor()
  await shot('settings-change', page.locator('.conversation-separator:visible').filter({ hasText: '→' }).first())
  // While idle, a new choice waits for the next send: the model chip shows current → new.
  await page.getByRole('button', { name: 'Model and effort controls' }).last().click()
  await page.getByRole('button', { name: 'Reasoning and service tier' }).click()
  await page.getByRole('menuitemradio', { name: /^Low/ }).or(page.getByRole('option', { name: /^Low/ })).or(page.getByRole('radio', { name: /^Low/ })).first().click()
  await page.keyboard.press('Escape').catch(() => {})
  await sleep(300)
  await shot('model-chip-pending', page.locator('.composer:visible'))
  // Switching provider: one icon on each side of the arrow.
  await page.getByRole('button', { name: 'Model and effort controls' }).last().click()
  await page.getByRole('button', { name: /^Select model/ }).click()
  await page.locator('.model-picker:visible').getByText('Codex (test)', { exact: true }).click()
  await page.keyboard.press('Escape').catch(() => {})
  await sleep(300)
  await shot('model-chip-provider', page.locator('.composer:visible'))
  // A goal while the agent works.
  const active = await invoke('tasks.create', { projectId: 'no-project', title: 'Active goal', mode: 'current' })
  const activeSession = await invoke('agent.start', active.id, '/goal Survey the code and list every unused export [slow]', claude)
  await openView(active, { id: 'shot-active', kind: 'agent', sessionId: activeSession.id })
  if (await page.locator('.goal-bar:visible').count()) await shot('chat-goal-active')
  // A steer waiting for the active tools: the button stays, disabled, and its hover tip says why.
  await invoke('agent.submit', activeSession.id, 'Also check the test helpers', 'steer', [], [])
  await invoke('agent.submit', activeSession.id, 'Then summarise the findings', 'queue', [], [])
  const steer = page.locator('.queued-message:visible').first().locator('div[title]').first()
  await steer.waitFor()
  await steer.hover()
  await page.locator('[data-slot="tooltip-content"], [role="tooltip"]').first().waitFor({ timeout: 3000 }).catch(() => {})
  await shot('queue-steer-hover', page.locator('.composer-dock:visible'))
  // An error toast, the same kind Git raises.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('ramu:notification', { detail: { message: 'The staged diff is too large for a commit draft. Stage a smaller commit first.', source: 'Git · ramu' } })))
  await page.locator('[data-slot="toast"]').first().waitFor()
  await shot('toast-error', page.locator('[data-slot="toast"]').first())
  // Other surfaces: home, settings, sidebar panels.
  for (const [name, open] of [['home', () => page.getByRole('button', { name: 'New chat' }).first().click()], ['settings', () => page.evaluate(() => window.dispatchEvent(new Event('ramu:settings')))]]) { await open().catch(() => {}); await sleep(600); await scanIcons(name); await page.keyboard.press('Escape').catch(() => {}) }
  console.log(oversized.size ? `Oversized icons:\n${[...oversized].map(([hit, where]) => `  ${hit} (${where})`).join('\n')}` : 'ok - no oversized button icons')
  console.log(`Screenshots: ${shots}`)
  if (errors.length) console.log('page errors:', errors)
} catch (e) {
  console.error(e)
  await page?.screenshot({ path: join(shots, 'failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  try { await invoke('background.stop') } catch {}
  await app?.close()
  if (process.env.KEEP) console.log('kept', dir); else rmSync(dir, { recursive: true, force: true })
}
