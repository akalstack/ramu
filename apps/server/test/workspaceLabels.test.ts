import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { openDb } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import { createDispatcher, type Services } from '../src/ipc'
import { deviceMayInvoke } from '../src/remote/access'
import type { DeviceInfo } from '../src/remote/devices'

const cleanup: (() => void)[] = []
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close()
})
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ramu-workspace-label-'))
  cleanup.push(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  writeFileSync(join(root, 'file.txt'), 'Original\n')
  git('add', 'file.txt')
  git(
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-qm',
    'Initial',
  )
  writeFileSync(join(root, 'file.txt'), 'Uncommitted\n')
  const profile = mkdtempSync(join(tmpdir(), 'ramu-workspace-label-data-'))
  cleanup.push(() => rmSync(profile, { recursive: true, force: true }))
  const db = openDb(join(profile, 'ramu.db'))
  cleanup.push(() => db.close())
  const workspace = new Workspace(db, join(profile, 'worktrees'))
  const { project } = await workspace.addProjectFromFolder(root)
  const first = await workspace.createTask({ projectId: project.id, title: 'First thread', mode: 'worktree' })
  await workspace.setupTask(first.id)
  const second = await workspace.createTask({
    projectId: project.id,
    title: 'Second thread',
    mode: 'worktree',
    workspaceId: first.workspaceId!,
  })
  const events: string[] = []
  const dispatcher = createDispatcher(
    {
      userData: profile,
      send: (channel) => {
        events.push(channel)
      },
      native: async () => null,
    },
    { workspace } as Services,
  )
  cleanup.push(() => dispatcher.close())
  return { workspace, dispatcher, first, second, db, root, git, profile, events }
}

it('renames the label shared by threads without changing their titles, branches, files or checkout bindings', async () => {
  const f = await fixture()
  const binding = f.workspace.listBindings(f.first.id)[0]!
  const original = {
    status: f.git('status', '--porcelain=v2', '--branch'),
    refs: f.git('show-ref'),
    worktrees: f.git('worktree', 'list', '--porcelain'),
    bindings: f.workspace.listBindings(f.first.id),
    worktreeFile: readFileSync(join(binding.cwd, 'file.txt'), 'utf8'),
  }
  const updated = f.dispatcher.invoke('workspaces.rename', [f.first.workspaceId, '  Shared checkout  ', 'First thread'])
  expect(updated).toMatchObject({ id: f.first.workspaceId, name: 'Shared checkout' })
  expect(f.workspace.getTask(f.first.id).title).toBe('First thread')
  expect(f.workspace.getTask(f.second.id)).toMatchObject({ title: 'Second thread', workspaceId: f.first.workspaceId })
  expect(f.workspace.listBindings(f.second.id).map((entry) => entry.cwd)).toEqual(
    original.bindings.map((entry) => entry.cwd),
  )
  expect(f.workspace.listBindings(f.first.id)).toEqual(original.bindings)
  expect(f.git('status', '--porcelain=v2', '--branch')).toBe(original.status)
  expect(f.git('show-ref')).toBe(original.refs)
  expect(f.git('worktree', 'list', '--porcelain')).toBe(original.worktrees)
  expect(readFileSync(join(binding.cwd, 'file.txt'), 'utf8')).toBe(original.worktreeFile)
  const independent = openDb(join(f.profile, 'ramu.db'))
  cleanup.push(() => independent.close())
  const restarted = new Workspace(independent, join(f.profile, 'worktrees'))
  expect(restarted.getWorktreeWorkspace(f.first.workspaceId!).name).toBe('Shared checkout')
  await expect.poll(() => f.events).toContain('workspace:changed')
})

it('rejects stale changes, invalid names and missing workspaces while accepting a lost-acknowledgement retry', async () => {
  const { dispatcher, first, workspace } = await fixture()
  dispatcher.invoke('workspaces.rename', [first.workspaceId, 'New name', 'First thread'])
  expect(dispatcher.invoke('workspaces.rename', [first.workspaceId, 'New name', 'First thread'])).toMatchObject({
    name: 'New name',
  })
  expect(() => dispatcher.invoke('workspaces.rename', [first.workspaceId, 'Another name', 'First thread'])).toThrow(
    'changed elsewhere',
  )
  for (const name of ['', ' ', '\n\t', 'x'.repeat(201)])
    expect(() => dispatcher.invoke('workspaces.rename', [first.workspaceId, name, 'New name'])).toThrow()
  expect(() => dispatcher.invoke('workspaces.rename', ['missing', 'Name', 'Old'])).toThrow('Unknown isolated workspace')
  expect(workspace.getWorktreeWorkspace(first.workspaceId!).name).toBe('New name')
})

it('keeps workspace label mutations outside viewer access', () => {
  expect(deviceMayInvoke({ role: 'viewer' } as DeviceInfo, 'workspaces.list')).toBe(true)
  expect(deviceMayInvoke({ role: 'viewer' } as DeviceInfo, 'workspaces.rename')).toBe(false)
  expect(deviceMayInvoke({ role: 'owner' } as DeviceInfo, 'workspaces.rename')).toBe(true)
})
