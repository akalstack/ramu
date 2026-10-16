// Source Control against real Git repositories: amend, undo, Commit & Push with the default-branch choice,
// and per-repository staging in a multi-repository project. The user's own edits must survive every operation.
import assert from 'node:assert/strict'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { git, modifier, showTask, startRamu } from '../support/index.mjs'

const ramu = await startRamu('source-control', {
  repos: { repo: [{ 'file.txt': 'fixture\n' }, { remote: true }] },
})
const { page } = ramu
const repo = ramu.repos.repo
const alert = () => page.locator('[role=alertdialog]:not([data-slot=toast])')
const message = () => page.getByRole('textbox', { name: 'Commit message for repo', exact: true })
const refresh = () => page.getByRole('button', { name: 'Refresh source control', exact: true }).click()
const commitMenu = async (item) => {
  await page.getByRole('button', { name: 'Commit options', exact: true }).click()
  // Items that can be the default action (Commit, Commit & Push, ...) are menuitemradio, the rest menuitem.
  return page.getByRole('menuitem', { name: item }).or(page.getByRole('menuitemradio', { name: item }))
}
// The app polls the repository while we mutate it, so a write can briefly hit its index.lock.
const write = (...args) =>
  ramu.until(
    () => {
      try {
        return git(repo, ...args) || true
      } catch {
        return false
      }
    },
    `git ${args.join(' ')} kept failing`,
  )
const head = () => git(repo, 'rev-parse', 'HEAD')
const headChanged = (from, what) => ramu.until(() => head() !== from, what)

let task
ramu.test('opens Source Control for a project task', async () => {
  const { project } = await ramu.api('projects.addFolder', repo)
  task = await ramu.api('tasks.create', { projectId: project.id, title: 'Source control', mode: 'current' })
  await ramu.api('tasks.setup', task.id)
  await showTask(ramu, task, { views: [], activeViewId: null })
  await page.getByRole('button', { name: 'Source Control', exact: true }).click()
  await page.locator('.scm-panel').waitFor()
})

ramu.test('commit with nothing staged opens the commit popup and commits the ticked files', async () => {
  writeFileSync(join(repo, 'file.txt'), 'working combined\n')
  writeFileSync(join(repo, 'new.txt'), 'new combined\n')
  await refresh()
  await message().fill('Popup commit')
  await page.getByRole('button', { name: 'Commit', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: /^Commit / })
  await dialog.waitFor()
  assert.equal((await dialog.getByRole('checkbox').count()) >= 2, true, 'every changed file is listed')
  await dialog.getByRole('checkbox', { name: /new\.txt/ }).uncheck()
  await dialog.getByRole('button', { name: /^Commit \d+$/ }).click()
  await ramu.until(() => git(repo, 'log', '-1', '--format=%s') === 'Popup commit', 'popup commit never ran')
  assert.equal(git(repo, 'show', 'HEAD:file.txt'), 'working combined')
  assert.equal(git(repo, 'status', '--porcelain'), '?? new.txt', 'the unticked file stays uncommitted')
  // Restore the fixture so the staged-only journey below keeps its original history assertions.
  rmSync(join(repo, 'new.txt'))
  await write('reset', '--hard', 'HEAD~1')
})

let pushed
ramu.test('amends a pushed commit immediately, keeping its message and unstaged edits', async () => {
  pushed = head()
  writeFileSync(join(repo, 'file.txt'), 'staged\n')
  await write('add', 'file.txt')
  writeFileSync(join(repo, 'file.txt'), 'unstaged\n')
  await refresh()
  await page.getByRole('button', { name: 'Unstage all', exact: true }).waitFor()
  const amend = await commitMenu('Commit (Amend)')
  assert.notEqual(await amend.getAttribute('aria-disabled'), 'true', 'a pushed commit can be amended')
  await amend.click()
  await headChanged(pushed, 'amend never rewrote HEAD')
  assert.equal(await alert().count(), 0, 'amend runs without confirmation')
  assert.equal(git(repo, 'rev-list', '--count', 'HEAD'), '1')
  assert.equal(git(repo, 'show', 'HEAD:file.txt'), 'staged')
  assert.ok(git(repo, 'diff', '--', 'file.txt').includes('+unstaged'), 'unstaged edit survives')
  assert.equal(git(repo, 'log', '-1', '--format=%s'), 'initial')
  assert.equal(git(repo, 'rev-parse', 'origin/main'), pushed, 'amend does not push')
})

ramu.test('amends with a typed message without staging unstaged edits', async () => {
  const amended = head()
  await message().fill('Revised title\n\nRevised body')
  await (await commitMenu('Commit (Amend)')).click()
  await page.waitForFunction(() => document.querySelector('.commit-msg')?.value === '')
  assert.notEqual(head(), amended)
  assert.equal(git(repo, 'log', '-1', '--format=%B'), 'Revised title\n\nRevised body')
  assert.equal(git(repo, 'show', 'HEAD:file.txt'), 'staged')
  assert.equal(git(repo, 'rev-parse', 'origin/main'), pushed)
})

ramu.test('undo of HEAD is offered inline only, keeps staged changes and restores the full message', async () => {
  await write('add', 'file.txt')
  await write('commit', '-qm', 'Undo title\n\nUndo body')
  const undoHead = head()
  const undoParent = git(repo, 'rev-parse', 'HEAD~1')
  await refresh()
  const row = page.locator('.commit-history-entry').first()
  await row.getByText('Undo title', { exact: true }).waitFor()
  await row.locator('.commit-history-head').hover()
  const undo = row.getByRole('button', { name: 'Undo commit', exact: true })
  await undo.waitFor()
  assert.equal(await page.getByRole('button', { name: 'Undo commit', exact: true }).count(), 1, 'only HEAD offers undo')
  await undo.click()
  await alert().getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(head(), undoHead, 'cancel keeps the commit')

  await row.locator('.commit-history-head').hover()
  await row.getByRole('button', { name: 'Commit actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Undo commit', exact: true }).click()
  await alert().getByRole('button', { name: 'Undo commit', exact: true }).click()
  await ramu.until(() => head() === undoParent, 'undo never moved HEAD back')
  assert.ok(git(repo, 'diff', '--cached').includes('+unstaged'), 'undone changes stay staged')
  await ramu.until(async () => (await message().inputValue()) === 'Undo title\n\nUndo body', 'message not restored')
})

/** Chooses Commit & Push from the menu; the default-branch dialog follows when HEAD is on the default branch. */
const choosePush = async () => {
  const item = await commitMenu(/^Commit & Push/)
  await item.click()
}
const branchDialog = () => page.getByRole('alertdialog', { name: 'Commit & Push to default branch?', exact: true })

ramu.test(
  'Commit & Push on the default branch: Cancel keeps the index, a feature branch publishes without touching main',
  async () => {
    await write('reset', '-q', '--hard')
    const main = git(repo, 'rev-parse', 'main')
    const originMain = git(repo, 'rev-parse', 'origin/main')
    writeFileSync(join(repo, 'file.txt'), 'staged feature\n')
    await write('add', 'file.txt')
    writeFileSync(join(repo, 'file.txt'), 'unstaged edit\n')
    await refresh()
    await page.getByRole('button', { name: 'Unstage all', exact: true }).waitFor()
    await message().fill('Feature commit')
    await choosePush()
    await branchDialog().waitFor()
    await branchDialog()
      .getByRole('button', { name: /Cancel/ })
      .click()
    assert.equal(head(), main)
    assert.ok(git(repo, 'diff', '--cached').includes('+staged feature'), 'cancel preserves the index')

    await choosePush()
    await branchDialog().waitFor()
    await branchDialog().getByRole('button', { name: 'Create feature branch', exact: true }).click()
    await ramu.until(() => git(repo, 'branch', '--show-current') !== 'main', 'no feature branch was created')
    const feature = git(repo, 'branch', '--show-current')
    await ramu.until(() => git(repo, 'branch', '-r').includes(`origin/${feature}`), 'not published')
    assert.equal(git(repo, 'rev-parse', 'main'), main)
    assert.equal(git(repo, 'rev-parse', 'origin/main'), originMain)
    assert.equal(git(repo, 'show', 'HEAD:file.txt'), 'staged feature')
    assert.ok(git(repo, 'diff').includes('+unstaged edit'), 'unstaged edit survives')
    ramu.feature = feature
  },
)

ramu.test(
  'the shortcut opens the commit dialog with the typed message and pushes an existing feature branch',
  async () => {
    const { repoId } = (await ramu.api('tasks.bindings', task.id))[0]
    await ramu.api('git.stage', task.id, repoId, ['file.txt'])
    await refresh()
    await message().fill('Second feature commit')
    await message().blur()
    await page.keyboard.press(`${modifier}+Alt+p`)
    const dialog = page.getByRole('dialog', { name: /^Commit / })
    await dialog.waitFor()
    assert.equal(await dialog.getByRole('textbox', { name: 'Commit message' }).inputValue(), 'Second feature commit')
    await dialog.getByRole('button', { name: /^Commit & Push \d+$/ }).click()
    await ramu.until(
      () => git(repo, 'log', '-1', '--format=%s') === 'Second feature commit',
      'shortcut never committed',
    )
    await ramu.until(() => head() === git(repo, 'rev-parse', `origin/${ramu.feature}`), 'shortcut never pushed')
    assert.equal(await page.getByRole('alertdialog').count(), 0, 'no separate branch prompt on a feature branch')
  },
)

ramu.test(
  'the shortcut with Source Control closed opens the commit dialog, which can commit on a new branch and push',
  async () => {
    const main = git(repo, 'rev-parse', 'main')
    await write('switch', '-q', 'main')
    await page.getByRole('button', { name: 'Explorer', exact: true }).click()
    writeFileSync(join(repo, 'file.txt'), 'shortcut feature\n')
    // The app notices the edit through its file watcher; until it does, the shortcut reports "nothing to commit".
    await ramu.until(
      async () => {
        await page.keyboard.press(`${modifier}+Alt+p`)
        return page
          .getByRole('dialog', { name: /^Commit / })
          .waitFor({ timeout: 1000 })
          .then(
            () => true,
            () => false,
          )
      },
      'the shortcut never opened the commit dialog',
      { attempts: 20, interval: 500 },
    )
    const dialog = page.getByRole('dialog', { name: /^Commit / })
    const newBranch = dialog.getByRole('checkbox', { name: /^New branch/ })
    if (!(await newBranch.isChecked())) await newBranch.check()
    await dialog.getByRole('button', { name: /^Commit & Push \d+$/ }).click()
    await ramu.until(() => git(repo, 'branch', '--show-current') !== 'main', 'no feature branch was created')
    await ramu.until(() => git(repo, 'status', '-sb').includes('origin/'), 'not published')
    assert.equal(git(repo, 'show', 'HEAD:file.txt'), 'shortcut feature')
    assert.equal(git(repo, 'rev-parse', 'main'), main)
  },
)

ramu.test('Commit stays local and Commit & Sync publishes, from the commit menu', async () => {
  // The previous step left a published feature branch checked out, so neither action asks for a branch.
  const panel = page.locator('.scm-panel')
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Source Control', exact: true }).click()
  await panel.waitFor()
  const { repoId } = (await ramu.api('tasks.bindings', task.id))[0]
  const branch = git(repo, 'branch', '--show-current')
  const commitWith = async (label, text, content) => {
    await write('checkout', '-q', '--', '.')
    writeFileSync(join(repo, 'file.txt'), content)
    await ramu.until(async () => {
      await ramu.api('git.stage', task.id, repoId, ['file.txt']).catch(() => {})
      return git(repo, 'diff', '--cached', '--name-only') === 'file.txt'
    }, 'file.txt was never staged')
    await refresh()
    await message().fill(text)
    const item = await commitMenu(label)
    for (const other of [/^Commit$/, /^Commit \(Amend\)/, /^Commit & Push/, /^Commit & Sync/])
      await page
        .getByRole('menuitem', { name: other })
        .or(page.getByRole('menuitemradio', { name: other }))
        .waitFor()
    await item.click()
  }
  const published = git(repo, 'rev-parse', `origin/${branch}`)
  await commitWith(/^Commit$/, 'Plain commit', 'plain\n')
  await ramu.until(() => git(repo, 'log', '-1', '--format=%s') === 'Plain commit', 'Commit never committed')
  await ramu.until(async () => (await message().inputValue()) === '', 'the message was not cleared')
  assert.equal(git(repo, 'rev-parse', `origin/${branch}`), published, 'a plain Commit does not push')
  await commitWith(/^Commit & Sync/, 'Synced commit', 'synced\n')
  await ramu.until(() => head() === git(repo, 'rev-parse', `origin/${branch}`), 'Commit & Sync never published')
  assert.equal(git(repo, 'log', '-1', '--format=%s'), 'Synced commit')
})

ramu.test('finishes without renderer errors', () => ramu.noErrors())
