// Palette navigation against an isolated Electron profile and simulated agents.
// Run after pnpm build: node scripts/smoke/command-palette-smoke.mjs
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

const appDir = resolve(import.meta.dirname, '..', '..', 'apps', 'desktop')
const fixture = mkdtempSync(join(tmpdir(), 'ramu-palette-'))
const env = {
  ...process.env,
  RAMU_USER_DATA: join(fixture, 'profile'),
  RAMU_WORKTREES: join(fixture, 'worktrees'),
  RAMU_FAKE_AGENT: '1',
}
delete env.ELECTRON_RENDERER_URL
delete env.ELECTRON_RUN_AS_NODE
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
let app, page
const errors = []
const api = (method, ...args) => page.evaluate(([method, args]) => window.ramu.invoke(method, ...args), [method, args])
async function palette(query) {
  await page.keyboard.press(`${mod}+Shift+p`)
  const dialog = page.getByRole('dialog', { name: 'Command palette', exact: true })
  await dialog.waitFor()
  await dialog.locator('[data-slot=command-input]').fill(`>${query}`)
  return dialog
}
async function run(label) {
  const dialog = await palette(label)
  await dialog.getByRole('option').filter({ hasText: label }).click()
  await dialog.waitFor({ state: 'detached' })
}
try {
  app = await electron.launch({ args: [appDir], cwd: appDir, env })
  page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.waitForSelector('.shell')

  // Global navigation must work before any project or chat exists.
  await page.keyboard.press(`${mod}+b`)
  await page.locator('.shell.no-sidebar').waitFor()
  await run('Show schedules')
  await page.locator('.shell:not(.no-sidebar)').waitFor()
  await page.locator('.automation-page').getByRole('heading', { name: 'Schedules', exact: true }).waitFor()
  console.log('ok - Show schedules works without a project and reveals the sidebar')
  await run('New schedule')
  await page.locator('.schedule-editor').waitFor()
  await page.getByRole('button', { name: 'Close schedule editor', exact: true }).click()
  await run('Show home')
  await page.getByRole('heading', { name: 'What should we work on?', exact: true }).waitFor()
  await run('New schedule')
  await page.locator('.schedule-editor').waitFor()
  assert.equal((await api('schedules.list')).length, 0)
  console.log('ok - New schedule opens its editor from both Schedules and Home without scheduling work')

  // Every settings section is discoverable through a direct command.
  for (const section of [
    'Appearance',
    'Editor & Terminal',
    'Chats',
    'Git',
    'Keyboard shortcuts',
    'Providers',
    'Access & Fallback',
    'Goals',
    'Memory',
    'Sub-agents',
    'Advisor',
    'Background & Recaps',
    'Updates',
  ]) {
    await run(`Open ${section} settings`)
    await page.locator('.settings-page-content').getByRole('heading', { name: section, exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await page.locator('.settings-page').waitFor({ state: 'detached' })
  }
  await run('Model sets and reasoning defaults')
  await page.locator('.settings-page-content').getByRole('heading', { name: 'Models', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  console.log('ok - All settings sections have working palette commands')
  const project = await palette('Add project')
  assert.equal(await project.getByRole('option').filter({ hasText: 'Add project…' }).count(), 1)
  await page.keyboard.press('Escape')
  const noChat = await palette('Toggle aside')
  assert.equal(await noChat.getByRole('option').filter({ hasText: 'Toggle aside' }).count(), 0)
  await page.keyboard.press('Escape')

  // Chat panel commands reuse the same panels and shortcuts as the chat header.
  const prefs = await api('settings.app.get')
  await api('settings.app.set', {
    ...prefs,
    advisor: {
      enabled: true,
      wait: true,
      step: { id: 'advisor', provider: 'codex', model: 'fake-codex', effort: 'high' },
    },
  })
  const task = await api('tasks.create', { projectId: 'no-project', title: 'Palette chat', mode: 'current' })
  const session = await api('agent.start', task.id, '[advisor] Say hello', {
    provider: 'claude-code',
    model: 'fake-claude',
    effort: 'medium',
    access: 'full',
    autoFallback: false,
  })
  const ui = await api('ui.get')
  await api('ui.setTask', task.id, {
    views: [{ id: 'chat', kind: 'agent', sessionId: session.id }],
    activeViewId: 'chat',
    activeAgentViewId: 'chat',
  })
  await api('ui.setWorkspace', { ...ui.workspace, openTaskIds: [task.id], activeTaskId: task.id, sidebar: 'projects' })
  await page.reload()
  await page.waitForSelector('.shell')
  await page
    .locator('.task-row')
    .filter({ has: page.getByText('Palette chat', { exact: true }) })
    .click()
  await page.locator('.agents-chip[aria-pressed]:visible').waitFor()
  await run('Show agents')
  await page.locator('.agent-panel .agent-task-card').filter({ hasText: 'Advisor' }).waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.agent-panel').waitFor({ state: 'detached' })
  await run('Toggle aside')
  await page.locator('.aside-panel').waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.aside-panel').waitFor({ state: 'detached' })
  await page.keyboard.press(`${mod}+Shift+a`)
  await page.locator('.aside-panel').waitFor()
  await page.keyboard.press('Escape')
  console.log('ok - Aside works through the palette and its existing shortcut')
  assert.deepEqual(errors, [])
  console.log('ok - No renderer errors')
} finally {
  await api('background.stop').catch(() => {})
  await app?.close().catch(() => {})
  rmSync(fixture, { recursive: true, force: true })
}
