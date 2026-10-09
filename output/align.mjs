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
  const chats = page.getByRole('button', { name: 'Chats', exact: true })
  if (await chats.getAttribute('aria-pressed') !== 'true') await chats.click()
  await page.getByRole('button', { name: 'New chat in shop', exact: true }).click()
  await page.locator('textarea:visible[placeholder*="whole workspace"]').waitFor()
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
  await page.locator('textarea:visible[placeholder*="whole workspace"]').fill('Add a password reset flow to the api')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(2500)
  const chat = pane().getByRole('button', { name: /Chat/ }).first()
  if (!await pane().locator('.agent-view:visible').count() && await chat.count()) await chat.click()
  await pane().locator('.agent-view:visible[data-state="idle"] .msg.assistant').waitFor({ timeout: 30_000 })
  await shot('05-chat')
  await pane().locator('.tool-group > summary').first().click()
  await shot('06-chat-tools')
  await pane().locator('.tool-group > summary').first().click()
})

await step('align', async () => {
  await page.getByRole('button', { name: 'Settings' }).click()
  for (const name of ['Editor & Terminal', 'Git & Chats', 'Background & Recaps']) {
    await page.locator('.settings-page').getByRole('button', { name, exact: true }).click()
    await page.waitForTimeout(300)
    const rows = await page.locator('.settings-row').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); const c = el.querySelector('[data-slot="switch"], .dropdown-trigger, [data-slot="input"]'); const cr = c?.getBoundingClientRect(); return { t: el.querySelector('strong')?.textContent, kind: c?.getAttribute('data-slot') ?? c?.className.split(' ')[0], right: cr && Math.round(r.right - cr.right), mid: cr && Math.round((cr.top + cr.height / 2) - (r.top + r.height / 2)) } }))
    console.log(name, JSON.stringify(rows))
  }
  await page.locator('.settings-page').getByRole('button', { name: 'Editor & Terminal', exact: true }).click()
  await page.locator('.settings-row', { hasText: 'Preview tabs' }).screenshot({ path: join(SHOTS, 'sw1.png') })
  // clicking the label text must not toggle
  const before = await page.locator('.settings-row', { hasText: 'Preview tabs' }).locator('[data-slot="switch"]').getAttribute('aria-checked')
  await page.locator('.settings-row', { hasText: 'Preview tabs' }).locator('strong').click()
  console.log('text click toggled:', before !== await page.locator('.settings-row', { hasText: 'Preview tabs' }).locator('[data-slot="switch"]').getAttribute('aria-checked'))
})
await app.close()
