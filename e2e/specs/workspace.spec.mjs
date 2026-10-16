// A working session in a project of two repositories: terminals per repository and for the workspace, quick open and
// closing tabs, models and the usage-limit fallback inside one chat, chats that share (or do not share) terminals and
// isolated worktrees, switching chats with the sidebar hidden, and a restart that restores tabs and layout.
// Source Control, editing and the worktree basics live in projects.spec.mjs.
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { git, modifier, palette, startRamu, useFakeModel } from '../support/index.mjs'

const ramu = await startRamu('workspace', {
  env: ({ dir }) => ({ RAMU_TEST_PICK_DIRECTORY: join(dir, 'shop') }),
  repos: {
    'shop/shop web': { 'README.md': '# web\n', 'src/App.tsx': 'export function App() {\n  return <h1>Shop</h1>\n}\n' },
    'shop/api': [{ 'README.md': '# api\n', 'src/server.ts': 'export const port = 3000\n' }, { branch: 'develop' }],
  },
})
const { page } = ramu
const api = ramu.repos['shop/api']
const pane = page.locator('.task-pane:visible')
const toolbar = page.locator('.workspace-tool-buttons')
const terminalTabs = () => pane.locator('.terminal-tab')
/** The visible terminal's text; xterm wraps long paths across rows, so the accessibility tree is read instead. */
const terminalText = () =>
  page.evaluate(
    () =>
      document.querySelector(
        '.task-pane:not([style*="display: none"]) .terminal-panel .terminal-pane.focused .xterm-accessibility-tree',
      )?.textContent ?? '',
  )
const terminalHas = (text, message) =>
  ramu.until(async () => (await terminalText()).replace(/\s+/g, '').includes(text.replace(/\s+/g, '')), message)
const runInTerminal = async (command) => {
  await pane.locator('.terminal-panel .terminal-pane.focused .xterm-helper-textarea').focus()
  await page.keyboard.type(`${command}\n`)
}
const apiHead = () => git(api, 'rev-parse', 'HEAD')
const apiHeadBefore = apiHead()
const startComposer = () => page.locator('[data-composer-input]:visible')
const finishTurn = () =>
  ramu.until(
    async () => {
      const allow = pane.locator('.card.pending').getByRole('button', { name: 'Allow' })
      if (await allow.count()) await allow.first().click()
      return (await pane.locator('.agent-view:visible[data-state="idle"]').count()) > 0
    },
    'the agent turn never finished',
    { attempts: 300 },
  )
/** Starts a chat from the project's New chat screen with the Current checkout (or a worktree plan). */
async function startChat(prompt, { worktree = false } = {}) {
  const home = page.getByRole('button', { name: 'Home', exact: true })
  if ((await home.getAttribute('aria-pressed')) !== 'true') await home.click()
  await page.getByRole('button', { name: 'New thread in shop', exact: true }).click()
  if (worktree) {
    await page.getByRole('button', { name: 'Where the work happens' }).click()
    await page.getByRole('menuitem', { name: /New isolated worktrees/i }).click()
  }
  await startComposer().fill(prompt)
  await page.keyboard.press('Enter')
  if (worktree) {
    await page.locator('.plan').waitFor()
    await page.keyboard.press('Enter')
  }
  await page.locator('.task-header .header-title', { hasText: prompt.split('\n')[0] }).waitFor()
  await finishTurn()
}

ramu.test('terminals start per repository and at the workspace root', async () => {
  await useFakeModel(ramu)
  await page.getByRole('button', { name: 'Add project', exact: true }).click()
  await page.getByRole('button', { name: 'Add 2 of 2', exact: true }).click()
  await page.locator('.repo-tree').first().waitFor()
  await toolbar.getByRole('button', { name: 'Terminal', exact: true }).click()
  await pane.getByRole('button', { name: 'New terminal', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Terminal in api', exact: true }).click()
  // xterm's input textarea is zero-sized, so it is attached but never "visible".
  await pane.locator('.terminal-panel .terminal-pane.focused .xterm-helper-textarea').waitFor({ state: 'attached' })
  await runInTerminal('pwd')
  await terminalHas(api, 'the repository terminal never started in the api checkout')

  const palettes = await palette(ramu, '>create new terminal')
  await palettes.getByRole('option').first().click()
  await ramu.until(async () => (await terminalTabs().count()) >= 2, 'the workspace terminal never opened')
  await runInTerminal('pwd')
  await terminalHas(join(ramu.dir, 'shop'), 'the workspace terminal did not start in the workspace folder')
  await runInTerminal('export RAMU_SMOKE_TOKEN=connected')
})

ramu.test('quick open finds files in either repository and Cmd+W closes the tab, not the window', async () => {
  const dialog = await palette(ramu, 'servts')
  await dialog.getByRole('option').filter({ hasText: 'src/server.ts' }).first().waitFor()
  await page.keyboard.press('Enter')
  const tab = pane.locator('.view-tab.active', { hasText: 'server.ts' })
  await tab.waitFor()
  await page.keyboard.press(`${modifier}+w`)
  await tab.waitFor({ state: 'detached' })
  assert.equal(ramu.app.windows().length, 1, 'the window survived')
})

ramu.test('a current-checkout thread inherits project terminals and unsaved editor buffers', async () => {
  const dialog = await palette(ramu, 'App.tsx')
  await dialog.getByRole('option').filter({ hasText: 'src/App.tsx' }).first().waitFor()
  await page.keyboard.press('Enter')
  await pane.locator('.view[style*="flex"] .monaco-editor .view-lines').click()
  await page.keyboard.type('// shared unsaved buffer\n')
  await pane.locator('.view-tab.active .dirty').waitFor()
  const before = await terminalTabs().count()
  await startChat('Add password reset')
  assert.equal(apiHead(), apiHeadBefore, 'starting a thread does not touch Git')
  assert.equal(await pane.locator('.view-tabs [role="tab"]', { hasText: 'Add password reset' }).count(), 0)
  assert.equal(await terminalTabs().count(), before, 'the thread shares the project terminals')
  await runInTerminal('echo shell-$RAMU_SMOKE_TOKEN')
  await terminalHas('shell-connected', 'the thread lost the original shell environment')
  // A new chat starts with the editor closed; reopening the file brings back the shared unsaved buffer.
  const reopen = await palette(ramu, 'App.tsx')
  await reopen.getByRole('option').filter({ hasText: 'src/App.tsx' }).first().waitFor()
  await page.keyboard.press('Enter')
  await pane.locator('.view-tab.active .dirty').waitFor()
  await pane.locator('.monaco-editor .view-lines', { hasText: 'shared unsaved buffer' }).waitFor()
})

ramu.test('model, effort and access switch inside one thread', async () => {
  const chat = pane.locator('.agent-view:visible')
  await chat.getByRole('button', { name: 'Model and effort controls', exact: true }).click()
  await page.getByRole('button', { name: /^Select model ·/ }).click()
  await page.getByRole('textbox', { name: 'Search models' }).fill('fake-codex')
  await page.getByRole('menuitemradio').filter({ hasText: /codex/i }).first().click()
  await page.getByRole('button', { name: 'Change model', exact: true }).click()
  await chat.getByRole('button', { name: 'Model and effort controls', exact: true }).click()
  await page.getByRole('button', { name: 'Reasoning and service tier' }).click()
  await page.getByRole('menuitemradio', { name: /^High/ }).click()
  await page.keyboard.press('Escape')
  await chat.getByRole('button', { name: 'Access mode' }).click()
  await page.getByRole('menuitemradio', { name: /Full access/ }).click()
  await startComposer().fill('Continue with Codex')
  await chat.getByRole('button', { name: 'Send', exact: true }).click()
  await chat.locator('.conversation-separator', { hasText: 'Codex' }).waitFor()
  await finishTurn()
  assert.equal((await ramu.api('tasks.list')).find((t) => t.title === 'Add password reset') !== undefined, true)
})
