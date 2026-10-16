// PR feedback uses the existing thread and continues with the window closed. gh is a local fixture;
// the Git repository, IPC, database, input queue and fake provider are the real application paths.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fakeAgent, git, openSettings, saveSettings, showTask, startRamu } from '../support/index.mjs'

let fixture
const pr = {
  number: 7,
  title: 'Watch fixture',
  url: 'https://github.com/fixture/repo/pull/7',
  state: 'OPEN',
  isDraft: false,
  baseRefName: 'main',
  headRefName: 'fix/pr-watch',
  headRefOid: 'sha1',
  reviewDecision: '',
  statusCheckRollup: [],
}
const ramu = await startRamu('pull-request-watch', {
  repos: { repo: [{ 'file.txt': 'fixture\n' }, { remote: true }] },
  env: ({ dir }) => {
    const bin = join(dir, 'bin')
    mkdirSync(bin)
    fixture = join(dir, 'pr.json')
    writeFileSync(fixture, JSON.stringify(pr))
    writeFileSync(
      join(bin, 'gh'),
      `#!${process.execPath}\nconst fs = require('node:fs');\nprocess.stdout.write(fs.readFileSync(${JSON.stringify(fixture)}, 'utf8'));\n`,
      { mode: 0o755 },
    )
    return { PATH: `${bin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}` }
  },
})
const { page, api, until } = ramu
let task, session, repoId
const feedback = async () =>
  (await api('agent.events', session.id)).filter(
    (event) => event.kind === 'user' && event.text.startsWith('Pull request feedback for '),
  )

ramu.test('Source Control lets a user choose an existing thread to watch a PR', async () => {
  git(ramu.repos.repo, 'checkout', '-b', 'fix/pr-watch')
  const { project, repositories } = await api('projects.addFolder', ramu.repos.repo)
  repoId = repositories[0].id
  task = await api('tasks.create', { projectId: project.id, title: 'PR watch thread', mode: 'current' })
  session = await api('agent.start', task.id, 'Reply briefly.', { ...fakeAgent.claude, access: 'full' })
  await until(async () => (await api('agent.get', session.id)).state === 'idle', 'initial thread')
  assert.equal((await api('settings.app.get')).autoWatchPullRequests, false)
  await api('forge.createPullRequest', task.id, repoId, { title: pr.title, body: '', base: 'main', draft: false })
  assert.equal((await api('forge.watchStatus', task.id, repoId, pr.url)).sessionId, null)
  await showTask(ramu, task, { views: [], activeViewId: null })
  await page.getByRole('button', { name: 'Source Control', exact: true }).click()
  const select = page.getByRole('combobox', { name: 'Watch in thread', exact: true })
  await select.click()
  await page.getByRole('option', { name: 'PR watch thread', exact: true }).click()
  await until(
    async () => (await api('forge.watchStatus', task.id, repoId, pr.url)).sessionId === session.id,
    'watch selection',
  )
  await ramu.shot('watch-in-thread')
})

ramu.test('Git settings defaults automatic watches off and applies opt-in to new PR creation', async () => {
  await api('forge.watch', task.id, repoId, pr.url, null)
  await openSettings(ramu, 'Git')
  const toggle = page.getByRole('switch', { name: 'Automatically watch pull requests', exact: true })
  assert.equal(await toggle.isChecked(), false)
  await toggle.check()
  await ramu.shot('automatic-watch-setting')
  await saveSettings(ramu)
  assert.equal((await api('settings.app.get')).autoWatchPullRequests, true)
  // Saving the preference alone must not start watching an existing PR.
  assert.equal((await api('forge.watchStatus', task.id, repoId, pr.url)).sessionId, null)
  await api('forge.createPullRequest', task.id, repoId, { title: pr.title, body: '', base: 'main', draft: false })
  assert.equal((await api('forge.watchStatus', task.id, repoId, pr.url)).sessionId, session.id)
  await openSettings(ramu, 'Git')
  await toggle.uncheck()
  await saveSettings(ramu)
  assert.equal((await api('settings.app.get')).autoWatchPullRequests, false)
  assert.equal((await api('forge.watchStatus', task.id, repoId, pr.url)).sessionId, session.id)
})

ramu.test('a new failure wakes the same thread with the window closed', async () => {
  await ramu.closeApp()
  pr.statusCheckRollup = [
    {
      __typename: 'CheckRun',
      name: 'Build',
      status: 'COMPLETED',
      conclusion: 'FAILURE',
      detailsUrl: 'https://ci.example.test/build/1',
      startedAt: new Date().toISOString(),
    },
  ]
  writeFileSync(fixture, JSON.stringify(pr))
  await until(async () => (await feedback()).length === 1, 'PR feedback while closed', { attempts: 800, interval: 100 })
  await until(async () => (await api('agent.get', session.id)).state === 'idle', 'feedback response')
  assert.equal((await api('agent.list', task.id)).length, 1)
  assert.match((await feedback())[0].text, /Do not push/)
  await ramu.launch()
})

ramu.test('manual fix actions reuse the watched thread and Watch off disables polling', async () => {
  await showTask(ramu, task, { views: [], activeViewId: null })
  await page.getByRole('button', { name: 'Source Control', exact: true }).click()
  await page.getByRole('button', { name: 'Fix failing checks', exact: true }).click()
  await until(async () => (await feedback()).length === 2, 'manual feedback in existing thread')
  assert.equal((await api('agent.list', task.id)).length, 1)
  // Returning to Source Control retains the selected watch.
  if (!(await page.getByRole('combobox', { name: 'Watch in thread', exact: true }).isVisible()))
    await page.getByRole('button', { name: 'Source Control', exact: true }).click()
  await page.getByRole('combobox', { name: 'Watch in thread', exact: true }).click()
  await page.getByRole('option', { name: 'Watch off', exact: true }).click()
  await until(async () => !(await api('forge.watchStatus', task.id, repoId, pr.url)).sessionId, 'watch off')
  await api('forge.watch', task.id, repoId, pr.url, session.id)
  await api('agent.interrupt', session.id)
  assert.equal((await api('forge.watchStatus', task.id, repoId, pr.url)).sessionId, null)
  ramu.noErrors()
})
