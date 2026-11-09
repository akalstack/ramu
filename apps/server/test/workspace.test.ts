import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../src/db'
import { PathEscapeError, listFolderFiles, readText, resolveInRoot, writeText } from '../src/workspace/files'
import { withContext } from '../src/context'
import { createDispatcher, type Services } from '../src/ipc'
import { NO_PROJECT, type WorktreePlanEntry } from '@ramu/shared/types'
import * as git from '../src/workspace/git'
import { Workspace } from '../src/workspace/workspace'

function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

/** A repo with a commit, a staged change, an unstaged change and an untracked file. */
function makeDirtyRepo(dir: string, branch = 'main'): string {
  mkdirSync(dir, { recursive: true })
  sh(dir, 'init', '-q', '-b', branch)
  sh(dir, 'config', 'user.email', 'test@example.com')
  sh(dir, 'config', 'user.name', 'Test')
  sh(dir, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(dir, 'staged file.txt'), 'one\n')
  writeFileSync(join(dir, 'unstaged.txt'), 'one\n')
  sh(dir, 'add', '.')
  sh(dir, 'commit', '-q', '-m', 'init')
  writeFileSync(join(dir, 'staged file.txt'), 'two\n')
  sh(dir, 'add', 'staged file.txt')
  writeFileSync(join(dir, 'unstaged.txt'), 'two\n')
  writeFileSync(join(dir, 'untracked.txt'), 'new\n')
  return dir
}

/** Everything that "do not create a branch, switch, stash, copy or reset" must leave untouched. */
function fingerprint(dir: string) {
  return {
    status: sh(dir, 'status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'),
    head: sh(dir, 'symbolic-ref', 'HEAD'),
    oid: sh(dir, 'rev-parse', 'HEAD'),
    staged: sh(dir, 'diff', '--cached'),
    unstaged: sh(dir, 'diff'),
    stash: sh(dir, 'stash', 'list'),
    branches: sh(dir, 'branch', '--list', '--format=%(refname)'),
    worktrees: sh(dir, 'worktree', 'list', '--porcelain'),
  }
}

let tmp: string
let ws: Workspace
let web: string
let api: string

beforeEach(() => {
  // os.tmpdir() is /var/... on macOS, which really is /private/var/...; keep it un-canonical on purpose.
  tmp = mkdtempSync(join(tmpdir(), 'ramu test '))
  web = makeDirtyRepo(join(tmp, 'code', 'web app'))
  api = makeDirtyRepo(join(tmp, 'code', 'api'), 'develop')
  ws = new Workspace(openDb(':memory:'), join(tmp, 'worktrees'))
})

afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('project-free thread files', () => {
  it('deletes files and folders directly, unlinks selected symlinks, and protects the root', async () => {
    const task = await ws.createTask({ projectId: NO_PROJECT, title: 'Delete files', mode: 'current' })
    const binding = ws.fileBindings(task.id)[0]!
    const cwd = binding.cwd
    writeFileSync(join(cwd, 'keep.txt'), 'Keep the symlink target')
    symlinkSync(join(cwd, 'keep.txt'), join(cwd, 'link.txt'))
    mkdirSync(join(cwd, 'folder'))
    writeFileSync(join(cwd, 'folder', 'nested.txt'), 'Delete this folder')
    const dispatcher = createDispatcher(
      {
        userData: join(tmp, 'profile'),
        send: () => {},
        native: async () => {
          throw new Error('Deletion must not need a desktop action')
        },
      },
      { workspace: ws } as Services,
    )
    try {
      await dispatcher.invoke('files.delete', [task.id, binding.repoId, 'link.txt'])
      expect(existsSync(join(cwd, 'link.txt'))).toBe(false)
      expect(readFileSync(join(cwd, 'keep.txt'), 'utf8')).toBe('Keep the symlink target')
      await dispatcher.invoke('files.delete', [task.id, binding.repoId, 'folder'])
      expect(existsSync(join(cwd, 'folder'))).toBe(false)
      await expect(dispatcher.invoke('files.delete', [task.id, binding.repoId, ''])).rejects.toThrow(
        'root cannot be deleted',
      )
      await expect(dispatcher.invoke('files.delete', [task.id, binding.repoId, '../'])).rejects.toThrow(PathEscapeError)
      expect(existsSync(cwd)).toBe(true)
      await dispatcher.invoke('files.delete', [task.id, binding.repoId, 'keep.txt'])
      expect(existsSync(join(cwd, 'keep.txt'))).toBe(false)
    } finally {
      dispatcher.close()
    }
  })

  it('exposes the agent folder for editing and context, with a separate persistent folder per thread', async () => {
    const first = await ws.createTask({ projectId: NO_PROJECT, title: 'Notes', mode: 'current' })
    const second = await ws.createTask({ projectId: NO_PROJECT, title: 'Other notes', mode: 'current' })
    const [binding] = ws.fileBindings(first.id)
    const [other] = ws.fileBindings(second.id)
    expect(binding!.folderOnly).toBe(true)
    expect(binding!.cwd).toBe(ws.agentScope(first.id).cwd)
    expect(binding!.cwd).not.toBe(other!.cwd)
    expect(ws.listBindings(first.id)).toEqual([])
    expect(existsSync(join(binding!.cwd, '.git'))).toBe(false)
    writeFileSync(join(binding!.cwd, 'notes.md'), 'Generated notes')
    const file = await readText(ws.getBinding(first.id, binding!.repoId).cwd, 'notes.md')
    await writeText(binding!.cwd, 'notes.md', 'Edited notes', file.hash)
    expect(ws.fileBindings(first.id)[0]!.cwd).toBe(binding!.cwd)
    expect(await listFolderFiles(binding!.cwd)).toEqual(['notes.md'])
    expect(await listFolderFiles(other!.cwd)).toEqual([])
    expect(
      await withContext(ws, first.id, 'Use these notes', [
        { repoId: binding!.repoId, path: 'notes.md', source: 'mention' },
      ]),
    ).toContain('Edited notes')
    const dispatcher = createDispatcher(
      { userData: join(tmp, 'profile'), send: () => {}, native: async () => undefined },
      { workspace: ws } as Services,
    )
    try {
      expect(await dispatcher.invoke('tasks.bindings', [first.id])).toEqual([binding])
      expect(await dispatcher.invoke('files.all', [first.id])).toEqual([{ repoId: 'general', path: 'notes.md' }])
      expect(await dispatcher.invoke('files.all', [second.id])).toEqual([])
      expect(await dispatcher.invoke('files.list', [first.id, 'general', ''])).toEqual([
        { name: 'notes.md', path: 'notes.md', kind: 'file' },
      ])
      const search = (await dispatcher.invoke('files.search', [
        first.id,
        { query: 'Edited', caseSensitive: false, wholeWord: false, regex: false, include: '', exclude: '' },
      ])) as { matches: { path: string }[] }
      expect(search.matches.map((match) => match.path)).toEqual(['notes.md'])
      expect(() => dispatcher.invoke('git.status', [first.id, 'general'])).toThrow('not a Git repository')
    } finally {
      dispatcher.close()
    }
    await expect(readText(other!.cwd, 'notes.md')).rejects.toThrow()
    await expect(readText(binding!.cwd, '../private.md')).rejects.toThrow(PathEscapeError)
  })

  it('does not list linked files from another thread', async () => {
    const first = await ws.createTask({ projectId: NO_PROJECT, title: 'First', mode: 'current' })
    const second = await ws.createTask({ projectId: NO_PROJECT, title: 'Second', mode: 'current' })
    const cwd = ws.agentScope(first.id).cwd,
      other = ws.agentScope(second.id).cwd
    writeFileSync(join(other, 'private.txt'), 'Another thread')
    symlinkSync(other, join(cwd, 'linked-folder'))
    symlinkSync(join(other, 'private.txt'), join(cwd, 'linked-file'))
    expect(await listFolderFiles(cwd)).toEqual([])
    await expect(readText(cwd, 'linked-file')).rejects.toThrow(PathEscapeError)
  })
})

describe('current checkout (default)', () => {
  it('binds to the existing checkouts without mutating Git state', async () => {
    const before = { web: fingerprint(web), api: fingerprint(api) }
    const project = ws.createProject('Shop')
    await ws.addRepository(project.id, join(web, '.')) // non-canonical input
    await ws.addRepository(project.id, api)
    const task = await ws.createTask({ projectId: project.id, title: 'Add password reset', mode: 'current' })

    const bindings = ws.listBindings(task.id)
    expect(bindings.map((b) => b.cwd).sort()).toEqual([realpathSync(api), realpathSync(web)].sort())
    expect(bindings.every((b) => b.setupState === 'ready' && b.taskBranch === null)).toBe(true)

    // Reading status and diffs through the binding is read-only too.
    for (const b of bindings) {
      await git.status(b.cwd)
      await git.showBlob(b.cwd, 'HEAD', 'staged file.txt')
      await git.showBlob(b.cwd, 'INDEX', 'staged file.txt')
    }
    expect({ web: fingerprint(web), api: fingerprint(api) }).toEqual(before)
  })

  it('names the branch each thread works on for the thread list', async () => {
    const project = ws.createProject('Shop')
    const rWeb = await ws.addRepository(project.id, web)
    const rApi = await ws.addRepository(project.id, api)
    const local = await ws.createTask({ projectId: project.id, title: 'Local', mode: 'current' })
    const plan = await ws.planWorktrees(project.id, 'Fix checkout', [rWeb.id, rApi.id])
    const isolated = await ws.createTask({ projectId: project.id, title: 'Fix checkout', mode: 'worktree' }, plan)
    const loose = await ws.createTask({ projectId: NO_PROJECT, title: 'Loose', mode: 'current' })
    const read = async () => ws.threadBranches(ws.listTasks())
    // The first repository by name ("api", on develop) speaks for the shared checkout.
    expect(Object.fromEntries(await read())).toEqual({ [local.id]: 'develop', [isolated.id]: 'ramu/fix-checkout' })
    expect((await read()).has(loose.id)).toBe(false)
    sh(api, 'switch', '-q', '-c', 'feature/reset')
    expect((await read()).get(local.id)).toBe('feature/reset')
    sh(api, 'switch', '-q', '--detach')
    expect((await read()).has(local.id)).toBe(false)
  })

  it('two tasks sharing a checkout share the same canonical cwd', async () => {
    const project = ws.createProject('Shop')
    const repo = await ws.addRepository(project.id, web)
    const a = await ws.createTask({ projectId: project.id, title: 'A', mode: 'current' })
    const b = await ws.createTask({ projectId: project.id, title: 'B', mode: 'current' })
    expect(ws.getBinding(a.id, repo.id).cwd).toBe(ws.getBinding(b.id, repo.id).cwd)
  })

  it('canonicalizes repository roots and labels duplicate names', async () => {
    const project = ws.createProject('Shop')
    const other = makeDirtyRepo(join(tmp, 'elsewhere', 'api'))
    const r1 = await ws.addRepository(project.id, api)
    const r2 = await ws.addRepository(project.id, other)
    const again = await ws.addRepository(project.id, join(api, '..', 'api'))
    expect(r1.root).toBe(realpathSync(api))
    expect(r1.root.startsWith('/private/')).toBe(process.platform === 'darwin')
    expect([r1.name, r2.name]).toEqual(['api', 'api-2'])
    expect(again.id).toBe(r1.id)
  })
})

describe('isolated worktrees (optional)', () => {
  it('refuses a folder or branch another process on the same database already holds, and re-plans once', async () => {
    const file = join(tmp, 'shared.db')
    const first = new Workspace(openDb(file), join(tmp, 'worktrees'))
    const second = new Workspace(openDb(file), join(tmp, 'worktrees'))
    const project = first.createProject('Shop')
    const repo = await first.addRepository(project.id, web)
    const taken = await first.createTask({ projectId: project.id, title: 'Fix checkout', mode: 'worktree' })
    const held = first.listBindings(taken.id)[0]!
    // The second process planned before the first one claimed its names, so its plan still proposes them.
    const stale: WorktreePlanEntry = {
      repoId: repo.id,
      repoName: 'web app',
      baseRef: held.baseRef ?? 'main',
      taskBranch: held.taskBranch!,
      path: held.cwd,
    }
    const plan = second.planWorktrees.bind(second)
    let plans = 0
    second.planWorktrees = async (...args: Parameters<Workspace['planWorktrees']>) =>
      ++plans === 1 ? [stale] : plan(...args)
    const other = await second.createTask({ projectId: project.id, title: 'Fix checkout', mode: 'worktree' })
    const claimed = second.listBindings(other.id)[0]!
    expect(plans).toBe(2)
    expect(claimed.cwd).not.toBe(held.cwd)
    expect(claimed.taskBranch).not.toBe(held.taskBranch)
    // The database itself refuses the same claim, whatever process makes it.
    const duplicate = () =>
      openDb(file)
        .prepare(
          'INSERT INTO bindings (task_id, repo_id, mode, cwd, task_branch, base_ref, setup_state) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run('other-task', repo.id, 'worktree', held.cwd, 'ramu/another', 'main', 'pending')
    expect(duplicate).toThrow(/UNIQUE constraint failed: bindings\.cwd/)
  })

  it('creates task-owned worktrees and routes every path through them', async () => {
    const project = ws.createProject('Shop')
    const rWeb = await ws.addRepository(project.id, web)
    const rApi = await ws.addRepository(project.id, api)
    const before = { web: fingerprint(web), api: fingerprint(api) }

    const plan = await ws.planWorktrees(project.id, 'Fix checkout', [rWeb.id, rApi.id])
    expect(plan.map((p) => [p.repoName, p.baseRef, p.taskBranch])).toEqual([
      ['web app', 'main', 'ramu/fix-checkout'],
      ['api', 'develop', 'ramu/fix-checkout'],
    ])
    const task = await ws.createTask({ projectId: project.id, title: 'Fix checkout', mode: 'worktree' }, plan)
    expect(ws.listBindings(task.id).every((b) => b.setupState === 'pending')).toBe(true)
    const bindings = await ws.setupTask(task.id)
    expect(bindings.every((b) => b.setupState === 'ready')).toBe(true)

    for (const b of bindings) {
      const repo = ws.getRepository(b.repoId)
      expect(b.cwd).not.toBe(repo.root)
      expect(b.cwd.startsWith(realpathSync(join(tmp, 'worktrees')))).toBe(true)
      expect(await git.currentBranch(b.cwd)).toBe('ramu/fix-checkout')
      // Worktrees start from the committed base; the user's dirty files stay in the original checkout.
      expect((await git.status(b.cwd)).entries).toEqual([])
    }

    // An editor save goes to the worktree, not the original checkout.
    const wb = ws.getBinding(task.id, rWeb.id)
    const file = await readText(wb.cwd, 'unstaged.txt')
    expect(file.content).toBe('one\n')
    expect(await writeText(wb.cwd, 'unstaged.txt', 'edited in worktree\n', file.hash)).toMatchObject({ ok: true })
    expect(readFileSync(join(wb.cwd, 'unstaged.txt'), 'utf8')).toBe('edited in worktree\n')
    expect(readFileSync(join(web, 'unstaged.txt'), 'utf8')).toBe('two\n')

    // The original checkouts keep their branch, index, working files and stash; only the new
    // branch and worktree registration are added to the shared repository metadata.
    const after = { web: fingerprint(web), api: fingerprint(api) }
    for (const k of ['web', 'api'] as const) {
      const { branches, worktrees, ...rest } = after[k]
      const { branches: b0, worktrees: w0, ...rest0 } = before[k]
      expect(rest).toEqual(rest0)
      expect(branches).toBe(`${b0}refs/heads/ramu/fix-checkout\n`)
      expect(worktrees.length).toBeGreaterThan(w0.length)
    }
  })

  it('records a partial setup failure and retries only unfinished repositories', async () => {
    const project = ws.createProject('Shop')
    const rWeb = await ws.addRepository(project.id, web)
    const rApi = await ws.addRepository(project.id, api)
    const plan = await ws.planWorktrees(project.id, 'Partial', [rWeb.id, rApi.id])
    const apiPath = plan.find((p) => p.repoId === rApi.id)!.path
    const task = await ws.createTask({ projectId: project.id, title: 'Partial', mode: 'worktree' }, plan)
    // Block the allocated path after creation; a preview no longer reserves paths.
    mkdirSync(apiPath, { recursive: true })
    writeFileSync(join(apiPath, 'in the way'), 'x')
    let bindings = await ws.setupTask(task.id)
    const webB = bindings.find((b) => b.repoId === rWeb.id)!
    expect(webB.setupState).toBe('ready')
    expect(bindings.find((b) => b.repoId === rApi.id)).toMatchObject({ setupState: 'failed' })
    expect(() => ws.getBinding(task.id, rApi.id)).toThrow(/not ready/)

    rmSync(apiPath, { recursive: true })
    const webMarker = join(webB.cwd, 'marker')
    writeFileSync(webMarker, 'keep')
    bindings = await ws.setupTask(task.id)
    expect(bindings.every((b) => b.setupState === 'ready')).toBe(true)
    expect(existsSync(webMarker)).toBe(true) // the ready worktree was not recreated
  })
})

describe('path guard', () => {
  it('accepts names that merely start with two dots', async () => {
    const root = realpathSync(web)
    await expect(resolveInRoot(root, '..notes.txt')).resolves.toBe(join(root, '..notes.txt'))
    await expect(resolveInRoot(root, '...')).resolves.toBe(join(root, '...'))
  })
  it('rejects escapes, absolute paths, .git and outward symlinks', async () => {
    const root = realpathSync(web)
    await expect(resolveInRoot(root, '../api/unstaged.txt')).rejects.toBeInstanceOf(PathEscapeError)
    await expect(resolveInRoot(root, '/etc/hosts')).rejects.toBeInstanceOf(PathEscapeError)
    await expect(resolveInRoot(root, '.git/config')).rejects.toBeInstanceOf(PathEscapeError)
    symlinkSync(api, join(web, 'link-out'))
    await expect(resolveInRoot(root, 'link-out/unstaged.txt')).rejects.toBeInstanceOf(PathEscapeError)
    expect(await resolveInRoot(root, 'src/new file.ts')).toBe(join(root, 'src', 'new file.ts'))
  })

  it('refuses to overwrite a file changed on disk since it was loaded', async () => {
    const root = realpathSync(web)
    const loaded = await readText(root, 'unstaged.txt')
    writeFileSync(join(root, 'unstaged.txt'), 'changed by agent\n')
    const res = await writeText(root, 'unstaged.txt', 'editor buffer\n', loaded.hash)
    expect(res).toMatchObject({ ok: false, reason: 'changed-on-disk' })
    expect(readFileSync(join(root, 'unstaged.txt'), 'utf8')).toBe('changed by agent\n')
  })
})

describe('git porcelain v2 parsing', () => {
  it('handles staged, unstaged, untracked, renames and spaces', async () => {
    const root = realpathSync(web)
    writeFileSync(join(root, 'old name.md'), 'a stable body that git can match\n'.repeat(5))
    sh(root, 'add', 'old name.md')
    sh(root, 'commit', '-q', '-m', 'add doc')
    sh(root, 'mv', 'old name.md', 'renamed file.md')
    const s = await git.status(root)
    expect(s.branch).toBe('main')
    expect(s.entries).toEqual(
      expect.arrayContaining([
        { path: 'renamed file.md', origPath: 'old name.md', staged: 'renamed', unstaged: null },
        { path: 'unstaged.txt', staged: null, unstaged: 'modified' },
        { path: 'untracked.txt', staged: null, unstaged: 'untracked' },
      ]),
    )
  })

  it('stages, unstages and commits only within the binding cwd', async () => {
    const root = realpathSync(web)
    const apiBefore = fingerprint(api)
    await git.stage(root, ['unstaged.txt'])
    expect((await git.status(root)).entries.find((e) => e.path === 'unstaged.txt')).toMatchObject({
      staged: 'modified',
      unstaged: null,
    })
    await git.unstage(root, ['unstaged.txt'])
    expect((await git.status(root)).entries.find((e) => e.path === 'unstaged.txt')).toMatchObject({
      staged: null,
      unstaged: 'modified',
    })
    const oid = await git.commit(root, 'Commit "quoted" $(not a shell)')
    expect(sh(root, 'log', '-1', '--format=%s').trim()).toBe('Commit "quoted" $(not a shell)')
    expect(oid).toMatch(/^[0-9a-f]{40}$/)
    expect(fingerprint(api)).toEqual(apiBefore)
  })
})

describe('projects from folders', () => {
  it('adds only the chosen child repositories of a plain folder', async () => {
    const { repositories } = await ws.addProjectFromFolder(join(tmp, 'code'), [realpathSync(api)])
    expect(repositories.map((r) => r.name)).toEqual(['api'])
  })

  it('refuses an empty choice of child repositories', async () => {
    await expect(ws.addProjectFromFolder(join(tmp, 'code'), [])).rejects.toThrow('Choose at least one repository.')
  })

  it('groups child repositories of a plain folder as a workspace and runs agents at its root', async () => {
    const before = { web: fingerprint(web), api: fingerprint(api) }
    mkdirSync(join(tmp, 'code', 'notes')) // not a repository
    const { project, repositories } = await ws.addProjectFromFolder(join(tmp, 'code'))
    expect(project.root).toBe(realpathSync(join(tmp, 'code')))
    expect(repositories.map((r) => r.name).sort()).toEqual(['api', 'web app'])

    const task = await ws.createTask({ projectId: project.id, title: 'Both', mode: 'current' })
    const scope = ws.agentScope(task.id)
    expect(scope.cwd).toBe(project.root)
    expect(scope.additionalDirs).toEqual([])
    expect(scope.covers.sort()).toEqual([realpathSync(api), realpathSync(web)].sort())
    expect({ web: fingerprint(web), api: fingerprint(api) }).toEqual(before)

    // Adding the same folder again returns the existing project.
    expect((await ws.addProjectFromFolder(join(tmp, 'code'))).project.id).toBe(project.id)
  })

  it('adds a repository folder as a single-repo project that can connect other repositories', async () => {
    const { project, repositories } = await ws.addProjectFromFolder(api)
    expect(repositories).toHaveLength(1)
    expect(project.root).toBe(realpathSync(api))
    await ws.addRepository(project.id, web)
    const task = await ws.createTask({ projectId: project.id, title: 'Connected', mode: 'current' })
    const scope = ws.agentScope(task.id)
    expect(scope.cwd).toBe(realpathSync(api))
    expect(scope.additionalDirs).toEqual([realpathSync(web)])
  })

  it('runs worktree-task agents in the task folder that holds every worktree', async () => {
    const { project } = await ws.addProjectFromFolder(join(tmp, 'code'))
    const task = await ws.createTask({ projectId: project.id, title: 'Iso', mode: 'worktree' })
    await ws.setupTask(task.id)
    const scope = ws.agentScope(task.id)
    expect(scope.cwd).toBe(realpathSync(join(tmp, 'worktrees', 'code', 'iso')))
    expect(scope.additionalDirs).toEqual([])
  })

  it('adds a folder with no Git repositories as a plain-folder project', async () => {
    mkdirSync(join(tmp, 'empty'))
    const { project, repositories } = await ws.addProjectFromFolder(join(tmp, 'empty'))
    expect(project.name).toBe('empty')
    expect(project.root).toBe(realpathSync(join(tmp, 'empty')))
    expect(repositories).toHaveLength(1)
    expect(repositories[0]!.root).toBe(realpathSync(join(tmp, 'empty')))
    // Adding it again returns the same project.
    expect((await ws.addProjectFromFolder(join(tmp, 'empty'))).project.id).toBe(project.id)
  })
})

describe('task lifecycle', () => {
  it('renames, archives and deletes a current-checkout task without touching the repository', async () => {
    const before = fingerprint(web)
    const project = ws.createProject('Shop')
    await ws.addRepository(project.id, web)
    const task = await ws.createTask({ projectId: project.id, title: 'Old', mode: 'current' })
    expect(ws.renameTask(task.id, '  New title ').title).toBe('New title')
    expect(ws.setArchived(task.id, true).status).toBe('archived')
    expect(ws.setArchived(task.id, false).status).toBe('idle')
    await ws.deleteTask(task.id, true)
    expect(ws.listTasks()).toEqual([])
    expect(fingerprint(web)).toEqual(before)
    expect(() => ws.removeProject(project.id)).not.toThrow()
  })

  it('removes clean worktrees on delete, keeps their branches, and refuses dirty ones', async () => {
    const project = ws.createProject('Shop')
    await ws.addRepository(project.id, web)
    const task = await ws.createTask({ projectId: project.id, title: 'Iso', mode: 'worktree' })
    const [b] = await ws.setupTask(task.id)
    writeFileSync(join(b!.cwd, 'wip.txt'), 'unsaved work')
    await expect(ws.deleteTask(task.id, true)).rejects.toThrow(/uncommitted changes/)
    expect(existsSync(join(b!.cwd, 'wip.txt'))).toBe(true)
    expect(ws.listTasks()).toHaveLength(1)

    rmSync(join(b!.cwd, 'wip.txt'))
    await ws.deleteTask(task.id, true)
    expect(existsSync(b!.cwd)).toBe(false)
    expect(sh(web, 'branch', '--list', 'ramu/iso').trim()).toBe('ramu/iso')
  })

  it('refuses to remove a project that still has tasks', async () => {
    const project = ws.createProject('Shop')
    const repo = await ws.addRepository(project.id, web)
    await ws.createTask({ projectId: project.id, title: 'Keep', mode: 'current' })
    expect(() => ws.removeProject(project.id)).toThrow(/Delete this project's 1 thread first/)
    // Current-checkout tasks follow the project, so they don't pin a repository; worktree tasks do.
    const iso = await ws.createTask({ projectId: project.id, title: 'Iso', mode: 'worktree' })
    await ws.setupTask(iso.id)
    expect(() => ws.removeRepository(repo.id)).toThrow(/isolated workspace still uses/)
  })
})

describe('repositories belong to the project', () => {
  it('current-checkout tasks and the workspace view follow the project repositories live', async () => {
    const project = ws.createProject('Shop')
    await ws.addRepository(project.id, web)
    const task = await ws.createTask({ projectId: project.id, title: 'Live', mode: 'current' })
    expect(ws.listBindings(task.id).map((b) => b.repoName)).toEqual(['web app'])
    await ws.addRepository(project.id, api)
    expect(ws.listBindings(task.id).map((b) => b.repoName)).toEqual(['api', 'web app'])
    expect(
      ws
        .listBindings(`project:${project.id}`)
        .map((b) => b.cwd)
        .sort(),
    ).toEqual([realpathSync(api), realpathSync(web)].sort())
    expect(ws.getTaskUi(`project:${project.id}`)).toEqual({ views: [], activeViewId: null })
  })
})

describe('multiple independent conversations in an isolated workspace', () => {
  it('reuses worktrees without creating branches and preserves them when a conversation is deleted', async () => {
    const project = ws.createProject('Shared worktree')
    await ws.addRepository(project.id, web)
    const first = await ws.createTask({ projectId: project.id, title: 'First conversation', mode: 'worktree' })
    const [binding] = await ws.setupTask(first.id)
    const before = fingerprint(web)
    const second = await ws.createTask({
      projectId: project.id,
      title: 'Second conversation',
      mode: 'worktree',
      workspaceId: first.workspaceId!,
    })
    expect(second.id).not.toBe(first.id)
    expect(second.workspaceId).toBe(first.workspaceId)
    expect(ws.getBinding(second.id, binding!.repoId).cwd).toBe(binding!.cwd)
    expect(ws.agentScope(second.id)).toEqual(ws.agentScope(first.id))
    expect(fingerprint(web)).toEqual(before)
    await expect(ws.deleteTask(first.id, true)).rejects.toThrow(/other threads/)
    await ws.deleteTask(first.id, false)
    expect(existsSync(binding!.cwd)).toBe(true)
    expect(ws.getBinding(second.id, binding!.repoId).cwd).toBe(binding!.cwd)
    await ws.deleteTask(second.id, false)
    const third = await ws.createTask({
      projectId: project.id,
      title: 'Later conversation',
      mode: 'worktree',
      workspaceId: first.workspaceId!,
    })
    expect(ws.listWorkspaces(project.id)).toHaveLength(1)
    await ws.deleteTask(third.id, true)
    expect(existsSync(binding!.cwd)).toBe(false)
    expect(ws.listWorkspaces(project.id)).toHaveLength(0)
  })

  it('creates different worktrees when requested and rejects reuse across projects', async () => {
    const project = ws.createProject('Independent')
    await ws.addRepository(project.id, web)
    const first = await ws.createTask({ projectId: project.id, title: 'First', mode: 'worktree' })
    const [a] = await ws.setupTask(first.id)
    const second = await ws.createTask({ projectId: project.id, title: 'Second', mode: 'worktree' })
    const [b] = await ws.setupTask(second.id)
    expect(a!.cwd).not.toBe(b!.cwd)
    expect(first.workspaceId).not.toBe(second.workspaceId)
    const other = ws.createProject('Other')
    await ws.addRepository(other.id, api)
    await expect(
      ws.createTask({ projectId: other.id, title: 'Wrong project', mode: 'worktree', workspaceId: first.workspaceId! }),
    ).rejects.toThrow(/not in this project/)
  })
})

describe('thread titles', () => {
  it('an AI title replaces the prompt title but never one the user typed', async () => {
    const project = ws.createProject('Shop')
    await ws.addRepository(project.id, web)
    const task = await ws.createTask({ projectId: project.id, title: 'Hello', mode: 'current' })
    expect(ws.titleSource(task.id)).toBe('prompt')
    expect(ws.setGeneratedTitle(task.id, 'Greeting').title).toBe('Greeting')
    expect(ws.titleSource(task.id)).toBe('ai')

    ws.renameTask(task.id, 'My name')
    expect(ws.titleSource(task.id)).toBe('manual')
    expect(ws.setGeneratedTitle(task.id, 'Automatic').title).toBe('My name')
    expect(ws.setGeneratedTitle(task.id, 'Asked for it', true).title).toBe('Asked for it')
  })
})

describe('thread activity timestamps', () => {
  it('follows user messages across sessions, ignoring assistant and helper activity', async () => {
    const db = openDb(':memory:')
    try {
      const workspace = new Workspace(db, join(tmp, 'activity-worktrees'))
      const task = await workspace.createTask({ projectId: NO_PROJECT, title: 'Activity', mode: 'current' })
      expect(workspace.getTask(task.id).lastActiveAt).toBe(task.createdAt)
      const start = task.createdAt + 1000
      const session = (id: string, at: number, parent: string | null = null) =>
        db
          .prepare(
            'INSERT INTO agent_sessions (id, task_id, provider, cwd, state, created_at, parent_session_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(id, task.id, 'codex', tmp, 'idle', at, parent)
      const event = (id: string, seq: number, body: object) =>
        db
          .prepare('INSERT INTO agent_events (session_id, seq, event) VALUES (?, ?, ?)')
          .run(id, seq, JSON.stringify(body))
      session('main', start)
      event('main', 1, { kind: 'user', text: 'First', at: start })
      event('main', 2, { kind: 'user', text: 'Follow-up', at: start + 1000 })
      event('main', 3, { kind: 'text', text: 'Reply', at: start + 2000 })
      event('main', 4, { kind: 'user', text: 'Helper prompt', agentId: 'helper', at: start + 3000 })
      session('helper', start + 4000, 'main')
      event('helper', 1, { kind: 'user', text: 'Internal prompt', at: start + 4000 })
      session('empty', start + 5000)
      expect(workspace.getTask(task.id).lastActiveAt).toBe(start + 1000)
      expect(workspace.listTasks()[0]!.lastActiveAt).toBe(start + 1000)
      session('legacy', start + 6000)
      event('legacy', 1, { kind: 'user', text: 'Old timestamp-free message' })
      expect(workspace.getTask(task.id).lastActiveAt).toBe(start + 6000)
    } finally {
      db.close()
    }
  })
})

describe('pinning', () => {
  it('pins and unpins a thread', async () => {
    const project = ws.createProject('Shop')
    await ws.addRepository(project.id, web)
    const task = await ws.createTask({ projectId: project.id, title: 'Hello', mode: 'current' })
    expect(task.pinnedAt).toBeNull()
    expect(ws.setPinned(task.id, true).pinnedAt).toBeGreaterThan(0)
    expect(ws.listTasks()[0]!.pinnedAt).toBeGreaterThan(0)
    expect(ws.setPinned(task.id, false).pinnedAt).toBeNull()
  })
})

describe('project order', () => {
  it('keeps a dragged order and puts unlisted projects after it', async () => {
    const a = ws.createProject('A'),
      b = ws.createProject('B'),
      c = ws.createProject('C')
    expect(ws.listProjects().map((p) => p.name)).toEqual(['A', 'B', 'C'])
    expect(ws.reorderProjects([c.id, a.id]).map((p) => p.name)).toEqual(['C', 'A', 'B'])
    expect(ws.listProjects().map((p) => p.id)).toEqual([c.id, a.id, b.id])
  })
})

describe('authoritative worktree creation', () => {
  it('ignores client mutation paths and records the exact base commit', async () => {
    const project = ws.createProject('Shop')
    const repo = await ws.addRepository(project.id, web)
    const plan = await ws.planWorktrees(project.id, 'Fixed base', [repo.id])
    const oid = await git.headOid(web)
    plan[0]!.path = join(tmp, 'outside-managed-root')
    plan[0]!.taskBranch = '--bad-client-branch'
    const task = await ws.createTask({ projectId: project.id, title: 'Fixed base', mode: 'worktree' }, plan)
    sh(web, 'commit', '-q', '-m', 'moved base')
    const bindings = await ws.setupTask(task.id)
    expect(bindings[0]!.setupState).toBe('ready')
    expect(bindings[0]!.cwd).not.toBe(plan[0]!.path)
    expect(bindings[0]!.taskBranch).toBe('ramu/fixed-base')
    expect(await git.headOid(bindings[0]!.cwd)).toBe(oid)
  })
  it('rejects a preview whose base moved before creation', async () => {
    const project = ws.createProject('Shop')
    const repo = await ws.addRepository(project.id, web)
    const plan = await ws.planWorktrees(project.id, 'Changed', [repo.id])
    sh(web, 'commit', '-q', '-m', 'moved base')
    const input = { projectId: project.id, title: 'Changed', mode: 'worktree' as const, requestId: 'review-base' }
    await expect(ws.createTask(input, plan)).rejects.toThrow(/HEAD changed/)
    expect(ws.listTasks()).toEqual([])
    const reviewed = await ws.planWorktrees(project.id, 'Changed', [repo.id])
    const task = await ws.createTask(input, reviewed)
    // A lost acknowledgement still resolves the original receipt, even with the obsolete plan.
    expect((await ws.createTask(input, plan)).id).toBe(task.id)
    expect(ws.listTasks()).toHaveLength(1)
  })
  it('reserves pending allocations, serializes concurrent creates and deduplicates retries', async () => {
    const project = ws.createProject('Shop')
    await ws.addRepository(project.id, web)
    const input = { projectId: project.id, title: 'Same title', mode: 'worktree' as const, branchPrefix: 'feature/' }
    const [a, b] = await Promise.all([
      ws.createTask({ ...input, requestId: 'one' }),
      ws.createTask({ ...input, requestId: 'two' }),
    ])
    expect(a.id).not.toBe(b.id)
    expect(ws.listBindings(a.id)[0]!.cwd).not.toBe(ws.listBindings(b.id)[0]!.cwd)
    expect(ws.listBindings(a.id)[0]!.taskBranch).toBe('feature/same-title')
    expect(ws.listBindings(b.id)[0]!.taskBranch).toBe('feature/same-title-2')
    expect((await ws.createTask({ ...input, requestId: 'one' })).id).toBe(a.id)
    await expect(ws.createTask({ ...input, title: 'Other', requestId: 'one' })).rejects.toThrow(/different inputs/)
  })
  it('does not adopt an unrelated branch that appeared after allocation', async () => {
    const project = ws.createProject('Shop')
    await ws.addRepository(project.id, web)
    const task = await ws.createTask({ projectId: project.id, title: 'Conflict', mode: 'worktree' })
    sh(web, 'branch', 'ramu/conflict')
    expect((await ws.setupTask(task.id))[0]).toMatchObject({
      setupState: 'failed',
      setupError: expect.stringContaining('ownership'),
    })
  })
  it('reserves case-conflicting folders and branch namespaces without changing the current checkout', async () => {
    const project = ws.createProject('Case collisions')
    const repo = await ws.addRepository(project.id, web)
    mkdirSync(join(tmp, 'worktrees', 'case-collisions', 'SAME-TITLE'), { recursive: true })
    sh(web, 'branch', 'Feature/Reserved')
    const before = fingerprint(web)
    const plan = await ws.planWorktrees(project.id, 'Same title', [repo.id])
    expect(plan[0]!.path).toBe(join(tmp, 'worktrees', 'case-collisions', 'same-title-2', 'web app'))
    for (const name of ['feature', 'feature/reserved', 'feature/reserved/child']) {
      await expect(ws.planWorktrees(project.id, 'Manual', [repo.id], '', { name, source: 'manual' })).rejects.toThrow(
        'already taken',
      )
    }
    expect(ws.listTasks(project.id)).toEqual([])
    expect(fingerprint(web)).toEqual(before)
  })
  it('starts a worktree from a detached checkout at its commit without touching the checkout', async () => {
    const project = ws.createProject('Detached')
    await ws.addRepository(project.id, web)
    sh(web, 'checkout', '-q', '--detach')
    const state = () => [
      sh(web, 'status', '--porcelain=v2', '-z', '--untracked-files=all'),
      sh(web, 'diff', '--cached'),
      sh(web, 'diff'),
      sh(web, 'stash', 'list'),
    ]
    const before = state()
    const oid = await git.headOid(web)
    const task = await ws.createTask({ projectId: project.id, title: 'From detached', mode: 'worktree' })
    const [binding] = await ws.setupTask(task.id)
    expect(binding).toMatchObject({ setupState: 'ready', taskBranch: 'ramu/from-detached' })
    expect(await git.headOid(binding!.cwd)).toBe(oid)
    expect(state()).toEqual(before)
    expect(sh(web, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('HEAD')
  })
  it('reports a repository without commits instead of creating a worktree from nothing', async () => {
    const project = ws.createProject('Unborn')
    const empty = join(tmp, 'code', 'empty')
    mkdirSync(empty, { recursive: true })
    sh(empty, 'init', '-q', '-b', 'main')
    await ws.addRepository(project.id, empty)
    await expect(ws.createTask({ projectId: project.id, title: 'No commits', mode: 'worktree' })).rejects.toThrow(
      /no commits/,
    )
    expect(ws.listTasks(project.id)).toEqual([])
    expect(sh(empty, 'worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(1)
    expect(sh(empty, 'branch', '--list')).toBe('')
  })
  it('retains pending allocation and creation receipts across a database reopen', async () => {
    const database = join(tmp, 'allocation.sqlite')
    let db = openDb(database)
    try {
      let workspace = new Workspace(db, join(tmp, 'durable-worktrees'))
      const project = workspace.createProject('Restart')
      await workspace.addRepository(project.id, web)
      const input = {
        projectId: project.id,
        title: 'Same title',
        mode: 'worktree' as const,
        requestId: 'durable-request',
      }
      const first = await workspace.createTask(input)
      const binding = workspace.listBindings(first.id)[0]!
      expect(existsSync(binding.cwd)).toBe(false)
      db.close()
      db = openDb(database)
      workspace = new Workspace(db, join(tmp, 'durable-worktrees'))
      expect((await workspace.createTask(input)).id).toBe(first.id)
      const second = await workspace.createTask({ ...input, requestId: 'after-restart' })
      const secondBinding = workspace.listBindings(second.id)[0]!
      expect(secondBinding.cwd).not.toBe(binding.cwd)
      expect(secondBinding.taskBranch).toBe('ramu/same-title-2')
      expect((await workspace.setupTask(first.id))[0]!.setupState).toBe('ready')
      expect((await workspace.setupTask(second.id))[0]!.setupState).toBe('ready')
      expect((await workspace.createTask(input)).id).toBe(first.id)
      expect(workspace.listTasks(project.id)).toHaveLength(2)
    } finally {
      db.close()
    }
  })
})

describe('read-only Explorer scope', () => {
  it('browses a project without creating a thread or changing its checkout', async () => {
    const project = ws.createProject('Browse')
    const repo = await ws.addRepository(project.id, web)
    const before = fingerprint(web)
    const bindings = ws.explorerBindings(`project:${project.id}`)
    const { browseDirectory } = await import('../src/workspace/files')
    const result = await browseDirectory(bindings[0]!.cwd, '')
    expect(result.entries.some((entry) => entry.name === 'untracked.txt')).toBe(true)
    expect(ws.listTasks(project.id)).toEqual([])
    expect(ws.listWorkspaces()).toEqual([])
    expect(bindings[0]!.repoId).toBe(repo.id)
    expect(fingerprint(web)).toEqual(before)
    await expect(browseDirectory(bindings[0]!.cwd, '../')).rejects.toThrow()
  })
  it('does not allocate a standalone working folder merely to browse it', async () => {
    const task = await ws.createTask({ projectId: NO_PROJECT, title: 'Not started', mode: 'current' })
    expect(ws.explorerBindings(task.id)).toEqual([])
    expect(existsSync(join(tmp, 'chats', task.id))).toBe(false)
  })
  it('bounds directory responses and marks truncation explicitly', async () => {
    const { browseDirectory } = await import('../src/workspace/files')
    const root = join(tmp, 'many-files')
    mkdirSync(root)
    for (let index = 0; index < 2001; index++) {
      const name =
        index === 1999 && process.platform !== 'win32' ? '1999\\notes.txt' : `${String(index).padStart(4, '0')}.txt`
      writeFileSync(join(root, name), '')
    }
    const result = await browseDirectory(realpathSync(root), '')
    expect(result.entries).toHaveLength(2000)
    expect(result.truncated).toBe(true)
    expect(result.nextCursor).toEqual(expect.any(String))
    if (process.platform !== 'win32') expect(result.entries.at(-1)!.name).toBe('1999\\notes.txt')
    const rest = await browseDirectory(realpathSync(root), '', result.nextCursor)
    expect(rest.entries).toHaveLength(1)
    expect(rest.truncated).toBe(false)
    expect(rest.nextCursor).toBeUndefined()
    expect(new Set([...result.entries, ...rest.entries].map((entry) => entry.path)).size).toBe(2001)
    const { project, repositories } = await ws.addProjectFromFolder(root)
    const repo = repositories[0]!
    const dispatcher = createDispatcher({ userData: join(tmp, 'profile'), send() {}, native: async () => {} }, {
      workspace: ws,
    } as Services)
    try {
      const first = (await dispatcher.invoke('files.browse', [`project:${project.id}`, repo.id, ''])) as Awaited<
        ReturnType<typeof browseDirectory>
      >
      expect(first.entries).toHaveLength(2000)
      const second = (await dispatcher.invoke('files.browse', [
        `project:${project.id}`,
        repo.id,
        '',
        first.nextCursor,
      ])) as Awaited<ReturnType<typeof browseDirectory>>
      expect(second.entries).toEqual(rest.entries)
      expect(() =>
        dispatcher.invoke('files.browse', [`project:${project.id}`, repo.id, '', 'x'.repeat(8193)]),
      ).toThrow()
    } finally {
      dispatcher.close()
    }
    await expect(browseDirectory(realpathSync(root), '', 'bad-cursor')).rejects.toThrow('continuation')
    await expect(browseDirectory(realpathSync(web), '', result.nextCursor)).rejects.toThrow('continuation')
    writeFileSync(join(root, 'new-file.txt'), '')
    await expect(browseDirectory(realpathSync(root), '', result.nextCursor)).rejects.toThrow('Directory changed')
  })
  it('paginates directories before files with deterministic ordering and no symlink traversal', async () => {
    const { browseDirectory } = await import('../src/workspace/files')
    const root = join(tmp, 'paged-folders')
    mkdirSync(root)
    for (let index = 2001; index >= 0; index--) mkdirSync(join(root, `folder-${String(index).padStart(4, '0')}`))
    mkdirSync(join(root, '.git'))
    writeFileSync(join(root, '000-file.txt'), '')
    symlinkSync(web, join(root, 'outside-link'))
    const first = await browseDirectory(realpathSync(root), '')
    const last = await browseDirectory(realpathSync(root), '', first.nextCursor)
    expect(first.entries[0]!.name).toBe('folder-0000')
    expect(first.entries.at(-1)!.name).toBe('folder-1999')
    expect(last.entries.map((entry) => [entry.name, entry.kind])).toEqual([
      ['folder-2000', 'dir'],
      ['folder-2001', 'dir'],
      ['000-file.txt', 'file'],
      ['outside-link', 'file'],
    ])
    expect(last.truncated).toBe(false)
    await expect(browseDirectory(realpathSync(root), 'outside-link')).rejects.toThrow('outside')
  })
})

describe('generated and explicit worktree branches', () => {
  it('keeps generated names independent from paths and suffixes only generated collisions', async () => {
    const project = ws.createProject('Naming')
    await ws.addRepository(project.id, web)
    const input = {
      projectId: project.id,
      title: 'Opening message',
      mode: 'worktree' as const,
      branchPrefix: 'ignored/',
    }
    const a = await ws.createTask({ ...input, branchChoice: { name: 'fix/login', source: 'generated' } })
    const b = await ws.createTask({ ...input, branchChoice: { name: 'fix/login', source: 'generated' } })
    expect(ws.listBindings(a.id)[0]).toMatchObject({
      taskBranch: 'fix/login',
      cwd: expect.stringContaining('opening-message'),
    })
    expect(ws.listBindings(b.id)[0]!.taskBranch).toBe('fix/login-2')
    await expect(ws.createTask({ ...input, branchChoice: { name: 'FIX/login', source: 'manual' } })).rejects.toThrow(
      /already taken/,
    )
    await expect(ws.createTask({ ...input, branchChoice: { name: '../unsafe', source: 'manual' } })).rejects.toThrow(
      /Invalid/,
    )
    const manual = await ws.createTask({ ...input, branchChoice: { name: 'team/exact', source: 'manual' } })
    expect(ws.listBindings(manual.id)[0]!.taskBranch).toBe('team/exact')
    expect((await ws.setupTask(manual.id))[0]!.setupState).toBe('ready')
  })
  it('coalesces inference across retries, keeps other allocations moving and persists fallback reporting', async () => {
    const project = ws.createProject('Naming')
    await ws.addRepository(project.id, web)
    let finish!: (value: { name: string; source: 'fallback' }) => void
    let calls = 0
    const prepare = () => {
      calls++
      return new Promise<{ name: string; source: 'fallback' }>((resolve) => {
        finish = resolve
      })
    }
    const input = { projectId: project.id, title: 'Generated', mode: 'worktree' as const, requestId: 'naming-retry' }
    const pending = ws.createTask(input, undefined, prepare)
    const duplicate = ws.createTask(input, undefined, prepare)
    expect((await ws.createTask({ projectId: project.id, title: 'Current', mode: 'current' })).mode).toBe('current')
    await expect(ws.createTask({ ...input, title: 'Other' }, undefined, prepare)).rejects.toThrow(/different inputs/)
    finish({ name: 'ramu/generated', source: 'fallback' })
    const task = await pending
    expect((await duplicate).id).toBe(task.id)
    expect((await ws.createTask(input, undefined, prepare)).id).toBe(task.id)
    expect(calls).toBe(1)
    expect(ws.getTask(task.id).branchNamingFallback).toBeTruthy()
    expect(ws.listTasks(project.id).find((t) => t.id === task.id)?.branchNamingFallback).toBeTruthy()
  })
})

describe('thread bindings for lists', () => {
  it('name the branch a current checkout has out, which a worktree names as its task branch instead', async () => {
    const { project } = await ws.addProjectFromFolder(api)
    const task = await ws.createTask({ projectId: project.id, title: 'Fix', mode: 'current' })
    const dispatcher = createDispatcher({ userData: join(tmp, 'profile'), send() {}, native: async () => {} }, {
      workspace: ws,
    } as Services)
    try {
      const [binding] = (await dispatcher.invoke('tasks.bindings', [task.id])) as Awaited<
        ReturnType<typeof ws.fileBindings>
      >
      expect(binding).toMatchObject({ mode: 'current', taskBranch: null, checkedOut: 'develop' })
      sh(api, 'checkout', '-q', '--detach')
      const [detached] = (await dispatcher.invoke('tasks.bindings', [task.id])) as Awaited<
        ReturnType<typeof ws.fileBindings>
      >
      expect(detached!.checkedOut).toBeNull()
    } finally {
      dispatcher.close()
    }
  })
})
