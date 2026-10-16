// A workspace folder holding two repositories, driven through the UI: adding the project, editing files, per-repository
// Source Control, and an isolated worktree task. The user's pre-existing Git edits must survive every step untouched.
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after } from 'node:test'
import { createRepo, git, modifier, startRamu } from '../support/index.mjs'

const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'ramu-e2e-shop-')))
after(() => rmSync(fixture, { recursive: true, force: true }))
const shop = join(fixture, 'shop')
const web = createRepo(join(shop, 'shop web'), {
  'README.md': '# web\n',
  'src/App.tsx': 'export function App() {\n  return <h1>Shop</h1>\n}\n',
})
const api = createRepo(
  join(shop, 'api'),
  { 'README.md': '# api\n', 'src/server.ts': 'export const port = 3000\n' },
  { branch: 'develop' },
)
// Pre-existing user edits in api: one staged, one unstaged.
writeFileSync(join(api, 'README.md'), '# api\n\nlocal notes\n')
git(api, 'add', 'README.md')
writeFileSync(join(api, 'src/server.ts'), 'export const port = 3001\n')
const fingerprint = () =>
  git(api, 'status', '--porcelain=v2', '--branch', '-z') + git(api, 'stash', 'list') + git(api, 'diff', '--cached')
const apiBefore = fingerprint()

// The folder dialog answers with the workspace folder.
const ramu = await startRamu('projects', { env: { RAMU_TEST_PICK_DIRECTORY: shop } })
const { page } = ramu
const pane = page.locator('.task-pane:visible')
const alert = () => page.locator('[role=alertdialog]:not([data-slot=toast])')
const untouched = (what) => assert.equal(fingerprint(), apiBefore, `${what} must leave api byte-identical`)

ramu.test('adding a workspace folder detects both child repositories', async () => {
  await page.getByRole('button', { name: 'Add project', exact: true }).click()
  // A folder with several repositories asks which ones to include.
  await page.getByText("This folder contains several repositories. Untick any you don't want in the project.").waitFor()
  await page.getByRole('button', { name: 'Add 2 of 2', exact: true }).click()
  await page.locator('.repo-tree').first().waitFor()
  await ramu.until(async () => (await page.locator('.repo-tree').count()) === 2, 'expected two repo trees')
  untouched('opening a project')
})

ramu.test('edits and saves a file, and tabs of the same name show their repository', async () => {
  const webTree = page.locator('.repo-tree', { hasText: 'shop web' })
  await webTree.getByRole('button', { name: 'src' }).click()
  await webTree.getByRole('button', { name: 'App.tsx' }).click()
  await pane.locator('.monaco-editor .view-lines', { hasText: 'export function App' }).click()
  await page.keyboard.press(`${modifier}+ArrowUp`)
  await page.keyboard.type('// edited in Ramu\n')
  await pane.locator('.view-tab.active .dirty').waitFor()
  await page.keyboard.press(`${modifier}+s`)
  await pane.locator('.view-tab.active .dirty').waitFor({ state: 'detached' })
  assert.ok(readFileSync(join(web, 'src/App.tsx'), 'utf8').startsWith('// edited in Ramu\n'), 'save wrote to web')

  await webTree.getByRole('button', { name: 'README.md' }).dblclick() // pin it, so the next preview does not replace it
  await page.locator('.repo-tree', { hasText: 'api' }).getByRole('button', { name: 'README.md' }).click()
  const tab = pane.locator('.view-tab', { hasText: 'README.md' }).locator('.tab-repo', { hasText: 'api' })
  await tab.waitFor()
})

ramu.test('an external change to a dirty file raises a conflict instead of overwriting', async () => {
  await page.locator('.repo-tree', { hasText: 'shop web' }).getByRole('button', { name: 'App.tsx' }).click()
  await pane.locator('.view[style*="flex"] .monaco-editor .view-lines').click()
  await page.keyboard.type('// unsaved\n')
  writeFileSync(join(web, 'src/App.tsx'), 'export const changedByAgent = true\n')
  await page.getByText('This file changed on disk while you have unsaved edits.').waitFor()
  assert.equal(readFileSync(join(web, 'src/App.tsx'), 'utf8'), 'export const changedByAgent = true\n')
  await page.getByRole('button', { name: 'Use disk version' }).click()
})

ramu.test('stages, drafts and commits in one repository without touching the other', async () => {
  await page.getByRole('button', { name: 'Source Control', exact: true }).click()
  const repoSection = async (name) => {
    const section = page
      .locator('.scm-repo')
      .filter({ has: page.locator('.scm-repo-toggle', { hasText: new RegExp(`^${name}\\d*$`) }) })
    const toggle = section.locator('.scm-repo-toggle')
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
    return section
  }
  const apiScm = await repoSection('api')
  await apiScm.locator('.change-name[title="src/server.ts"]').click()
  await pane.locator('.view[style*="flex"] .monaco-diff-editor').waitFor()

  const webScm = await repoSection('shop web')
  // Row actions only appear on hover.
  await webScm.locator('.change-name[title="src/App.tsx"]').hover()
  await webScm.getByRole('button', { name: 'Stage src/App.tsx' }).click()
  await webScm.getByRole('button', { name: 'Unstage all', exact: true }).waitFor()
  await webScm.getByRole('button', { name: 'AI commit message for shop web' }).click()
  await ramu.until(
    () =>
      webScm
        .getByRole('textbox', { name: 'Commit message for shop web' })
        .inputValue()
        .then((v) => v === 'Update staged files'),
    'AI draft never filled the message',
  )

  // Staging more after the draft invalidates it: the commit must refuse.
  const head = git(web, 'rev-parse', 'HEAD')
  writeFileSync(join(web, 'README.md'), '# staged after the AI draft\n')
  git(web, 'add', 'README.md')
  await webScm.getByRole('button', { name: 'Commit', exact: true }).click()
  await page
    .getByText(/Staged changes changed after the AI draft/)
    .first()
    .waitFor()
  assert.equal(git(web, 'rev-parse', 'HEAD'), head, 'commit refused the stale AI draft')
  git(web, 'restore', '--staged', '--', 'README.md')
  git(web, 'restore', '--', 'README.md')

  await webScm.getByRole('textbox', { name: 'Commit message for shop web' }).fill('Edit App from Ramu')
  await webScm.getByRole('button', { name: 'Commit', exact: true }).click()
  await ramu.until(() => git(web, 'log', '-1', '--format=%s') === 'Edit App from Ramu', 'commit never landed in web')
  untouched('a web commit')

  // The history opens the commit's real diff in the editor area.
  const entry = page.locator('.commit-history-entry', { hasText: 'Edit App from Ramu' })
  await entry.locator('.commit-history-head').hover()
  await entry.getByRole('button', { name: 'View full commit', exact: true }).click()
  await pane.locator('.git-detail-title', { hasText: 'Edit App from Ramu' }).waitFor()
  await pane.locator('.view[style*="flex"] .monaco-editor .view-lines', { hasText: 'changedByAgent' }).waitFor()
})

ramu.test('an isolated worktree task works on its own branch and a dirty one cannot be removed', async () => {
  const [project] = await ramu.api('projects.list')
  const task = await ramu.api('tasks.create', { projectId: project.id, title: 'Fix checkout', mode: 'worktree' })
  await ramu.api('tasks.setup', task.id)
  const worktree = realpathSync(join(ramu.dir, 'worktrees', 'shop', 'fix-checkout', 'api'))
  assert.equal(git(worktree, 'symbolic-ref', '--short', 'HEAD'), 'ramu/fix-checkout')
  writeFileSync(join(worktree, 'README.md'), 'worktree edit\n')
  untouched('worktree edits')
  assert.equal(git(api, 'symbolic-ref', '--short', 'HEAD'), 'develop')

  await page.reload()
  const row = page.locator('.task-row', { hasText: 'Fix checkout' })
  await row.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete…' }).click()
  await page.getByRole('checkbox').click()
  await page.getByRole('button', { name: 'Delete thread', exact: true }).click()
  await alert()
    .getByText(/uncommitted changes/)
    .waitFor()
  assert.equal(readFileSync(join(worktree, 'README.md'), 'utf8'), 'worktree edit\n', 'dirty worktree was kept')
  await page.keyboard.press('Escape')
  await alert().waitFor({ state: 'detached' })
})

ramu.test('finishes without renderer errors', () => ramu.noErrors())
