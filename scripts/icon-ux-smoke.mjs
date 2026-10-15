// Run after pnpm build. Uses a fake agent and a throwaway repository/profile.
// The Playwright driver reads this when imported, before launching Electron.
delete process.env.ELECTRON_RUN_AS_NODE
const { _electron: electron } = await import('playwright-core')
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
const cwd = resolve(import.meta.dirname, '..', 'apps', 'desktop')
const fixture = mkdtempSync(join(tmpdir(), 'ramu-layout-'))
const repo = join(fixture, 'project')
mkdirSync(repo)
writeFileSync(join(repo, 'review.ts'), 'export const value = 1\n')
mkdirSync(join(repo, 'docs'))
for (let i = 0; i < 60; i++)
  writeFileSync(join(repo, 'docs', `document-${String(i).padStart(2, '0')}.md`), '# Layout fixture\n')
const git = (...args) => execFileSync('git', args, { cwd: repo })
git('init', '-q')
git('add', '.')
git(
  '-c',
  'user.name=Layout',
  '-c',
  'user.email=layout@example.com',
  '-c',
  'commit.gpgsign=false',
  'commit',
  '-qm',
  'initial',
)
const env = { ...process.env, RAMU_USER_DATA: join(fixture, 'profile'), RAMU_FAKE_AGENT: '1' }
delete env.ELECTRON_RENDERER_URL
const app = await electron.launch({ args: [cwd], cwd, env })
const page = await app.firstWindow()
await page.setViewportSize({ width: 1440, height: 900 })
const errors = []
page.on('console', (message) => {
  if (message.type() === 'error') console.log('renderer:', message.text())
})
page.on('requestfailed', (request) => console.log('request failed:', request.url(), request.failure()?.errorText))
page.on('pageerror', (e) => {
  if (e.message !== 'Canceled') errors.push(e.message)
})
const api = (method, ...args) => page.evaluate(([m, a]) => window.ramu.invoke(m, ...a), [method, args])
const pane = page.locator('.task-pane:visible')
try {
  await page.waitForSelector('.shell')
  const { project } = await api('projects.addFolder', repo)
  const task = await api('tasks.create', { projectId: project.id, title: 'Icon UX', mode: 'current' })
  await api('tasks.setup', task.id)
  await api('agent.start', task.id, 'Reply with a short greeting.', {
    provider: 'claude-code',
    model: 'fake-claude',
    effort: 'medium',
    access: 'full',
    autoFallback: false,
  })
  await page.reload()
  await page.locator('.task-row').first().click()
  await pane.locator('.agent-view:visible').waitFor()
  const toolbar = page.locator('.workspace-tool-buttons')
  const explorer = toolbar.getByRole('button', { name: 'Explorer', exact: true })
  const terminal = toolbar.getByRole('button', { name: 'Terminal', exact: true })
  const pressed = async (button, value) => {
    await page.waitForFunction(
      ([label, value]) =>
        document
          .querySelector(`.workspace-tool-buttons button[aria-label="${label}"]`)
          ?.getAttribute('aria-pressed') === value,
      [await button.getAttribute('aria-label'), String(value)],
    )
  }
  // Opening a fresh workspace must have a visible result.
  await toolbar.getByRole('button', { name: 'Show workspace', exact: true }).click()
  await pressed(explorer, true)
  await page.locator('.workspace-tools').getByRole('button', { name: 'Hide Explorer', exact: true }).click()
  await pressed(explorer, false)
  await explorer.click()
  await page.locator('.workspace-tools').getByRole('button', { name: 'review.ts', exact: true }).click()
  await pane.locator('.monaco-editor[role=code]').first().waitFor()
  // Closing a tool does not close the editor.
  await page.locator('.workspace-tools').getByRole('button', { name: 'Hide Explorer', exact: true }).click()
  await pressed(explorer, false)
  assert(await pane.locator('.monaco-editor[role=code]').first().isVisible())
  assert.equal(
    await pane.getByRole('button', { name: 'Hide workspace', exact: true }).count(),
    0,
    'One global workspace toggle',
  )
  await pane.getByRole('button', { name: 'Maximize workspace', exact: true }).click()
  await pane.getByRole('button', { name: 'Show chat', exact: true }).waitFor()
  await pane.getByRole('button', { name: 'Show chat', exact: true }).click()
  await pane.locator('.agent-view:visible').waitFor()
  // Tool buttons are mutually exclusive and can also close their own tool.
  await explorer.click()
  await pressed(explorer, true)
  await toolbar.getByRole('button', { name: 'Search', exact: true }).click()
  await pressed(explorer, false)
  await pressed(toolbar.getByRole('button', { name: 'Search', exact: true }), true)
  await toolbar.getByRole('button', { name: 'Search', exact: true }).click()
  await pressed(toolbar.getByRole('button', { name: 'Search', exact: true }), false)
  await explorer.click()
  await terminal.click()
  await pressed(terminal, true)
  const terminalCount = await pane.locator('.terminal-panel .terminal-tabs [role=tab]').count()
  assert(terminalCount > 0, 'A live terminal tab exists')
  await toolbar.getByRole('button', { name: 'Hide workspace', exact: true }).click()
  await pressed(explorer, false)
  await pressed(terminal, false)
  await toolbar.getByRole('button', { name: 'Show workspace', exact: true }).click()
  await pressed(explorer, true)
  await pressed(terminal, true)
  await terminal.click()
  await pressed(terminal, false)
  await terminal.click()
  await pressed(terminal, true)
  assert.equal(
    await pane.locator('.terminal-panel .terminal-tabs [role=tab]').count(),
    terminalCount,
    'Reopening keeps the terminal',
  )
  // Local close and global restore keep states connected in either terminal dock.
  await pane.getByRole('button', { name: 'Hide terminal panel', exact: true }).click()
  await pressed(terminal, false)
  await terminal.click()
  await pressed(terminal, true)
  await pane.getByRole('button', { name: 'Dock terminal on right', exact: true }).click()
  await toolbar.getByRole('button', { name: 'Hide workspace', exact: true }).click()
  await pressed(terminal, false)
  await toolbar.getByRole('button', { name: 'Show workspace', exact: true }).click()
  await pressed(terminal, true)
  await pane.getByRole('button', { name: 'Dock terminal at bottom', exact: true }).click()
  await explorer.focus()
  await page.keyboard.press('ArrowRight')
  assert(
    await toolbar.getByRole('button', { name: 'Search', exact: true }).evaluate((el) => el === document.activeElement),
    'Arrow keys navigate tool selectors',
  )
  await page.screenshot({ path: join(fixture, 'icon-ux.png') })
  assert.deepEqual(errors, [])
  console.log(`Icon UX checks passed. Screenshot: ${join(fixture, 'icon-ux.png')}`)
} finally {
  await app.close()
}
