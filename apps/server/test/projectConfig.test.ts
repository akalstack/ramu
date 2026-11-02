import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { openDb } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import { loadProjectConfig } from '../src/workspace/projectConfig'
import { createDispatcher, type Services } from '../src/ipc'
import { DEFAULT_APP_PREFERENCES, type ProjectAction, type ProjectActionSettings } from '@ramu/shared/types'
import { ProjectActions } from '../src/workspace/projectActions'

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
  expect(loadProjectConfig(root).config).toEqual({ actions: [], agent: {} })
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
  expect(workspace.getAppState(`project-action-settings:${project.id}`, null)).toMatchObject({
    local: [{ id: 'other', name: 'Other', command: 'echo other' }],
  })
  expect(dispatcher.invoke('projects.setActions', [project.id, [{ ...action, command: 'local override' }]])).toEqual([
    { ...action, command: 'local override' },
  ])
})

async function actionFixture() {
  const root = directory()
  const data = directory()
  const db = openDb(join(data, 'actions.db'))
  cleanup.push(() => db.close())
  const workspace = new Workspace(db, join(data, 'worktrees'))
  const { project } = await workspace.addProjectFromFolder(root)
  const send = vi.fn()
  const dispatcher = createDispatcher({ userData: data, send, native: async () => null }, { workspace } as Services)
  cleanup.push(() => dispatcher.close())
  const write = (actions: ProjectAction[]) => writeFileSync(join(root, 'ramu.json'), JSON.stringify({ actions }))
  const a = { id: 'a', name: 'Test', command: 'echo test', keys: 'mod+shift+t' }
  const b = { id: 'b', name: 'Dev', command: 'echo dev' }
  const local = { id: 'local', name: 'Local', command: 'echo local' }
  write([a, b])
  const list = () => dispatcher.invoke('projects.actions', [project.id]) as ProjectAction[]
  const settings = () => dispatcher.invoke('projects.actionSettings', [project.id]) as ProjectActionSettings
  const save = (actions: ProjectAction[]) =>
    dispatcher.invoke('projects.setActions', [project.id, actions]) as ProjectAction[]
  const visibility = (id: string, hidden: boolean) =>
    dispatcher.invoke('projects.setActionVisibility', [project.id, id, hidden]) as ProjectActionSettings
  return { root, data, workspace, project, dispatcher, write, a, b, local, list, settings, save, visibility, send }
}

it('keeps overridden actions in repository order and follows later definitions when editing an unrelated local action', async () => {
  const f = await actionFixture()
  f.save([...f.list(), f.local])
  f.save(f.list().map((action) => (action.id === 'a' ? { ...f.a, command: 'echo override' } : action)))
  expect(f.list().map((action) => action.id)).toEqual(['a', 'b', 'local'])
  const stale = f.list()
  f.write([
    { ...f.b, command: 'echo new repository command' },
    { ...f.a, command: 'echo changed upstream' },
  ])
  f.save(stale.map((action) => (action.id === 'local' ? { ...action, command: 'echo updated local' } : action)))
  expect(f.settings().customOrder).toBe(false)
  f.write([
    { ...f.b, command: 'echo new repository command' },
    { ...f.a, command: 'echo changed upstream' },
  ])
  expect(f.list()).toEqual([
    { ...f.b, command: 'echo new repository command', source: 'ramu.json' },
    { ...f.a, command: 'echo override' },
    { ...f.local, command: 'echo updated local' },
  ])
})

it('persists mixed local/repository ordering without copying commands and can return to repository order', async () => {
  const f = await actionFixture()
  f.save([...f.list(), f.local])
  const original = readFileSync(join(f.root, 'ramu.json'), 'utf8')
  const [a, b, local] = f.list()
  expect(
    (
      f.dispatcher.invoke('projects.reorderActions', [f.project.id, [local!.id, b!.id, a!.id]]) as ProjectActionSettings
    ).actions.map((action) => action.id),
  ).toEqual(['local', 'b', 'a'])
  expect(readFileSync(join(f.root, 'ramu.json'), 'utf8')).toBe(original)
  expect(f.settings().customOrder).toBe(true)
  const added = { id: 'new', name: 'New command', command: 'echo new' }
  f.write([f.a, { ...f.b, command: 'echo changed' }, added])
  expect(f.list().map((action) => [action.id, action.command])).toEqual([
    ['local', 'echo local'],
    ['b', 'echo changed'],
    ['a', 'echo test'],
    ['new', 'echo new'],
  ])
  expect(f.workspace.getAppState(`project-action-settings:${f.project.id}`, null)).toMatchObject({ local: [f.local] })
  const reset = f.dispatcher.invoke('projects.resetActionOrder', [f.project.id]) as ProjectActionSettings
  expect(reset.customOrder).toBe(false)
  expect(reset.actions.map((action) => action.id)).toEqual(['a', 'b', 'new', 'local'])
})

it('hides actions from ordinary lists and preserves hidden commands through older-client saves', async () => {
  const f = await actionFixture()
  f.save([...f.list(), f.local])
  f.visibility('a', true)
  f.visibility('local', true)
  expect(f.list().map((action) => action.id)).toEqual(['b'])
  expect(f.settings().hiddenIds.sort()).toEqual(['a', 'local'])
  const other = { id: 'other', name: 'Other local', command: 'echo other' }
  f.save([...f.list(), other])
  f.write([{ ...f.a, command: 'echo refreshed upstream', keys: 'mod+shift+r' }, f.b])
  f.visibility('a', false)
  f.visibility('local', false)
  expect(f.list()).toEqual([
    { ...f.a, command: 'echo refreshed upstream', keys: 'mod+shift+r', source: 'ramu.json' },
    { ...f.b, source: 'ramu.json' },
    other,
    f.local,
  ])
  expect(f.workspace.listTasks()).toEqual([])
  expect(f.workspace.listWorkspaces()).toEqual([])
})

it('migrates legacy local action storage atomically and retains order/visibility after reopening SQLite', async () => {
  const root = directory(),
    data = directory()
  let db = openDb(join(data, 'actions.db'))
  cleanup.push(() => db.close())
  let workspace = new Workspace(db, join(data, 'worktrees'))
  const { project } = await workspace.addProjectFromFolder(root)
  const local = { id: 'local', name: 'Local', command: 'echo local' }
  const action = { id: 'repo', name: 'Repository', command: 'echo repository' }
  writeFileSync(join(root, 'ramu.json'), JSON.stringify({ actions: [action] }))
  workspace.setAppState(`project-actions:${project.id}`, [local])
  let actions = new ProjectActions(workspace, (id) => workspace.projectConfiguration(id))
  expect(actions.list(project.id).map((entry) => entry.id)).toEqual(['repo', 'local'])
  expect(workspace.getAppState(`project-action-settings:${project.id}`, null)).toBeNull()
  actions.reorder(
    project.id,
    actions
      .list(project.id)
      .map((entry) => entry.id)
      .reverse(),
  )
  actions.visibility(project.id, 'repo', true)
  expect(workspace.getAppState(`project-actions:${project.id}`, [])).toEqual([local])
  db.close()
  db = openDb(join(data, 'actions.db'))
  workspace = new Workspace(db, join(data, 'worktrees'))
  actions = new ProjectActions(workspace, (id) => workspace.projectConfiguration(id))
  expect(actions.list(project.id)).toEqual([local])
  expect(actions.settings(project.id)).toMatchObject({ customOrder: true, hiddenIds: ['repo'] })
  expect(actions.visibility(project.id, 'repo', false).actions.map((entry) => entry.id)).toEqual(['local', 'repo'])
})

it('rejects duplicates, removed actions and unknown projects without overwriting saved state', async () => {
  const f = await actionFixture()
  f.save([...f.list(), f.local])
  const before = f.settings()
  expect(() => f.save([f.local, f.local])).toThrow('unique')
  expect(() => f.visibility('removed', true)).toThrow('no longer available')
  expect(() => f.dispatcher.invoke('projects.reorderActions', [f.project.id, ['a', 'b']])).toThrow('changed elsewhere')
  expect(() => f.dispatcher.invoke('projects.reorderActions', [f.project.id, ['a', 'b', 'b']])).toThrow(
    'changed elsewhere',
  )
  expect(() => f.dispatcher.invoke('projects.setActionVisibility', ['missing', 'a', true])).toThrow()
  expect(f.settings()).toEqual(before)
  f.workspace.setAppState(`project-action-settings:${f.project.id}`, { version: 99, local: [f.local] })
  expect(() => f.list()).toThrow('invalid')
  expect(() => f.save([])).toThrow('invalid')
  expect(f.workspace.getAppState(`project-action-settings:${f.project.id}`, null)).toEqual({
    version: 99,
    local: [f.local],
  })
})

it('announces successful action mutations to other clients while reads and failed writes stay quiet', async () => {
  const f = await actionFixture()
  f.list()
  f.settings()
  expect(f.send).not.toHaveBeenCalled()
  f.visibility('a', true)
  await vi.waitFor(() => expect(f.send).toHaveBeenCalledWith('workspace:changed', {}))
  f.send.mockClear()
  expect(() => f.visibility('missing', false)).toThrow()
  await new Promise((resolve) => setTimeout(resolve, 150))
  expect(f.send).not.toHaveBeenCalled()
  f.save([...f.list(), f.local])
  await vi.waitFor(() => expect(f.send).toHaveBeenCalledWith('workspace:changed', {}))
})
