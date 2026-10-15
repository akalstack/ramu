// Run after pnpm build. Verifies feature-branch Commit & Push against a local bare remote.
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
const cwd = resolve(import.meta.dirname, '..', 'apps', 'desktop')
const fixture = mkdtempSync(join(tmpdir(), 'ramu-scm-')),
  repo = join(fixture, 'repo'),
  remote = join(fixture, 'remote.git')
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
mkdirSync(repo)
writeFileSync(join(repo, 'file.txt'), 'fixture\n')
execFileSync('git', ['init', '-q', '--bare', remote])
for (const args of [
  ['init', '-q', '-b', 'main'],
  ['config', 'user.name', 'Test'],
  ['config', 'user.email', 'test@example.com'],
  ['config', 'commit.gpgsign', 'false'],
  ['add', '.'],
  ['commit', '-qm', 'initial'],
  ['remote', 'add', 'origin', remote],
  ['push', '-q', '-u', 'origin', 'main'],
])
  git(...args)
const env = { ...process.env, RAMU_USER_DATA: join(fixture, 'profile'), RAMU_FAKE_AGENT: '1' }
delete env.ELECTRON_RENDERER_URL
const app = await electron.launch({ args: [cwd], cwd, env })
const page = await app.firstWindow()
const api = (method, ...args) => page.evaluate(([m, a]) => window.ramu.invoke(m, ...a), [method, args])
const waitForRepo = async (taskId, predicate) => {
  const binding = (await api('tasks.bindings', taskId))[0]
  for (let attempt = 0; attempt < 150; attempt++) {
    if (predicate(await api('git.status', taskId, binding.repoId), await api('git.history', taskId, binding.repoId)))
      return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Timed out waiting for the Git action')
}
const choosePush = async () => {
  await page.getByRole('button', { name: 'Commit options', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Commit & Push', exact: true }).click()
}
try {
  await page.waitForSelector('.shell')
  const { project } = await api('projects.addFolder', repo)
  const task = await api('tasks.create', { projectId: project.id, title: 'Branch before commit', mode: 'current' })
  await api('tasks.setup', task.id)
  await page.reload()
  await page.locator('.task-row').first().click()
  await page.getByRole('button', { name: 'Source Control', exact: true }).click()
  const main = git('rev-parse', 'main')
  writeFileSync(join(repo, 'file.txt'), 'staged feature\n')
  git('add', 'file.txt')
  writeFileSync(join(repo, 'file.txt'), 'unstaged edit\n')
  await page.getByRole('button', { name: 'Refresh source control', exact: true }).click()
  await page.getByRole('button', { name: 'Commit 1 staged', exact: true }).waitFor()
  await page.getByRole('textbox', { name: 'Commit message for repo', exact: true }).fill('Feature commit')
  await choosePush()
  const dialog = page.getByRole('alertdialog', { name: 'Commit & Push to default branch?', exact: true })
  await dialog.waitFor()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(git('rev-parse', 'HEAD'), main)
  assert.equal(git('diff', '--cached').includes('+staged feature'), true)
  await choosePush()
  await dialog.getByRole('textbox', { name: 'Branch name', exact: true }).fill('feature/ui-check')
  await dialog.getByRole('button', { name: 'Create branch', exact: true }).click()
  await waitForRepo(task.id, (status) => status.upstream === 'origin/feature/ui-check')
  assert.equal(git('branch', '--show-current'), 'feature/ui-check')
  assert.equal(git('rev-parse', 'main'), main)
  assert.equal(git('rev-parse', 'origin/main'), main)
  assert.equal(git('show', 'HEAD:file.txt'), 'staged feature')
  assert.equal(git('diff').includes('+unstaged edit'), true)
  console.log(
    'ok - Cancel preserves the index; feature branch commits staged changes and publishes without touching main',
  )

  // The existing feature branch continues directly, using the keyboard shortcut with the panel open.
  await api('git.stage', task.id, (await api('tasks.bindings', task.id))[0].repoId, ['file.txt'])
  await page.getByRole('button', { name: 'Refresh source control', exact: true }).click()
  await page.getByRole('button', { name: 'Commit 1 staged', exact: true }).waitFor()
  await page.getByRole('textbox', { name: 'Commit message for repo', exact: true }).fill('Second feature commit')
  await page.keyboard.press('Meta+Alt+p')
  await waitForRepo(task.id, (_, history) => history[0]?.subject === 'Second feature commit')
  assert.equal(await dialog.count(), 0)
  await waitForRepo(task.id, (status) => status.ahead === 0)
  assert.equal(git('rev-parse', 'HEAD'), git('rev-parse', 'origin/feature/ui-check'))
  console.log('ok - shortcut uses the typed message and pushes an existing feature branch without prompting')

  git('switch', '-q', 'main')
  await page.getByRole('button', { name: 'Explorer', exact: true }).click()
  writeFileSync(join(repo, 'file.txt'), 'shortcut feature\n')
  await page.keyboard.press('Meta+Alt+p')
  await dialog.waitFor()
  await dialog.getByRole('textbox', { name: 'Branch name', exact: true }).fill('feature/closed-panel')
  await dialog.getByRole('button', { name: 'Create branch', exact: true }).click()
  await waitForRepo(task.id, (status) => status.upstream === 'origin/feature/closed-panel')
  assert.equal(git('show', 'HEAD:file.txt'), 'shortcut feature')
  assert.equal(git('rev-parse', 'main'), main)
  console.log(
    'ok - shortcut with Source Control closed offers the branch choice, stages changes, drafts, commits and pushes',
  )
} finally {
  await api('background.stop').catch(() => {})
  await app.close()
}
