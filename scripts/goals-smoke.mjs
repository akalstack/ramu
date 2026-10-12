// Real Electron UI and daemon with a temporary profile and fake providers; no model calls.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

const root = resolve(import.meta.dirname, '..')
const dir = mkdtempSync(join(tmpdir(), 'ramu-goals-'))
const shots = join(root, 'output', 'playwright', 'goals')
mkdirSync(shots, { recursive: true })
const env = { ...process.env, RAMU_USER_DATA: join(dir, 'profile'), RAMU_WORKTREES: join(dir, 'worktrees'), RAMU_FAKE_AGENT: '1' }
delete env.ELECTRON_RENDERER_URL
let app, page
const errors = []
const invoke = (method, ...args) => page.evaluate(({ method, args }) => window.ramu.invoke(method, ...args), { method, args })
const waitForGoal = async (id, predicate) => {
  const end = Date.now() + 15_000
  while (Date.now() < end) {
    const goal = await invoke('agent.goal', id)
    if (predicate(goal)) return goal
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  console.error(await invoke('agent.events', id))
  throw new Error('Goal did not reach the expected state')
}
const openSettings = async () => {
  await page.evaluate(() => window.dispatchEvent(new Event('ramu:settings')))
  await page.locator('.settings-page').waitFor()
  await page.getByRole('button', { name: 'Goals', exact: true }).click()
}
const select = async (name, option) => {
  await page.getByRole('combobox', { name, exact: true }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}
try {
  app = await electron.launch({ args: [root], cwd: root, env, timeout: 30_000 })
  page = await app.firstWindow()
  page.on('pageerror', (e) => { if (!/^(Canceled|Make sure the ref is set)/.test(e.message)) errors.push(e.message) })
  await page.locator('.shell').waitFor()
  await invoke('settings.app.set', { ...await invoke('settings.app.get'), language: 'en', recapsEnabled: false })
  await page.reload(); await page.locator('.shell').waitFor()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.deepEqual((await invoke('settings.app.get')).goals, { mode: 'auto', maxTurns: 10 })
  await openSettings()
  assert.equal(await page.getByRole('combobox', { name: 'Maximum continuation turns', exact: true }).innerText(), '10')
  await select('Maximum continuation turns', 'Unlimited')
  await page.screenshot({ path: join(shots, 'settings-unlimited.png'), animations: 'disabled' })
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.locator('.settings-page').waitFor({ state: 'detached' })
  assert.deepEqual((await invoke('settings.app.get')).goals, { mode: 'auto', maxTurns: null })
  await openSettings(); await select('Goal detection', 'Manual')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal((await invoke('settings.app.get')).goals.mode, 'auto')
  console.log('ok - Goals settings default, Unlimited, Save and Cancel')

  const settings = { provider: 'codex', model: 'fake-codex', effort: null, serviceTier: 'standard', access: 'full', autoFallback: false }
  const task = await invoke('tasks.create', { projectId: 'no-project', title: 'Goal smoke', mode: 'current' })
  const session = await invoke('agent.start', task.id, 'Verify goals [goal tool]', settings)
  const goal = await waitForGoal(session.id, (goal) => goal?.status === 'completed')
  assert.equal(goal.turns, 1)
  assert.equal(goal.objective, 'Verify the goal smoke fixture [goal tool]')
  console.log('ok - Agent detects a goal through MCP, continues once, and reports completion')

  const pausedTask = await invoke('tasks.create', { projectId: 'no-project', title: 'Paused goal', mode: 'current' })
  const pausedSession = await invoke('agent.start', pausedTask.id, '/goal Keep working on the fixture', settings)
  await invoke('agent.stop', pausedSession.id)
  assert.equal((await invoke('agent.goal', pausedSession.id)).status, 'paused')
  const ui = await invoke('ui.get'), viewId = `goal-smoke-${pausedSession.id}`
  await invoke('ui.setTask', pausedTask.id, { views: [{ id: viewId, kind: 'agent', sessionId: pausedSession.id }], activeViewId: viewId })
  await invoke('ui.setWorkspace', { ...ui.workspace, openTaskIds: [...new Set([...ui.workspace.openTaskIds, pausedTask.id])], activeTaskId: pausedTask.id })
  await page.reload(); await page.locator('.shell').waitFor()
  await page.locator('.task-row').filter({ has: page.getByText(pausedTask.title, { exact: true }) }).click()
  const bar = page.locator('.goal-bar:visible')
  await bar.getByText('Goal paused', { exact: true }).waitFor()
  await page.screenshot({ path: join(shots, 'chat-paused.png'), animations: 'disabled' })
  await bar.getByRole('button', { name: 'Resume goal', exact: true }).click()
  await waitForGoal(pausedSession.id, (goal) => goal?.turns >= 1)
  await invoke('agent.stop', pausedSession.id)
  await page.reload(); await page.locator('.shell').waitFor()
  await page.locator('.task-row').filter({ has: page.getByText(pausedTask.title, { exact: true }) }).click()
  assert.equal((await invoke('settings.app.get')).goals.maxTurns, null)
  assert.equal((await invoke('agent.goal', pausedSession.id)).status, 'paused')
  await page.locator('.goal-bar:visible').getByRole('button', { name: 'Clear goal', exact: true }).click()
  await page.locator('.goal-bar:visible').waitFor({ state: 'detached' })
  assert.equal(await invoke('agent.goal', pausedSession.id), null)
  assert.deepEqual(errors, [])
  console.log('ok - Stop pauses, Resume restarts, and goal/settings survive renderer reload')
  await invoke('background.stop')
} finally {
  try { await invoke('background.stop') } catch {}
  await app?.close()
  rmSync(dir, { recursive: true, force: true })
}
