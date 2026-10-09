// Drives the built app through the first-milestone journey against throwaway repos and a
// throwaway profile, asserting the paths each surface uses. Screenshots go to $SHOTS or /tmp/ramu-shots.
// Usage: pnpm build && node scripts/ui-smoke.mjs   (RAMU_REAL_AGENT=1 adds a real Claude Code run)
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

const APP_DIR = resolve(import.meta.dirname, '..')
const SHOTS = process.env.SHOTS ?? '/tmp/ramu-shots'
mkdirSync(SHOTS, { recursive: true })

const tmp = mkdtempSync(join(tmpdir(), 'ramu-smoke-'))
const env = { ...process.env, RAMU_USER_DATA: join(tmp, 'profile'), RAMU_WORKTREES: join(tmp, 'worktrees'), RAMU_FAKE_AGENT: process.env.RAMU_REAL_AGENT === '1' ? '0' : '1' }
delete env.ELECTRON_RENDERER_URL

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' })
function repo(dir, files, branch) {
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', branch)
  git(dir, 'config', 'user.email', 'smoke@example.com')
  git(dir, 'config', 'user.name', 'Smoke')
  git(dir, 'config', 'commit.gpgsign', 'false')
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(dir, p, '..'), { recursive: true })
    writeFileSync(join(dir, p), c)
  }
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'init')
  return realpathSync(dir)
}

// A workspace folder holding two independent repositories.
const shop = join(tmp, 'shop')
const web = repo(join(shop, 'shop web'), {
  'README.md': '# web\n',
  'src/App.tsx': 'export function App() {\n  return <h1>Shop</h1>\n}\n',
}, 'main')
const api = repo(join(shop, 'api'), {
  'README.md': '# api\n',
  'src/server.ts': 'export const port = 3000\n',
}, 'develop')
const shopReal = realpathSync(shop)
// The folder dialog answers with the workspace folder.
env.RAMU_TEST_PICK_DIRECTORY = shop
// Pre-existing user edits that must survive untouched.
writeFileSync(join(api, 'README.md'), '# api\n\nlocal notes\n')
git(api, 'add', 'README.md')
writeFileSync(join(api, 'src/server.ts'), 'export const port = 3001\n')
const fingerprint = (d) => git(d, 'status', '--porcelain=v2', '--branch', '-z') + git(d, 'stash', 'list') + git(d, 'diff', '--cached')
let apiBefore = fingerprint(api)

const check = (cond, msg) => {
  if (!cond) throw new Error(`CHECK FAILED: ${msg}`)
  console.log(`ok - ${msg}`)
}

const runtimeErrors = []
async function launch() {
  const app = await electron.launch({ args: [APP_DIR], cwd: APP_DIR, env, timeout: 30_000 })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => { runtimeErrors.push(e.message); console.log('[pageerror]', e.message) })
  page.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text()))
  await page.waitForSelector('.shell', { timeout: 20_000 })
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {})
  return { app, page }
}
const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`) })
const pane = (page) => page.locator('.task-pane[style*="flex"]')
const visibleTerm = (page) => pane(page).locator('.view[style*="flex"] .xterm-rows')
// xterm wraps long paths across rows; join them back before matching.
const termText = async (page) => (await visibleTerm(page).innerText()).replace(/\n/g, '')

/** Asserts the element is really the topmost thing at its centre (Playwright can click clipped elements). */
async function assertOnTop(page, locator, what) {
  const box = await locator.boundingBox()
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[role="menuitem"]')?.textContent ?? null, [
    box.x + box.width / 2,
    box.y + box.height / 2,
  ])
  if (hit !== (await locator.textContent())) throw new Error(`CHECK FAILED: ${what} is hidden (topmost: ${hit})`)
}

async function newTerminal(page, repoName) {
  await pane(page).getByRole('button', { name: 'New tab' }).click()
  const item = page.getByRole('menuitem', { name: `Terminal in ${repoName}`, exact: true })
  await assertOnTop(page, item, '+ menu item')
  await item.click()
}

async function runInTerminal(page, command) {
  await visibleTerm(page).waitFor()
  await page.waitForTimeout(1500)
  await pane(page).locator('.view[style*="flex"] .xterm').click()
  await page.keyboard.type(`${command}\n`)
  await page.waitForTimeout(800)
}

const REAL = process.env.RAMU_REAL_AGENT === '1'
const startComposer = (page) => page.locator('textarea:visible[placeholder*="whole workspace"]')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Approves any permission request and waits for the visible conversation to finish its turn. */
async function finishTurn(page, timeout = 150_000) {
  const start = Date.now()
  for (;;) {
    const allow = pane(page).locator('.card.pending').getByRole('button', { name: 'Allow' })
    if (await allow.count()) await allow.first().click()
    if (await pane(page).locator('.agent-view:visible[data-state="idle"]').count()) return
    if (Date.now() - start > timeout) throw new Error('CHECK FAILED: agent turn did not finish')
    await sleep(250)
  }
}

/** Starts a chat from the Codex-style start screen; the first message creates the task and runs the agent. */
async function startChat(page, prompt, { worktree = false } = {}) {
  const chats = page.getByRole('button', { name: 'Home', exact: true })
  if (await chats.getAttribute('aria-pressed') !== 'true') await chats.click()
  await page.getByRole('button', { name: 'New chat in shop', exact: true }).click()
  const composingWidth = (await pane(page).locator('.agent-dock').boundingBox()).width
  const workspaceWidth = (await pane(page).locator('.task-body').boundingBox()).width
  check(Math.abs(composingWidth - workspaceWidth) < 1 && !await pane(page).locator('.terminal-panel').isVisible(), 'project + opens the full-width New chat screen without an editor split')
  if (worktree) {
    await page.getByRole('button', { name: 'Where the work happens' }).click()
    await page.getByRole('menuitem', { name: /New isolated worktrees/i }).click()
  }
  if (!worktree) {
    await page.getByRole('button', { name: 'Where the work happens' }).click()
    await page.getByRole('menu', { name: 'Where the work happens' }).waitFor()
    await page.waitForTimeout(150)
    await shot(page, '00-checkout-menu')
    await page.getByRole('menuitem', { name: /^Current checkout/ }).click()
  }
  await page.getByRole('button', { name: 'Access mode', exact: true }).getByText('Full access').waitFor()
  await startComposer(page).fill(prompt)
  await page.keyboard.press('Enter')
  if (worktree) {
    await page.locator('.plan').waitFor()
    await page.waitForTimeout(300)
    await shot(page, '06-worktree-plan')
    await page.keyboard.press('Enter')
  }
  await page.locator('.task-header .header-title', { hasText: prompt.split('\n')[0] }).waitFor()
  await finishTurn(page)
}

let { app, page } = await launch()
try {
  // A workspace folder becomes one project grouping its child repositories.
  await page.getByRole('button', { name: 'Add project', exact: true }).click()
  await page.locator('.task-header .header-title', { hasText: 'shop' }).waitFor()
  await page.locator('.repo-tree').first().waitFor()
  check((await page.locator('.repo-tree').count()) === 2, 'adding a project opens its files and detects both child repositories')
  await shot(page, '00-new-task')

  check(fingerprint(api) === apiBefore, 'opening a project leaves Git state byte-identical')
  await shot(page, '01-task')

  // Files -> open a real file, edit, save, with no task required.
  const webTree = page.locator('.repo-tree', { hasText: 'shop web' })
  await webTree.getByRole('button', { name: 'src' }).click()
  await webTree.getByRole('button', { name: 'App.tsx' }).click()
  await page.locator('.view[style*="flex"] .monaco-editor .view-lines', { hasText: 'export function App' }).click()
  await page.keyboard.press('Meta+ArrowUp')
  await page.keyboard.type('// edited in Ramu\n')
  await page.locator('.view-tab.active .dirty').waitFor()
  await page.keyboard.press('Meta+s')
  await page.locator('.view-tab.active .dirty').waitFor({ state: 'detached' })
  check(readFileSync(join(web, 'src/App.tsx'), 'utf8').startsWith('// edited in Ramu\n'), 'editor save wrote to the web checkout')
  await webTree.getByRole('button', { name: 'README.md' }).click()
  await page.locator('.repo-tree', { hasText: 'api' }).getByRole('button', { name: 'README.md' }).click()
  check((await page.locator('.view-tab', { hasText: 'README.md' }).locator('.tab-repo', { hasText: 'api' }).count()) === 1, 'duplicate file tabs include the repository name')
  await webTree.getByRole('button', { name: 'App.tsx' }).click()
  await page.waitForTimeout(400)
  await shot(page, '02-editor')

  // External change while dirty raises a conflict banner instead of overwriting.
  await page.locator('.view[style*="flex"] .monaco-editor .view-lines').click()
  await page.keyboard.type('// unsaved\n')
  writeFileSync(join(web, 'src/App.tsx'), 'export const changedByAgent = true\n')
  await page.locator('.banner.warn', { hasText: 'changed on disk' }).waitFor({ timeout: 5000 })
  check(readFileSync(join(web, 'src/App.tsx'), 'utf8') === 'export const changedByAgent = true\n', 'external change was not overwritten')
  await page.getByRole('button', { name: 'Use disk version' }).click()

  // Changes: per-repository staging and commit.
  await page.getByRole('button', { name: 'Source Control', exact: true }).click()
  await page.getByRole('combobox', { name: 'Source control repository' }).selectOption({ label: 'api' })
  const apiScm = page.locator('.scm-repo')
  await apiScm.getByRole('button', { name: 'src/server.ts', exact: true }).click()
  await page.locator('.view[style*="flex"] .monaco-diff-editor').waitFor()
  await page.waitForTimeout(600)
  await shot(page, '04-diff')
  await page.getByRole('combobox', { name: 'Source control repository' }).selectOption({ label: 'shop web' })
  const webScm = page.locator('.scm-repo')
  await webScm.getByRole('button', { name: 'Stage src/App.tsx' }).click()
  await webScm.getByText('Staged (1)').waitFor()
  if (!REAL) {
    await webScm.getByRole('button', { name: 'AI commit message for shop web' }).click()
    await page.waitForFunction(() => document.querySelector('.commit-msg')?.value === 'Update staged files')
    check(true, 'AI commit button drafts an editable message from the staged diff')
    await shot(page, '04a-source-control')
    const previousHead = git(web, 'rev-parse', 'HEAD')
    writeFileSync(join(web, 'README.md'), '# staged after the AI draft\n')
    git(web, 'add', 'README.md')
    await webScm.getByText('Staged (2)').waitFor()
    await webScm.getByRole('button', { name: 'Commit 2 staged' }).click()
    await webScm.getByText(/Staged changes changed after the AI draft/).waitFor()
    check(git(web, 'rev-parse', 'HEAD') === previousHead, 'commit refuses an AI draft when staged content changed')
    git(web, 'restore', '--staged', '--', 'README.md')
    git(web, 'restore', '--', 'README.md')
    await webScm.getByText('Staged (1)').waitFor()
  }
  await webScm.getByPlaceholder('Message for shop web').fill('Edit App from Ramu')
  await webScm.getByRole('button', { name: /Commit 1 staged/ }).click()
  await webScm.getByText('Staged (0)').waitFor()
  check(git(web, 'log', '-1', '--format=%s').trim() === 'Edit App from Ramu', 'commit landed in the web repository only')
  check(fingerprint(api) === apiBefore, 'api checkout untouched by web operations')
  await page.locator('.git-history').getByRole('button', { name: /Edit App from Ramu/ }).waitFor()
  await page.locator('.git-history').getByRole('button', { name: /Edit App from Ramu/ }).click()
  await page.locator('.git-details', { hasText: 'changedByAgent' }).waitFor()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  check(true, 'bottom Git history opens the real commit diff')

  // Terminals: per repository from the + menu, and at the workspace root from the palette.
  await newTerminal(page, 'api')
  await runInTerminal(page, 'pwd')
  check((await termText(page)).includes(api), 'repository terminal starts in the api checkout')
  await shot(page, '05-terminal')
  const terminalPanel = pane(page).getByRole('region', { name: 'Terminal panel' })
  const mainTab = await pane(page).locator('.view-tabs [aria-selected="true"]').textContent()
  check(await terminalPanel.isVisible() && mainTab?.includes('server.ts'), 'terminal opens below the existing editor without replacing it')
  await pane(page).getByRole('button', { name: 'Terminal layout', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Split side by side', exact: true }).click()
  await pane(page).locator('.terminal-panes.layout-horizontal .terminal-pane:visible').nth(1).waitFor()
  check(await pane(page).locator('.terminal-pane:visible').count() === 2, 'horizontal split creates a second live terminal')
  await shot(page, '05f-terminal-horizontal')
  await pane(page).getByRole('button', { name: 'Terminal layout', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Split stacked', exact: true }).click()
  await pane(page).locator('.terminal-panes.layout-vertical .terminal-pane:visible').nth(2).waitFor()
  check(await pane(page).locator('.terminal-pane:visible').count() === 3, 'vertical split creates a third live terminal')
  await pane(page).getByRole('button', { name: 'Terminal layout', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Tabs down the right', exact: true }).click()
  await shot(page, '05g-terminal-vertical')
  await pane(page).getByRole('button', { name: 'Hide terminal panel', exact: true }).click()
  await page.keyboard.press('Meta+j')
  check(await terminalPanel.isVisible() && await pane(page).locator('.terminal-tab').count() === 3, 'hiding and reopening preserves all terminal tabs')
  await pane(page).getByRole('button', { name: 'Close terminal 3', exact: true }).click()
  await pane(page).getByRole('button', { name: 'Close terminal 2', exact: true }).click()
  await pane(page).getByRole('button', { name: 'Terminal layout', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Show one terminal', exact: true }).click()
  await pane(page).getByRole('button', { name: 'Terminal layout', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Tabs across the top', exact: true }).click()
  check((await termText(page)).includes(api), 'original terminal output survives layout changes')

  await page.keyboard.press('Meta+Shift+P')
  await page.locator('.palette-input').fill('>create new terminal')
  await page.waitForTimeout(300) // let the open animation finish
  await shot(page, '05a-palette')
  await page.keyboard.press('Enter')
  await runInTerminal(page, 'pwd')
  check((await termText(page)).includes(shopReal), 'workspace terminal starts in the workspace folder')
  await runInTerminal(page, 'export RAMU_SMOKE_TOKEN=connected')
  // Quick open finds files across both repositories.
  await page.keyboard.press('Meta+P')
  await page.locator('.palette-input').fill('servts')
  await page.locator('.palette-item.on', { hasText: 'src/server.ts' }).waitFor()
  await page.keyboard.press('Enter')
  await pane(page).locator('.view-tab.active', { hasText: 'server.ts' }).waitFor()
  check(true, 'quick open opened src/server.ts from the api repository')
  await page.keyboard.press('Meta+w')
  await pane(page).locator('.view-tab', { hasText: 'server.ts' }).filter({ hasNot: page.locator('.tab-repo') }).waitFor({ state: 'detached' })
  check(true, 'Cmd+W closes the active tab, not the window')

  await pane(page).locator('.view-tab', { hasText: 'App.tsx' }).click()
  await pane(page).locator('.view[style*="flex"] .monaco-editor .view-lines').click()
  await page.keyboard.type('// shared unsaved buffer\n')
  await pane(page).locator('.view-tab.active .dirty').waitFor()
  await startChat(page, REAL ? 'Add password reset\nReply with the word ramu. Do not change any files.' : 'Add password reset')
  check(fingerprint(api) === apiBefore, 'starting a chat leaves Git state byte-identical')
  check(await pane(page).locator('.view-tabs [role="tab"]', { hasText: 'Add password reset' }).count() === 0, 'conversation navigation stays separate from the shared file tab bar')
  check(await pane(page).locator('.terminal-tab').count() === 2, 'current-checkout chat inherits project terminals')
  await runInTerminal(page, 'echo shell-$RAMU_SMOKE_TOKEN')
  check((await termText(page)).includes('shell-connected'), 'current-checkout chat keeps the original live shell environment')
  await pane(page).locator('.view-tab', { hasText: 'App.tsx' }).click()
  await pane(page).locator('.view-tab.active .dirty').waitFor()
  await pane(page).locator('.view[style*="flex"] .monaco-editor .view-lines', { hasText: 'shared unsaved buffer' }).waitFor()
  check(true, 'new current-checkout chat preserves the unsaved project editor buffer')
  await pane(page).getByRole('button', { name: 'Show chat', exact: true }).click()
  check(await pane(page).locator('.agent-view:visible').count() === 1 && !await pane(page).locator('.editor-area').isVisible(), 'Chat control returns to the separate conversation view')
  await pane(page).locator('.view-tab', { hasText: 'App.tsx' }).click()
  await pane(page).locator('.view-tab.active .dirty').waitFor()
  check(true, 'returning from chat preserves the shared unsaved file tab')
  page.once('dialog', (dialog) => dialog.accept())
  await pane(page).locator('.view-tab.active .tab-close').click()

  await shot(page, '05b-chat')
  if (!REAL) {
    const conversation = pane(page).locator('.agent-view:visible')
    await conversation.getByRole('button', { name: 'Model', exact: true }).click()
    await page.getByRole('button', { name: 'Codex', exact: true }).click()
    await page.getByRole('textbox', { name: 'Search models' }).fill('Codex')
    await page.waitForTimeout(150)
    await shot(page, '05d-model-picker')
    await page.getByRole('menuitem', { name: /Codex \(test\)/ }).click()
    await conversation.locator('.conversation-separator', { hasText: 'Codex' }).waitFor()
    await conversation.getByRole('button', { name: 'Reasoning effort' }).click()
    await page.getByRole('menuitem', { name: 'High', exact: true }).click()
    await conversation.getByRole('button', { name: 'Access mode' }).click()
    await page.getByRole('menuitem', { name: /Full access/ }).click()
    await conversation.getByRole('textbox').fill('Continue with Codex')
    await conversation.getByRole('button', { name: 'Send', exact: true }).click()
    await finishTurn(page)
    check(true, 'same chat switches to Codex with high reasoning and full access')
    await conversation.getByRole('button', { name: 'Model', exact: true }).click()
    await page.getByRole('button', { name: 'Claude', exact: true }).click()
    await page.getByRole('textbox', { name: 'Search models' }).fill('Claude')
    await page.getByRole('menuitem', { name: /Claude \(test\)/ }).click()
    await conversation.getByRole('textbox').fill('Continue with Claude')
    await conversation.getByRole('button', { name: 'Send', exact: true }).click()
    await finishTurn(page)
    await conversation.getByRole('textbox').fill('[limit claude] Continue this task')
    await conversation.getByRole('button', { name: 'Send', exact: true }).click()
    await conversation.locator('.conversation-separator', { hasText: 'Claude usage limit reached' }).waitFor()
    await finishTurn(page)
    await conversation.locator('.conversation-separator', { hasText: 'Claude usage limit reached' }).scrollIntoViewIfNeeded()
    await shot(page, '05e-provider-handoff')
    check(fingerprint(api) === apiBefore, 'usage-limit fallback stays in the same chat and preserves checkout state')
  }

  // New chat inside a chat must create a project-level sibling, not another session under it.
  await pane(page).getByRole('button', { name: 'New tab', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New chat', exact: true }).click()
  await startComposer(page).fill('Sibling chat')
  await page.keyboard.press('Enter')
  await page.locator('.task-header .header-title', { hasText: 'Sibling chat' }).waitFor()
  await finishTurn(page)
  const siblingRows = page.locator('.project-group').filter({ has: page.locator('.project-name', { hasText: 'shop' }) }).locator('.task-list > .task-row')
  check(await siblingRows.filter({ hasText: 'Sibling chat' }).count() === 1 && await siblingRows.filter({ hasText: 'Add password reset' }).count() === 1, 'new chat from an existing chat creates a flat project-level sibling')
  check(await pane(page).locator('.terminal-tab').count() === 2, 'sibling chat shares current-checkout terminals')
  await page.keyboard.press('Meta+b')
  await page.getByRole('button', { name: 'Switch chat', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search chats', exact: true }).fill('Add password')
  await page.waitForTimeout(150)
  await shot(page, '05h-chat-switcher')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.locator('.task-header .header-title', { hasText: 'Add password reset' }).waitFor()
  check(await pane(page).locator('.terminal-tab').count() === 2, 'header chat switcher works with the sidebar hidden and preserves shared terminals')
  if (!REAL) await pane(page).locator('.agent-view:visible').getByRole('button', { name: 'Model', exact: true }).getByText('Codex (test)').waitFor()
  await page.getByRole('button', { name: 'Switch chat', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search chats', exact: true }).fill('Sibling')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await page.locator('.task-header .header-title', { hasText: 'Sibling chat' }).waitFor()
  if (!REAL) await pane(page).locator('.agent-view:visible').getByRole('button', { name: 'Model', exact: true }).getByText('Claude (test)').waitFor()
  check(true, 'switching conversations preserves their independent model settings')
  await page.keyboard.press('Meta+b')


  // Isolated worktree task, created from the composer after previewing paths.
  await startChat(page, REAL ? 'Fix checkout\nReply with the word ramu. Do not change any files.' : 'Fix checkout', { worktree: true })
  check(await pane(page).locator('.terminal-tab').count() === 0, 'isolated-worktree chat starts with separate terminals')
  const wtApi = realpathSync(join(tmp, 'worktrees', 'shop', 'fix-checkout', 'api'))
  check(git(wtApi, 'symbolic-ref', '--short', 'HEAD').trim() === 'ramu/fix-checkout', 'worktree is on the task branch')
  await newTerminal(page, 'api')
  await runInTerminal(page, 'pwd')
  check((await termText(page)).includes(wtApi), 'worktree task terminal runs in the worktree')
  await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  await page.locator('.repo-tree', { hasText: 'api' }).getByRole('button', { name: 'README.md' }).click()
  await pane(page).locator('.view[style*="flex"] .monaco-editor .view-lines', { hasText: '# api' }).click()
  await page.keyboard.type('worktree edit ')
  await page.keyboard.press('Meta+s')
  await pane(page).locator('.view-tab.active .dirty').waitFor({ state: 'detached' })
  check(readFileSync(join(wtApi, 'README.md'), 'utf8').includes('worktree edit '), 'worktree task save wrote to the worktree')
  check(fingerprint(api) === apiBefore, 'original api checkout still byte-identical after worktree task edits')
  check(git(api, 'symbolic-ref', '--short', 'HEAD').trim() === 'develop', 'original api checkout is still on develop')
  await shot(page, '07-worktree-task')

  // Rename, archive and delete from the sidebar.
  { const chats = page.getByRole('button', { name: 'Home', exact: true }); if (await chats.getAttribute('aria-pressed') !== 'true') await chats.click() }
  await page.locator('.task-row', { hasText: 'Fix checkout' }).dblclick()
  await page.locator('.task-row .inline-edit').fill('Fix checkout flow')
  await page.keyboard.press('Enter')
  await page.locator('.task-row', { hasText: 'Fix checkout flow' }).waitFor()
  await page.locator('.task-header .header-title', { hasText: 'Fix checkout flow' }).waitFor()
  check(true, 'task renamed from the sidebar')

  // A new independent conversation can reuse an isolated workspace and its live shell.
  await runInTerminal(page, 'export RAMU_WORKTREE_TOKEN=shared')
  await pane(page).getByRole('button', { name: 'New tab', exact: true }).click()
  await page.getByRole('menuitem', { name: 'New chat', exact: true }).click()
  await page.getByRole('button', { name: 'Where the work happens' }).getByText('Fix checkout').waitFor()
  await startComposer(page).fill('Reuse isolated workspace')
  await page.keyboard.press('Enter')
  await page.locator('.task-header .header-title', { hasText: 'Reuse isolated workspace' }).waitFor()
  await finishTurn(page)
  check(await pane(page).locator('.terminal-tab').count() === 1, 'new conversation reuses existing isolated-workspace terminals')
  await runInTerminal(page, 'echo worktree-$RAMU_WORKTREE_TOKEN; pwd')
  check((await termText(page)).includes('worktree-shared') && (await termText(page)).includes(wtApi), 'reused isolated workspace preserves its live shell and checkout directory')
  const reusedRow = page.locator('.task-row', { hasText: 'Reuse isolated workspace' })
  await reusedRow.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete…', exact: true }).click()
  check(await page.getByRole('alertdialog').getByRole('checkbox').count() === 0, 'shared worktrees cannot be removed when deleting one conversation')
  await page.getByRole('button', { name: 'Delete chat', exact: true }).click()
  await reusedRow.waitFor({ state: 'detached' })
  check(existsSync(wtApi), 'deleting a shared-worktree conversation preserves the existing worktree')

  await startChat(page, REAL ? 'Throwaway\nReply with the word ramu. Do not change any files.' : 'Throwaway')
  check(await pane(page).locator('.terminal-tab').count() === 2, 'another current-checkout chat reconnects to project terminals')
  const row = page.locator('.task-row', { hasText: 'Throwaway' })
  await row.hover()
  await row.click({ button: 'right' })
  await page.waitForTimeout(300) // let the open animation finish
  await shot(page, '08-task-menu')
  await page.getByRole('menuitem', { name: 'Delete…' }).click()
  await page.getByRole('alertdialog').waitFor()
  await page.waitForTimeout(300) // let the open animation finish
  await shot(page, '09-delete-dialog')
  await page.getByRole('button', { name: 'Delete chat' }).click()
  await row.waitFor({ state: 'detached' })
  check(fingerprint(api) === apiBefore, 'deleting a task leaves the repositories untouched')

  const wtRow = page.locator('.task-row', { hasText: 'Fix checkout flow' })
  await wtRow.hover()
  await wtRow.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete…' }).click()
  await page.getByRole('button', { name: 'Delete chat' }).click()
  await page.getByRole('alertdialog').getByText(/uncommitted changes/).waitFor()
  check(existsSync(join(wtApi, 'README.md')), 'deleting a task with a dirty worktree is refused')
  await page.getByRole('button', { name: 'Cancel' }).click()

  const projectRow = page.locator('.project-row', { hasText: 'shop' })
  await projectRow.hover()
  await projectRow.click({ button: 'right' })
  await page.getByRole('menu', { name: 'shop actions' }).waitFor()
  await page.waitForTimeout(150)
  await shot(page, '09a-project-menu')
  await page.keyboard.press('Escape')
  await projectRow.focus()
  await page.keyboard.press('Shift+F10')
  await page.getByRole('menu', { name: 'shop actions' }).waitFor()
  await page.keyboard.press('ArrowDown')
  check(await page.getByRole('menuitem', { name: 'Rename', exact: true }).evaluate((el) => el === document.activeElement), 'right-click menus support keyboard opening and navigation')
  await page.keyboard.press('Escape')
  await page.locator('.task-row', { hasText: 'Add password reset' }).click()
  await pane(page).getByRole('button', { name: 'Show chat', exact: true }).waitFor()
} catch (err) {
  await shot(page, 'failure').catch(() => {})
  await app.close()
  throw err
}

// Persist terminal presentation independently of the chat and verify the compact layout.
await pane(page).getByRole('button', { name: 'Terminal layout', exact: true }).click()
await page.getByRole('menuitem', { name: 'Tabs down the right', exact: true }).click()
await pane(page).getByRole('button', { name: 'Terminal layout', exact: true }).click()
await page.getByRole('menuitem', { name: 'Arrange side by side', exact: true }).click()
const resizeHandle = await pane(page).getByRole('separator', { name: 'Resize terminal panel' }).boundingBox()
await page.mouse.move(resizeHandle.x + resizeHandle.width / 2, resizeHandle.y + 2)
await page.mouse.down()
await page.mouse.move(resizeHandle.x + resizeHandle.width / 2, resizeHandle.y - 78)
await page.mouse.up()
check((await pane(page).locator('.terminal-panel').boundingBox()).height > 300, 'bottom terminal panel resizes vertically')
await page.setViewportSize({ width: 1280, height: 800 })
await pane(page).getByRole('button', { name: 'New tab', exact: true }).click()
check(await page.getByRole('menuitem', { name: 'New chat', exact: true }).evaluate((el) => el.getBoundingClientRect().height) === 24, 'shared menus use compact 24px rows')
await page.waitForTimeout(150)
await shot(page, '09b-compact-layout')
await page.keyboard.press('Escape')
await page.setViewportSize({ width: 1440, height: 900 })

// Restart: the active task and its tabs come back; processes do not pretend to survive.
await page.waitForTimeout(600) // let debounced UI persistence flush
await app.close()
;({ app, page } = await launch())
try {
  await page.locator('.task-header .header-title', { hasText: 'Add password reset' }).waitFor()
  await pane(page).getByRole('button', { name: 'Show chat', exact: true }).waitFor()
  check((await pane(page).locator('.view-tab').count()) >= 1, 'active conversation and shared file tabs restored after restart')
  await pane(page).locator('.tabs-right .terminal-tabs').waitFor()
  check(await pane(page).locator('.layout-horizontal .terminal-pane:visible').count() === 2 && (await pane(page).locator('.terminal-panel').boundingBox()).height > 300, 'shared terminal tabs, split layout, and panel size restore after restart')
  check(runtimeErrors.length === 0, 'UI journey completed without renderer exceptions')
  await page.waitForTimeout(500)
  await shot(page, '10-restored')
} finally {
  await app.close()
}
console.log(`\nAll checks passed. Screenshots in ${SHOTS}. Temp data in ${tmp}`)
