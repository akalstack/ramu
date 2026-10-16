// The workspace toolbar: every icon has a visible, reversible effect, the tools are mutually exclusive, and the global
// show/hide restores exactly what was open.
import assert from 'node:assert/strict'
import { startChat, showChat, startRamu } from '../support/index.mjs'

const docs = Object.fromEntries(
  Array.from({ length: 60 }, (_, i) => [`docs/document-${String(i).padStart(2, '0')}.md`, '# Layout fixture\n']),
)
const ramu = await startRamu('icon-ux', { repos: { project: [{ 'review.ts': 'export const value = 1\n', ...docs }] } })
const { page } = ramu
const pane = page.locator('.task-pane:visible')
const toolbar = page.locator('.workspace-tool-buttons')
const tools = page.locator('.workspace-tools')
const button = (name) => toolbar.getByRole('button', { name, exact: true })
const pressed = (name, value) =>
  page.waitForFunction(
    ([label, expected]) =>
      document.querySelector(`.workspace-tool-buttons button[aria-label="${label}"]`)?.getAttribute('aria-pressed') ===
      expected,
    [name, String(value)],
  )

ramu.test('opens a chat in a project', async () => {
  const { project } = await ramu.api('projects.addFolder', ramu.repos.project)
  const chat = await startChat(ramu, {
    projectId: project.id,
    title: 'Icon UX',
    prompt: 'Reply with a short greeting.',
  })
  await showChat(ramu, chat)
  await pane.locator('.agent-view:visible').waitFor()
})

ramu.test('opening the workspace shows Explorer, and closing a tool keeps the open editor', async () => {
  await button('Show workspace').click()
  await pressed('Explorer', true)
  await tools.getByRole('button', { name: 'Hide Explorer', exact: true }).click()
  await pressed('Explorer', false)
  await button('Explorer').click()
  await tools.getByRole('button', { name: 'review.ts', exact: true }).click()
  await pane.locator('.monaco-editor[role=code]').first().waitFor()
  await tools.getByRole('button', { name: 'Hide Explorer', exact: true }).click()
  await pressed('Explorer', false)
  assert.ok(await pane.locator('.monaco-editor[role=code]').first().isVisible(), 'the editor stays open')
  assert.equal(await pane.getByRole('button', { name: 'Hide workspace', exact: true }).count(), 0, 'one global toggle')
  await pane.getByRole('button', { name: 'Maximize workspace', exact: true }).click()
  await pane.getByRole('button', { name: 'Show chat', exact: true }).click()
  await pane.locator('.agent-view:visible').waitFor()
})

ramu.test('tool buttons are mutually exclusive and toggle their own tool', async () => {
  await button('Explorer').click()
  await pressed('Explorer', true)
  await button('Search').click()
  await pressed('Explorer', false)
  await pressed('Search', true)
  await button('Search').click()
  await pressed('Search', false)
})

ramu.test('hiding and showing the workspace restores the open tools and keeps the terminal', async () => {
  await button('Explorer').click()
  await button('Terminal').click()
  await pressed('Terminal', true)
  const tabs = pane.locator('.terminal-panel .terminal-tabs [role=tab]')
  const count = await tabs.count()
  assert.ok(count > 0, 'a live terminal tab exists')
  await button('Explorer').focus()
  await page.keyboard.press('ArrowRight')
  assert.ok(
    await button('Search').evaluate((el) => el === document.activeElement),
    'arrow keys move between the tool buttons',
  )
  await button('Hide workspace').click()
  await pressed('Explorer', false)
  await pressed('Terminal', false)
  await button('Show workspace').click()
  await pressed('Explorer', true)
  await pressed('Terminal', true)
  await button('Terminal').click()
  await pressed('Terminal', false)
  await button('Terminal').click()
  await pressed('Terminal', true)
  assert.equal(await tabs.count(), count, 'reopening keeps the terminal')
})

ramu.test('the terminal panel closes and docks while staying in sync with the toolbar', async () => {
  await pane.getByRole('button', { name: 'Hide terminal panel', exact: true }).click()
  await pressed('Terminal', false)
  await button('Terminal').click()
  await pressed('Terminal', true)
  await pane.getByRole('button', { name: 'Move terminal to workspace tabs', exact: true }).click()
  await button('Hide workspace').click()
  await pressed('Terminal', false)
  await button('Show workspace').click()
  await pressed('Terminal', true)
  await pane.getByRole('button', { name: 'Dock terminal at bottom', exact: true }).click()
})

ramu.test('finishes without renderer errors', () => ramu.noErrors())
