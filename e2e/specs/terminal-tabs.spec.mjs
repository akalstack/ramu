import assert from 'node:assert/strict'
import { showChat, startChat, startRamu } from '../support/index.mjs'

const ramu = await startRamu('terminal-tabs', { repos: { project: { 'example.ts': 'export const value = 1\n' } } })
const { page } = ramu
const workspaceTabs = page.getByRole('tablist', { name: 'Workspace tabs', exact: true })
const terminal = page.locator('.terminal-panel:visible')
let terminalId

ramu.test('terminal and file share workspace tabs without restarting the shell', async () => {
  const { project } = await ramu.api('projects.addFolder', ramu.repos.project)
  const chat = await startChat(ramu, { projectId: project.id, title: 'Shared terminal tabs', prompt: 'Say hello.' })
  await ramu.api('tasks.setup', chat.task.id)
  await showChat(ramu, chat)
  await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  await page.locator('.workspace-tools').getByRole('button', { name: 'example.ts', exact: true }).click()
  await page.getByRole('button', { name: 'Hide Explorer', exact: true }).click()
  await page.locator('.editor-area:visible .monaco-editor').waitFor()
  await page.getByRole('button', { name: 'New tab', exact: true }).click()
  await ramu.shot('new-tab-menu')
  await page.getByRole('menuitem', { name: /^Open file/ }).click()
  await page.getByRole('dialog', { name: 'Command palette' }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'New tab', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New terminal', exact: true }).click()
  await terminal.waitFor()
  await page.waitForFunction(() =>
    document.querySelector('.terminal-panel .xterm-accessibility-tree')?.textContent.includes('project'),
  )
  await terminal.locator('.xterm-helper-textarea').focus()
  const octal = [...'survived_file_tab'].map((c) => `\\${c.charCodeAt(0).toString(8).padStart(3, '0')}`).join('')
  await page.keyboard.type(`export RAMU_TAB_TOKEN=$(printf '${octal}')`)
  await page.keyboard.press('Enter')
  await page.evaluate(() => {
    window.__tabShell = document.querySelector('.terminal-host')
  })
  const selected = workspaceTabs.locator('[role="tab"][aria-selected="true"]')
  terminalId = await selected.getAttribute('data-view-id')
  assert.ok(terminalId)
  assert.equal(await terminal.locator('.terminal-tabs').count(), 0)
  assert.equal(await page.locator('.editor-area:visible').count(), 0)
  await workspaceTabs.getByRole('tab').filter({ hasText: 'example.ts' }).click()
  await page.locator('.editor-area:visible .monaco-editor').waitFor()
  assert.equal(await page.locator('.terminal-panel:visible').count(), 0)
  await workspaceTabs.getByRole('tab').filter({ hasText: 'example.ts' }).focus()
  await page.keyboard.press('Control+Tab')
  await terminal.waitFor()
  await page.keyboard.press('Control+Shift+Tab')
  await page.locator('.editor-area:visible').waitFor()
  await workspaceTabs.locator(`[data-view-id="${terminalId}"]`).click()
  await terminal.locator('.xterm-helper-textarea').focus()
  await page.keyboard.type('echo "$RAMU_TAB_TOKEN"')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() =>
    document.querySelector('.xterm-accessibility-tree')?.textContent.includes('survived_file_tab'),
  )
  assert.ok(await page.evaluate(() => document.querySelector('.terminal-host') === window.__tabShell))
  await ramu.shot('shared-file-terminal-tabs')
  ramu.noErrors()
})

ramu.test('split group stays in one workspace tab and bottom docking keeps separate tabs', async () => {
  await terminal.getByRole('button', { name: 'Split side by side', exact: true }).click()
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.terminal-pane')].filter((el) => el.getBoundingClientRect().width > 0).length ===
      2,
  )
  assert.equal(await workspaceTabs.getByRole('tab').count(), 2, 'one file tab and one terminal group tab')
  await workspaceTabs.getByRole('tab').filter({ hasText: 'example.ts' }).click()
  await workspaceTabs.locator(`[data-view-id="${terminalId}"]`).click()
  assert.equal(await terminal.locator('.terminal-pane:visible').count(), 2)
  await ramu.reload()
  await page.locator('.task-row').filter({ hasText: 'Shared terminal tabs' }).click()
  await terminal.waitFor()
  assert.equal(await workspaceTabs.getByRole('tab').count(), 2, 'workspace terminal selection restores')
  await terminal.getByRole('button', { name: 'Dock terminal at bottom', exact: true }).click()
  await page.locator('.terminal-panel.dock-bottom:visible').waitFor()
  await page.locator('.editor-area:visible').waitFor()
  assert.equal(await workspaceTabs.getByRole('tab').count(), 1, 'bottom terminals leave the file tab strip')
  assert.equal(await terminal.getByRole('tablist', { name: 'Terminal groups', exact: true }).count(), 1)
  await ramu.shot('bottom-terminal-with-file')
  ramu.noErrors()
})

ramu.test('closing a workspace terminal group keeps the selected tab and shell in sync', async () => {
  page.on('dialog', (dialog) => void dialog.accept())
  await terminal.getByRole('button', { name: 'New terminal', exact: true }).click()
  await terminal.getByRole('button', { name: 'New terminal', exact: true }).click()
  await terminal.getByRole('button', { name: 'Move terminal to workspace tabs', exact: true }).click()
  const original = workspaceTabs.locator(`[data-view-id="${terminalId}"]`)
  await original.click()
  await original.getByRole('button', { name: 'Close view', exact: true }).click()
  await original.waitFor({ state: 'detached' })
  const selectedId = await workspaceTabs.locator('[aria-selected="true"]').getAttribute('data-view-id')
  await ramu.until(async () => {
    const state = Object.values((await ramu.api('ui.get')).tasks).find((state) =>
      state.views.some((view) => view.id === selectedId && view.kind === 'terminal'),
    )
    return state?.activeViewId === selectedId && state?.activeTerminalId === selectedId
  }, 'selected terminal tab and focused shell differ after closing a group')
  ramu.noErrors()
})
