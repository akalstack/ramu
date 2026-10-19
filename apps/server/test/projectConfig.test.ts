import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { openDb } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import { loadProjectConfig } from '../src/workspace/projectConfig'
import { createDispatcher, type Services } from '../src/ipc'
import { DEFAULT_APP_PREFERENCES } from '@ramu/shared/types'

const cleanup: (() => void)[] = []
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close()
})
function directory() {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-project-config-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

it('discovers only supported files with primary precedence and never falls through an invalid primary', () => {
  const root = directory()
  mkdirSync(join(root, '.ramu'))
  writeFileSync(join(root, '.ramu/config.json'), JSON.stringify({ workspace: { branchPrefix: 'team/' } }))
  expect(loadProjectConfig(root)).toMatchObject({
    source: '.ramu/config.json',
    config: { workspace: { branchPrefix: 'team/' } },
  })
  writeFileSync(join(root, 'ramu.json'), '{')
  expect(loadProjectConfig(root)).toMatchObject({ source: 'ramu.json', config: {}, error: expect.any(String) })
  writeFileSync(join(root, 'ramu.json'), JSON.stringify({ workspace: { branchPrefix: '' } }))
  expect(loadProjectConfig(root).config.workspace?.branchPrefix).toBe('')
})

it('discards sensitive fields and rejects oversized files, unsafe prefixes, duplicate actions and outside symlinks', () => {
  const root = directory()
  writeFileSync(
    join(root, 'ramu.json'),
    JSON.stringify({
      providerBinaries: { codex: { binary: 'malicious' } },
      apiKey: 'secret',
      agent: { defaultAccess: 'full' },
      actions: [],
    }),
  )
  expect(loadProjectConfig(root).config).toEqual({ actions: [] })
  for (const config of [
    { workspace: { branchPrefix: '../escape/' } },
    {
      actions: [
        { id: 'a', name: 'One', command: 'one' },
        { id: 'a', name: 'Two', command: 'two' },
      ],
    },
  ]) {
    writeFileSync(join(root, 'ramu.json'), JSON.stringify(config))
    expect(loadProjectConfig(root).error).toBeTruthy()
  }
  writeFileSync(join(root, 'ramu.json'), ' '.repeat(256 * 1024 + 1))
  expect(loadProjectConfig(root).error).toBeTruthy()
  rmSync(join(root, 'ramu.json'))
  const outside = directory()
  writeFileSync(join(outside, 'config.json'), '{}')
  symlinkSync(join(outside, 'config.json'), join(root, 'ramu.json'))
  expect(loadProjectConfig(root).error).toBeTruthy()
})

it('layers repository actions and branch defaults through the API without executing actions or mutating checkout state', async () => {
  const root = directory()
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git(
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--allow-empty',
    '-qm',
    'Initial',
  )
  const action = { id: 'test', name: 'Test', command: 'touch should-not-exist' }
  writeFileSync(
    join(root, 'ramu.json'),
    JSON.stringify({ actions: [action], workspace: { branchPrefix: 'team/', defaultCheckoutMode: 'worktree' } }),
  )
  const before = git('status', '--porcelain=v2', '--branch')
  const data = directory()
  const db = openDb(join(data, 'ramu.db'))
  cleanup.push(() => db.close())
  const workspace = new Workspace(db, join(data, 'worktrees'))
  const { project, repositories } = await workspace.addProjectFromFolder(root)
  workspace.setAppState('app-preferences', {
    ...DEFAULT_APP_PREFERENCES,
    worktreeBranchInstructions: 'Global instructions',
  })
  const dispatcher = createDispatcher({ userData: data, send: () => {}, native: async () => null }, {
    workspace,
  } as Services)
  cleanup.push(() => dispatcher.close())
  expect(await dispatcher.invoke('tasks.workspaceOptions', [project.id])).toMatchObject({
    defaultCheckoutMode: 'worktree',
    branchPrefix: 'team/',
    branchNaming: 'fixed',
    branchInstructions: 'Global instructions',
    configSource: 'ramu.json',
    branchNameControls: true,
  })
  expect(dispatcher.invoke('projects.actions', [project.id])).toEqual([{ ...action, source: 'ramu.json' }])
  expect(workspace.listTasks()).toEqual([])
  expect(existsSync(join(root, 'should-not-exist'))).toBe(false)
  expect(git('status', '--porcelain=v2', '--branch')).toBe(before)
  const plan = (await dispatcher.invoke('tasks.plan', [
    project.id,
    'A change',
    repositories.map((repo) => repo.id),
  ])) as { taskBranch: string }[]
  expect(plan[0]?.taskBranch).toBe('team/a-change')
  const frozen = (await dispatcher.invoke('tasks.plan', [
    project.id,
    'A change',
    repositories.map((repo) => repo.id),
    undefined,
    { branchPrefix: 'frozen/', strategy: 'fixed' },
  ])) as { taskBranch: string }[]
  expect(frozen[0]?.taskBranch).toBe('frozen/a-change')
  await expect(async () =>
    dispatcher.invoke('tasks.plan', [
      project.id,
      'Bad',
      repositories.map((repo) => repo.id),
      undefined,
      { branchPrefix: '../unsafe', strategy: 'fixed' },
    ]),
  ).rejects.toThrow()
  expect(workspace.listTasks()).toEqual([])

  const created = (await dispatcher.invoke('tasks.create', [
    { projectId: project.id, title: 'Explicit', mode: 'worktree', branchPrefix: 'mine/' },
  ])) as { id: string }
  expect(workspace.listBindings(created.id)[0]?.taskBranch).toBe('mine/explicit')
  expect(readFileSync(join(root, 'ramu.json'), 'utf8')).toContain('team/')
  expect(
    dispatcher.invoke('projects.setActions', [
      project.id,
      [
        { ...action, source: 'ramu.json' },
        { id: 'other', name: 'Other', command: 'echo other' },
      ],
    ]),
  ).toEqual([
    { ...action, source: 'ramu.json' },
    { id: 'other', name: 'Other', command: 'echo other' },
  ])
  expect(workspace.getAppState(`project-actions:${project.id}`, [])).toEqual([
    { id: 'other', name: 'Other', command: 'echo other' },
  ])
  expect(dispatcher.invoke('projects.setActions', [project.id, [{ ...action, command: 'local override' }]])).toEqual([
    { ...action, command: 'local override' },
  ])
})
