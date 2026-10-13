// Captures the main surfaces of the built app for visual review, against a throwaway profile and repos.
// Unlike ui-smoke.mjs it asserts nothing; a failing step is logged and the rest still run.
// Usage: pnpm build && SHOTS=output/ui-shots node scripts/ui-shots.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'

const APP_DIR = resolve(import.meta.dirname, '..')
const SHOTS = resolve(process.env.SHOTS ?? '/tmp/ramu-ui-shots')
mkdirSync(SHOTS, { recursive: true })

const tmp = mkdtempSync(join(tmpdir(), 'ramu-shots-'))
const env = { ...process.env, RAMU_USER_DATA: join(tmp, 'profile'), RAMU_WORKTREES: join(tmp, 'worktrees'), RAMU_FAKE_AGENT: '1', RAMU_FAKE_DEMO: '1' }
delete env.ELECTRON_RENDERER_URL

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })
function repo(dir, files, branch) {
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', branch)
  git(dir, 'config', 'user.email', 'shots@example.com')
  git(dir, 'config', 'user.name', 'Shots')
  git(dir, 'config', 'commit.gpgsign', 'false')
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(join(dir, p, '..'), { recursive: true })
    writeFileSync(join(dir, p), c)
  }
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'init')
  return realpathSync(dir)
}

const shop = join(tmp, 'shop')
repo(join(shop, 'web'), {
  'README.md': '# web\n',
  'src/App.tsx': "import { useState } from 'react'\n\nexport function App() {\n  const [email, setEmail] = useState('')\n  return (\n    <form>\n      <h1>Reset your password</h1>\n      <input value={email} onChange={(e) => setEmail(e.target.value)} />\n    </form>\n  )\n}\n",
}, 'main')
const api = repo(join(shop, 'api'), {
  'README.md': '# api\n',
  'src/auth/session.ts': 'export async function createSession(user: { id: string }) {\n  return { userId: user.id, createdAt: Date.now() }\n}\n',
  'src/server.ts': 'export const port = 3000\n',
}, 'develop')
// api has a remote with one incoming and one outgoing commit, plus a saved stash, so Sync and Stashes have something to show.
const remote = join(tmp, 'api-remote.git')
git(tmp, 'init', '-q', '--bare', '-b', 'develop', remote)
git(api, 'remote', 'add', 'origin', remote)
git(api, 'push', '-q', '-u', 'origin', 'develop')
const teammate = join(tmp, 'teammate')
git(tmp, 'clone', '-q', remote, teammate)
for (const [k, v] of [['user.email', 'mate@example.com'], ['user.name', 'Mate'], ['commit.gpgsign', 'false']]) git(teammate, 'config', k, v)
const teammateCommit = (file, text, message) => { git(teammate, 'pull', '-q', '--rebase'); writeFileSync(join(teammate, file), text); git(teammate, 'commit', '-qam', message); git(teammate, 'push', '-q') }
teammateCommit('README.md', '# api\n\nRate limits documented.\n', 'Document rate limits')
writeFileSync(join(api, 'src/auth/session.ts'), 'export async function createSession(user: { id: string }) {\n  return { userId: user.id, createdAt: Date.now(), ttl: 3600 }\n}\n')
git(api, 'commit', '-qam', 'Add session TTL')
writeFileSync(join(api, 'src/server.ts'), 'export const port = 3001\n')
git(api, 'stash', 'push', '-q', '-m', 'Try port 3001')

// The folder dialog answers with the workspace folder.
env.RAMU_TEST_PICK_DIRECTORY = shop
const app = await electron.launch({ args: [APP_DIR], cwd: APP_DIR, env, timeout: 30_000 })
const page = await app.firstWindow()
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.waitForSelector('.shell', { timeout: 20_000 })
await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {})
const pane = () => page.locator('.task-pane[style*="flex"]')
const shot = async (name) => { await page.waitForTimeout(350); await page.screenshot({ path: join(SHOTS, `${name}.png`) }); console.log(`shot ${name}`) }
const CENTER_TARGETS = ['.tree-row', '.tree-root', '.explorer-title', '.menu-item', '[data-slot="dropdown-menu-item"]', '.terminal-tab [role="tab"]', '.terminal-panel-title', '.settings-navigation button', '.settings-row strong', '.sidebar-scope .dropdown-trigger', '.sidebar-checkout', '.task-row', '.nav-btn', '.project-row', '.section-head', 'kbd', '.task-time', '.status-bar > .status-project', '.status-branch', '.status-git-actions button', '.status-checkout', '.view-tab', '.task-header .header-title', '.header-meta', '.chat-switch-btn', '.agent-header button', '.tool-group > summary', '.msg.user', '.context-chips .chip', '.composer-bar .control-btn', '.start-chips .chip-btn', '.chip-btn', '.dropdown-trigger', '.terminal-tab', '.terminal-panel-title', '.view-header .strong', '.tab-repo']
/** Records target boxes and a full-page shot so scripts can measure where text ink sits (INK_PROBE=probe.js). */
const inkProbe = async (tag) => {
  if (!process.env.INK_PROBE) return
  if (process.env.INK_CSS) await page.addStyleTag({ content: readFileSync(process.env.INK_CSS, 'utf8') })
  const targets = await page.evaluate(`(${readFileSync(process.env.INK_PROBE, 'utf8')})(${JSON.stringify(CENTER_TARGETS)})`)
  writeFileSync(join(SHOTS, `ink-${tag}.json`), JSON.stringify(targets))
  await page.screenshot({ path: join(SHOTS, `ink-${tag}.png`) })
}
const step = async (name, fn) => { try { await fn() } catch (e) { console.log(`step ${name} failed: ${e.message.split('\n')[0]}`); await page.screenshot({ path: join(SHOTS, `fail-${name}.png`) }).catch(() => {}); await page.keyboard.press('Escape').catch(() => {}) } }

await step('welcome', async () => { await shot('01-welcome') })
await step('add project', async () => {
  await page.getByRole('button', { name: 'Add project', exact: true }).click()
  await page.locator('.repo-tree').first().waitFor()
  await shot('02-project-files')
})
await step('editor', async () => {
  const web = page.locator('.repo-tree', { hasText: 'web' }).first()
  await web.getByRole('button', { name: 'src' }).click()
  await web.getByRole('button', { name: 'App.tsx' }).click()
  await page.locator('.view[style*="flex"] .monaco-editor .view-lines').waitFor()
  await shot('03-editor')
  await inkProbe('editor')
})
await step('new chat', async () => {
  const chats = page.getByRole('button', { name: 'Home', exact: true })
  if (await chats.getAttribute('aria-pressed') !== 'true') await chats.click()
  await page.getByRole('button', { name: 'New chat in shop', exact: true }).click()
  await page.locator('[data-composer-input]:visible[data-placeholder*="whole workspace"]').waitFor()
  await shot('04-new-chat')
})
await step('chat', async () => {
  await page.getByRole('button', { name: 'Where the work happens' }).click()
  await page.getByRole('menuitem', { name: /^Current checkout/ }).click()
  // The default model set points at real models; the fake catalog only offers the test entries.
  await page.getByRole('button', { name: 'Model and effort controls' }).click()
  await page.getByRole('button', { name: /^Select model/ }).click()
  await page.getByRole('button', { name: 'Claude', exact: true }).click()
  await page.getByText('Claude (test)', { exact: true }).click()
  await page.keyboard.press('Escape')
  const prompt = page.locator('[data-composer-input]:visible[data-placeholder*="whole workspace"]')
  await prompt.fill('Add a password reset flow to the api')
  await prompt.press('Enter')
  await page.waitForTimeout(2500)
  const chat = pane().getByRole('button', { name: /Chat/ }).first()
  if (!await pane().locator('.agent-view:visible').count() && await chat.count()) await chat.click()
  await pane().locator('.agent-view:visible[data-state="idle"] .msg.assistant').waitFor({ timeout: 30_000 })
  await shot('05-chat')
  await pane().locator('.turn-summary-toggle').first().click()
  await pane().locator('.tool-group > [data-slot="collapsible-trigger"]').first().click()
  await shot('06-chat-tools')
  await pane().locator('.tool-group > [data-slot="collapsible-trigger"]').first().click()
  await pane().locator('.turn-summary-toggle').first().click()
})
await step('window actions', async () => {
  await page.locator('.window-actions').getByRole('button', { name: 'Add action' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Dev server')
  await page.getByLabel('Command', { exact: true }).fill('echo ramu-action-ran')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.locator('.window-actions').getByRole('button', { name: 'Dev server' }).click()
  await pane().locator('.xterm-rows', { hasText: 'ramu-action-ran' }).first().waitFor({ timeout: 15_000 })
  await shot('18-window-actions')
})
await step('search chats', async () => {
  await page.locator('.sidebar-top').getByRole('button', { name: 'Search chats', exact: true }).click()
  await shot('21-search-recent')
  await page.getByRole('textbox', { name: 'Search chats', exact: true }).fill('single-use')
  await page.locator('.chat-search-row.message').first().waitFor()
  await shot('22-search-messages')
  await page.locator('.chat-search-row.message').first().click()
  await page.locator('.chat-find-bar input').waitFor()
  const found = await page.locator('.chat-find-bar input').inputValue()
  if (found !== 'single-use') throw new Error(`Find in conversation opened with "${found}"`)
  await shot('23-search-opened')
  await page.keyboard.press('Escape')
})
// Close-ups for spacing review.
await step('details', async () => {
  const crop = async (name, locator) => { if (!await locator.first().isVisible()) return console.log(`skip detail-${name}: not shown`); await locator.first().screenshot({ path: join(SHOTS, `detail-${name}.png`) }); console.log(`shot detail-${name}`) }
  if (process.env.PROBE) console.log(JSON.stringify(await page.evaluate(() => {
    const box = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.checkVisibility()).map((e) => { const r = e.getBoundingClientRect(); return `${Math.round(r.left)}-${Math.round(r.right)} y${Math.round(r.top)} h${Math.round(r.height)}` })
    return { sidebar: box('.sidebar'), kbd: box('.sidebar kbd'), sectionBtn: box('.section-head button svg'), taskTime: box('.task-time'), taskRow: box('.task-row'), navIcon: box('.nav-btn svg'), projIcon: box('.project-row > svg'),
      status: box('.status-bar > *'), git: box('.status-git-actions > *'), branchParts: box('.status-branch > *'), bar: box('.composer-bar:not(:empty) > *'), text: box('[data-composer-input]') }
  }), null, 1))
  if (process.env.CENTER_PROBE) console.log(await page.evaluate(`(${readFileSync(process.env.CENTER_PROBE, 'utf8')})(${JSON.stringify(CENTER_TARGETS)})`))
  await inkProbe('chat')
  await crop('sidebar', page.locator('.sidebar'))
  await page.locator('.task-row').first().hover()
  await crop('task-row-hover', page.locator('.task-list'))
  await page.mouse.move(900, 400)
  await crop('status-bar', pane().locator('.status-bar').or(page.locator('.status-bar')))
  await crop('task-header', page.locator('.task-header'))
  await crop('tabs', pane().locator('.view-tabs'))
  await crop('agent-header', pane().locator('.agent-header:visible'))
  await crop('composer', pane().locator('.composer-dock:visible'))
})
await step('model picker', async () => {
  await pane().locator('.agent-view:visible').getByRole('button', { name: 'Model and effort controls' }).click()
  await shot('07-model-picker')
  await inkProbe('menu')
  await page.keyboard.press('Escape')
})
await step('editor with chat', async () => {
  const tab = pane().locator('.view-tab:visible', { hasText: 'App.tsx' }).first()
  if (await tab.count()) await tab.click()
  else { await page.keyboard.press('Meta+P'); await page.keyboard.type('App.tsx'); await page.waitForTimeout(400); await page.keyboard.press('Enter') }
  await page.waitForTimeout(600)
  await shot('08-editor-with-chat')
})
await step('terminal', async () => {
  if (!await pane().locator('.terminal-panel').isVisible()) await page.locator('.task-header').getByRole('button', { name: 'Terminal', exact: true }).click()
  await pane().getByRole('button', { name: 'New terminal', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Terminal in api', exact: true }).click()
  await pane().locator('.view[style*="flex"] .xterm-rows').waitFor()
  await page.waitForTimeout(1200)
  await shot('09-terminal')
  await inkProbe('terminal')
})
await step('terminal exit', async () => {
  const tabs = pane().locator('.terminal-tab')
  const before = await tabs.count()
  await pane().locator('.terminal-pane.focused .xterm').click()
  await page.keyboard.type('exit\n')
  await page.waitForFunction((n) => document.querySelectorAll('.task-pane[style*="flex"] .terminal-tab').length === n - 1, before, { timeout: 10_000 })
  console.log(`terminal exit closed its tab (${before} -> ${before - 1})`)
})
await step('palette', async () => {
  await page.keyboard.press('Meta+Shift+P')
  await page.locator('.palette-input, [data-slot="command-input"]').first().fill('terminal')
  await shot('10-palette')
  await page.keyboard.press('Escape')
})
await step('git sync', async () => {
  await page.getByRole('button', { name: 'Source Control', exact: true }).click()
  const picker = page.getByRole('combobox', { name: 'Source control repository' })
  if (await picker.count()) { await picker.click(); await page.getByRole('option', { name: 'api', exact: true }).click() }
  // The status bar follows the active file's repository; open an api file so it shows api's sync state.
  await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  const apiTree = page.locator('.repo-tree', { hasText: 'api' }).first()
  for (const name of ['src', 'auth', 'session.ts']) await apiTree.getByRole('button', { name, exact: true }).click()
  await page.getByRole('button', { name: 'Source Control', exact: true }).click()
  await page.locator('.scm-sync', { hasText: '1↓ 1↑' }).waitFor({ timeout: 20_000 })
  await page.locator('.status-bar .sync-button', { hasText: '1↓ 1↑' }).waitFor({ timeout: 20_000 })
  await shot('12-scm-sync')
  await page.getByRole('tab', { name: /^Stashes/ }).click()
  await page.locator('.stash-row').hover()
  await shot('12b-git-stashes')
  await page.locator('.git-inspector').screenshot({ path: join(SHOTS, 'detail-git-stashes.png') })
  await page.getByRole('tab', { name: 'Commits', exact: true }).click()
  await page.locator('.git-inspector').screenshot({ path: join(SHOTS, 'detail-git-commits.png') })
  await page.locator('.status-bar').screenshot({ path: join(SHOTS, 'detail-status-sync.png') })
  await page.locator('.scm-sync').click()
  await page.locator('.scm-sync').waitFor({ state: 'detached', timeout: 20_000 })
  console.log(`sync rebased onto the remote: ${git(api, 'log', '--format=%s', '-3').trim().split('\n').join(' | ')}`)
  // A teammate edits the same line, then we commit our own edit: Sync stops on a rebase conflict.
  teammateCommit('src/server.ts', 'export const port = 4000\n', 'Use port 4000')
  writeFileSync(join(api, 'src/server.ts'), 'export const port = 5000\n')
  git(api, 'commit', '-qam', 'Use port 5000')
  await page.evaluate(() => window.dispatchEvent(new Event('ramu:git-updated')))
  await page.locator('.scm-sync').click()
  await page.locator('.scm-operation').waitFor({ timeout: 20_000 })
  await shot('13-rebase-conflict')
  await page.locator('.status-bar').screenshot({ path: join(SHOTS, 'detail-status-rebasing.png') })
  await page.getByRole('button', { name: 'Abort rebase' }).click()
  await page.locator('.scm-operation').waitFor({ state: 'detached', timeout: 20_000 })
  await shot('14-rebase-aborted')
})
await step('collapsed sidebar', async () => {
  await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click()
  await shot('16-sidebar-hidden')
  await page.getByRole('button', { name: 'Show sidebar', exact: true }).click()
})
await step('schedules', async () => {
  await page.locator('.sidebar-nav').getByRole('button', { name: 'Schedules', exact: true }).click()
  await shot('17-schedules')
  await page.locator('.sidebar-nav').getByRole('button', { name: 'Schedules', exact: true }).click()
})
await step('settings', async () => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.locator('.settings-page').waitFor()
  await shot('11-settings')
  await page.getByRole('button', { name: 'Git & Chats', exact: true }).click()
  await shot('15-settings-git')
  await inkProbe('settings')
  await page.keyboard.press('Escape')
})
await step('commit and push shortcut', async () => {
  // Smart commit: nothing staged, so the shortcut stages every change in web, commits with a drafted message and pushes.
  if (await page.locator('.workspace-tools').count()) await page.locator('.workspace-tools-header').getByRole('button', { name: 'Close', exact: true }).click()
  const web = join(shop, 'web'), webRemote = join(tmp, 'web-remote.git')
  git(tmp, 'init', '-q', '--bare', '-b', 'main', webRemote)
  git(web, 'remote', 'add', 'origin', webRemote)
  git(web, 'push', '-q', '-u', 'origin', 'main')
  writeFileSync(join(web, 'CHANGELOG.md'), '# Changelog\n\n- Password reset flow.\n')
  if (git(api, 'status', '--porcelain').trim()) return console.log('skip commit shortcut: api has changes too')
  await page.locator('.agent-view:visible [data-composer-input]').first().click()
  await page.keyboard.press('Meta+Alt+p')
  await page.getByText(/^Pushed “/).waitFor({ timeout: 20_000 })
  await shot('24-commit-push-toast')
  const pushed = git(web, 'rev-parse', 'HEAD').trim() === git(web, 'rev-parse', '@{u}').trim()
  if (!pushed || !git(web, 'show', '--name-only', '--format=', 'HEAD').includes('CHANGELOG.md')) throw new Error('commit shortcut did not stage, commit and push the change')
  console.log('commit & push shortcut pushed', git(web, 'log', '-1', '--format=%s').trim())
})
await app.close()
