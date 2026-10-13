// Project / task / binding model. Every surface (editor, diff, terminal, agent)
// takes its working directory from a RepositoryBinding, never from the repo root.
import { randomUUID } from 'node:crypto'
import { cleanLabel } from '../shared/text'
import { existsSync, mkdirSync, realpathSync } from 'node:fs'
import { mkdir, readdir, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import type { Db } from './db'
import * as gitCli from './git'
import { NO_PROJECT } from '../shared/types'
import type {
  AgentScope,
  BindingSetupState,
  CheckoutMode,
  CreateTaskInput,
  FolderInspection,
  Project,
  Repository,
  RepositoryBinding,
  Task,
  TaskStatus,
  TaskUiState,
  WorktreePlanEntry,
  WorktreeWorkspace,
} from '../shared/types'

interface BindingRow {
  task_id: string
  repo_id: string
  repo_name: string
  mode: CheckoutMode
  cwd: string
  task_branch: string | null
  base_ref: string | null
  setup_state: BindingSetupState
  setup_error: string | null
}

const TASK_COLUMNS = `t.id, t.project_id AS projectId, t.title, t.mode, t.workspace_id AS workspaceId, t.status, t.created_at AS createdAt, t.pinned_at AS pinnedAt,
  COALESCE((SELECT MAX(COALESCE(json_extract(e.event, '$.at'), s.created_at))
    FROM agent_sessions s JOIN agent_events e ON e.session_id = s.id
    WHERE s.task_id = t.id AND s.parent_session_id IS NULL
      AND json_extract(e.event, '$.kind') = 'user'
      AND json_extract(e.event, '$.agentId') IS NULL), t.created_at) AS lastActiveAt`

export const PROJECT_PREFIX = 'project:'
export const WORKTREE_PREFIX = 'worktree:'
export const isWorktreeCtx = (ctx: string) => ctx.startsWith(WORKTREE_PREFIX)
export const isProjectCtx = (ctx: string) => ctx.startsWith(PROJECT_PREFIX)

const SKIP_DIRS = new Set(['node_modules', 'vendor', 'dist', 'build', 'target'])

function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'task'
  )
}

export class Workspace {
  constructor(
    private readonly db: Db,
    /** Directory under which task-owned worktrees are created. */
    private readonly worktreesRoot: string,
  ) {}

  // ---- Projects & repositories ----

  listProjects(): Project[] {
    return this.db
      .prepare("SELECT id, name, root, created_at AS createdAt FROM projects WHERE id != 'no-project' ORDER BY position IS NULL, position, created_at")
      .all() as unknown as Project[]
  }

  /** Saves a drag-and-drop order. Ids not listed keep their relative order after the listed ones. */
  reorderProjects(ids: string[]): Project[] {
    const known = new Set(this.listProjects().map((project) => project.id))
    const update = this.db.prepare('UPDATE projects SET position = ? WHERE id = ?')
    this.db.exec('BEGIN')
    try {
      ids.filter((id) => known.has(id)).forEach((id, index) => update.run(index, id))
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
    return this.listProjects()
  }

  createProject(name: string, root: string | null = null): Project {
    const project: Project = { id: randomUUID(), name: cleanLabel(name), root, createdAt: Date.now() }
    if (!project.name) throw new Error('Project name is required')
    this.db
      .prepare('INSERT INTO projects (id, name, root, created_at) VALUES (?, ?, ?, ?)')
      .run(project.id, project.name, project.root, project.createdAt)
    return project
  }

  /**
   * A Git repository becomes a single-repository project. A plain folder whose children are
   * Git repositories becomes a workspace project grouping them. Reads only; changes nothing.
   */
  async inspectFolder(dir: string): Promise<FolderInspection> {
    const root = await realpath(dir)
    const top = await gitCli.topLevel(root).then((p) => realpath(p), () => null)
    if (top) return { kind: 'repo', root: top, name: basename(top) }
    const repos: string[] = []
    for (const entry of await readdir(root, { withFileTypes: true, encoding: 'utf8' })) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
      const child = join(root, entry.name)
      // Only children that are repository roots themselves, not folders inside one.
      if (existsSync(join(child, '.git'))) repos.push(await realpath(child))
    }
    if (!repos.length) return { kind: 'none', root }
    return { kind: 'workspace', root, name: basename(root), repos: repos.sort() }
  }

  /** Creates a project from a folder: a workspace with its child repositories, or a single repository. */
  async addProjectFromFolder(dir: string): Promise<{ project: Project; repositories: Repository[] }> {
    const found = await this.inspectFolder(dir)
    if (found.kind === 'none') throw new Error(`No Git repositories in ${found.root} or its immediate subfolders`)
    const existing = this.listProjects().find((p) => p.root === found.root)
    if (existing) return { project: existing, repositories: this.listRepositories(existing.id) }
    const project = this.createProject(found.name, found.root)
    const paths = found.kind === 'repo' ? [found.root] : found.repos
    const repositories: Repository[] = []
    for (const p of paths) repositories.push(await this.addRepository(project.id, p))
    return { project, repositories }
  }

  /**
   * Where a task's agent runs. Worktree tasks use the task folder holding every worktree.
   * Current-checkout tasks use the project's workspace folder, or the first repository for a
   * single-repository project; repositories outside that folder are passed as extra directories.
   */
  agentScope(ctx: string): AgentScope {
    if (ctx === `${PROJECT_PREFIX}${NO_PROJECT}` || !isProjectCtx(ctx) && !isWorktreeCtx(ctx) && this.getTask(ctx).projectId === NO_PROJECT) {
      const cwd = join(this.worktreesRoot, '..', 'chats', isProjectCtx(ctx) ? 'general' : this.getTask(ctx).id)
      mkdirSync(cwd, { recursive: true })
      return { cwd: realpathSync(cwd), additionalDirs: [], covers: [realpathSync(cwd)] }
    }
    const bindings = this.listBindings(ctx)
    if (!bindings.length) throw new Error('This project has no repositories')
    const notReady = bindings.find((b) => b.setupState !== 'ready')
    if (notReady) throw new Error(`${notReady.repoName} worktree is not ready (${notReady.setupState})`)
    const covers = bindings.map((b) => b.cwd)
    let cwd: string
    if (bindings[0]!.mode === 'worktree') {
      const parents = new Set(covers.map((c) => dirname(c)))
      cwd = parents.size === 1 ? [...parents][0]! : covers[0]!
    } else {
      const root = this.getProject(this.projectIdOf(ctx)).root
      cwd = root && existsSync(root) ? root : covers[0]!
    }
    const additionalDirs = covers.filter((c) => !isWithin(cwd, c))
    return { cwd, additionalDirs, covers }
  }

  listRepositories(projectId: string): Repository[] {
    return this.db
      .prepare('SELECT id, project_id AS projectId, name, root FROM repositories WHERE project_id = ? ORDER BY name')
      .all(projectId) as unknown as Repository[]
  }

  getRepository(id: string): Repository {
    const repo = this.db
      .prepare('SELECT id, project_id AS projectId, name, root FROM repositories WHERE id = ?')
      .get(id) as unknown as Repository | undefined
    if (!repo) throw new Error(`Unknown repository ${id}`)
    return repo
  }

  /** Registers an existing repository. Reads Git metadata only; never mutates the checkout. */
  async addRepository(projectId: string, dir: string): Promise<Repository> {
    this.getProject(projectId)
    const root = await realpath(await gitCli.topLevel(await realpath(dir)))
    const existing = this.listRepositories(projectId)
    const dup = existing.find((r) => r.root === root)
    if (dup) return dup
    let name = basename(root)
    const names = new Set(existing.map((r) => r.name))
    for (let n = 2; names.has(name); n++) name = `${basename(root)}-${n}`
    const repo: Repository = { id: randomUUID(), projectId, name, root }
    this.db.prepare('INSERT INTO repositories (id, project_id, name, root) VALUES (?, ?, ?, ?)').run(repo.id, projectId, name, root)
    return repo
  }

  private getProject(id: string): Project {
    const p = this.db.prepare('SELECT id, name, root, created_at AS createdAt FROM projects WHERE id = ?').get(id) as unknown as
      | Project
      | undefined
    if (!p) throw new Error(`Unknown project ${id}`)
    return p
  }

  listWorkspaces(projectId?: string): WorktreeWorkspace[] {
    return this.db.prepare(`SELECT id, project_id AS projectId, name, created_at AS createdAt FROM workspaces ${projectId ? 'WHERE project_id = ?' : ''} ORDER BY created_at DESC`).all(...(projectId ? [projectId] : [])) as unknown as WorktreeWorkspace[]
  }

  getWorktreeWorkspace(id: string): WorktreeWorkspace {
    const workspace = this.listWorkspaces().find((w) => w.id === id)
    if (!workspace) throw new Error('Unknown isolated workspace')
    return workspace
  }

  workspaceIdOf(ctx: string): string | null {
    return isWorktreeCtx(ctx) ? this.getWorktreeWorkspace(ctx.slice(WORKTREE_PREFIX.length)).id : isProjectCtx(ctx) ? null : this.getTask(ctx).workspaceId
  }

  // ---- Chats ----

  listTasks(projectId?: string): Task[] {
    const sql = `SELECT ${TASK_COLUMNS} FROM tasks t ${projectId ? 'WHERE project_id = ?' : ''} ORDER BY created_at`
    const stmt = this.db.prepare(sql)
    return (projectId ? stmt.all(projectId) : stmt.all()) as unknown as Task[]
  }

  getTask(id: string): Task {
    const t = this.db
      .prepare(`SELECT ${TASK_COLUMNS} FROM tasks t WHERE id = ?`)
      .get(id) as unknown as Task | undefined
    if (!t) throw new Error(`Unknown chat ${id}`)
    return t
  }

  setTaskStatus(id: string, status: TaskStatus): void {
    this.db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, id)
  }

  renameTask(id: string, title: string): Task {
    const t = cleanLabel(title)
    if (!t) throw new Error('Chat title is required')
    this.getTask(id)
    this.db.prepare("UPDATE tasks SET title = ?, title_source = 'manual' WHERE id = ?").run(t, id)
    return this.getTask(id)
  }

  /** An AI-written title. Unless forced (an explicit "Rename with AI"), a title the user typed is left alone. */
  setGeneratedTitle(id: string, title: string, force = false): Task {
    this.getTask(id)
    this.db.prepare("UPDATE tasks SET title = ?, title_source = 'ai' WHERE id = ? AND (title_source != 'manual' OR ?)").run(cleanLabel(title) || 'New chat', id, force ? 1 : 0)
    return this.getTask(id)
  }

  titleSource(id: string): 'prompt' | 'ai' | 'manual' {
    return (this.db.prepare('SELECT title_source AS source FROM tasks WHERE id = ?').get(id) as { source: 'prompt' | 'ai' | 'manual' } | undefined)?.source ?? 'prompt'
  }

  setPinned(id: string, pinned: boolean): Task {
    this.getTask(id)
    this.db.prepare('UPDATE tasks SET pinned_at = ? WHERE id = ?').run(pinned ? Date.now() : null, id)
    return this.getTask(id)
  }

  /** Archiving hides a task; files, branches and worktrees stay exactly as they are. */
  setArchived(id: string, archived: boolean): Task {
    this.setTaskStatus(id, archived ? 'archived' : 'idle')
    return this.getTask(id)
  }

  /**
   * Deletes the task's record and transcripts. Repositories are never touched. With
   * removeWorktrees, task-owned worktrees are removed first, and only if they have no
   * uncommitted changes; their branches are kept. Callers stop agents and terminals first.
   */
  async deleteTask(id: string, removeWorktrees: boolean): Promise<void> {
    const chat = this.getTask(id)
    const workspaceId = chat.workspaceId
    const shared = workspaceId ? (this.db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE workspace_id = ? AND id != ?').get(workspaceId, id) as { n: number }).n : 0
    if (removeWorktrees && shared) throw new Error('This isolated workspace is used by other chats. Delete only this chat or remove the other chats first.')
    if (removeWorktrees) {
      const owned = this.listBindings(id).filter((b) => b.mode === 'worktree' && b.setupState === 'ready' && existsSync(b.cwd))
      const dirty: string[] = []
      for (const b of owned) if ((await gitCli.status(b.cwd)).entries.length) dirty.push(b.repoName)
      if (dirty.length) {
        throw new Error(`Not deleted: ${dirty.join(', ')} ${dirty.length > 1 ? 'have' : 'has'} uncommitted changes in the worktree. Commit or discard them first.`)
      }
      for (const b of owned) await gitCli.worktreeRemove(this.getRepository(b.repoId).root, b.cwd)
    }
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM agent_events WHERE session_id IN (SELECT id FROM agent_sessions WHERE task_id = ?)').run(id)
      this.db.prepare('DELETE FROM agent_sessions WHERE task_id = ?').run(id)
      this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
      if (removeWorktrees && workspaceId) {
        this.db.prepare('DELETE FROM bindings WHERE task_id = ?').run(workspaceId)
        this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId)
        this.db.prepare('DELETE FROM app_state WHERE key = ?').run(`ui:worktree:${workspaceId}`)
      }
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  renameProject(id: string, name: string): Project {
    const n = cleanLabel(name)
    if (!n) throw new Error('Project name is required')
    this.getProject(id)
    this.db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(n, id)
    return this.getProject(id)
  }

  /** Removes the project from Ramu only. Folders on disk are untouched. */
  removeProject(id: string): void {
    this.getProject(id)
    const tasks = this.listTasks(id)
    if (tasks.length) throw new Error(`Delete this project's ${tasks.length} chat${tasks.length > 1 ? 's' : ''} first.`)
    this.db.exec('BEGIN')
    try {
      this.db.prepare('DELETE FROM bindings WHERE task_id IN (SELECT id FROM workspaces WHERE project_id = ?)').run(id)
      this.db.prepare('DELETE FROM workspaces WHERE project_id = ?').run(id)
      this.db.prepare('DELETE FROM repositories WHERE project_id = ?').run(id)
      this.db.prepare('DELETE FROM projects WHERE id = ?').run(id)
      this.db.prepare('DELETE FROM app_state WHERE key = ?').run(`ui:${PROJECT_PREFIX}${id}`)
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  /** Disconnects a repository from the project; refused while a worktree task has a copy of it. */
  removeRepository(id: string): void {
    const used = this.db.prepare("SELECT COUNT(*) AS n FROM bindings WHERE repo_id = ? AND mode = 'worktree'").get(id) as { n: number }
    if (used.n) throw new Error('An isolated workspace still uses this repository. Remove its worktrees first.')
    this.db.prepare("DELETE FROM bindings WHERE repo_id = ? AND mode = 'current'").run(id)
    this.db.prepare('DELETE FROM repositories WHERE id = ?').run(id)
  }

  /** Worktree paths and branch names that createTask would use, shown to the user before creation. */
  async planWorktrees(projectId: string, title: string, repoIds: string[]): Promise<WorktreePlanEntry[]> {
    const project = this.getProject(projectId)
    const slug = slugify(title)
    const taskDir = this.uniqueDir(join(this.worktreesRoot, slugify(project.name), slug))
    const suffix = basename(taskDir).slice(slug.length) // "" or "-2", "-3"...
    const plan: WorktreePlanEntry[] = []
    for (const repoId of repoIds) {
      const repo = this.getRepository(repoId)
      if (repo.projectId !== projectId) throw new Error(`Repository ${repo.name} is not in this project`)
      const baseRef = (await gitCli.currentBranch(repo.root)) ?? (await gitCli.headOid(repo.root))
      if (!baseRef) throw new Error(`${repo.name} has no commits to branch from`)
      let taskBranch = `ramu/${slug}${suffix}`
      for (let n = 2; await gitCli.branchExists(repo.root, taskBranch); n++) taskBranch = `ramu/${slug}${suffix}-${n}`
      plan.push({ repoId, repoName: repo.name, baseRef, taskBranch, path: join(taskDir, repo.name) })
    }
    return plan
  }

  private uniqueDir(base: string): string {
    let dir = base
    for (let n = 2; existsSync(dir); n++) dir = `${base}-${n}`
    return dir
  }

  /**
   * Creates the task and its bindings. Current-checkout bindings are ready immediately and
   * touch nothing in Git. Worktree bindings are recorded as pending; call setupTask to create them.
   */
  async createTask(input: CreateTaskInput, plan?: WorktreePlanEntry[]): Promise<Task> {
    const title = cleanLabel(input.title)
    if (!title) throw new Error('Chat title is required')
    // Repositories belong to the project: a task always covers all of them.
    const repos = this.listRepositories(input.projectId)
    if (!repos.length && input.projectId !== NO_PROJECT) throw new Error('This project has no repositories')
    if (input.projectId === NO_PROJECT && (input.mode !== 'current' || input.workspaceId)) throw new Error('Project-free chats cannot use worktrees')

    if (input.workspaceId) {
      const existing = this.getWorktreeWorkspace(input.workspaceId)
      if (input.mode !== 'worktree' || existing.projectId !== input.projectId) throw new Error('Isolated workspace is not in this project')
      const bindings = this.listBindings(`worktree:${existing.id}`)
      if (!bindings.length || bindings.some((b) => b.setupState !== 'ready' || !existsSync(b.cwd))) throw new Error('This isolated workspace is not ready')
      for (const b of bindings) if (!await this.registeredWorktree(this.getRepository(b.repoId).root, b.cwd)) throw new Error(`${b.repoName} is no longer a registered worktree`)
      if (plan) throw new Error('An existing workspace does not need a worktree plan')
    }
    if (input.mode === 'worktree' && !input.workspaceId) {
      plan ??= await this.planWorktrees(input.projectId, title, repos.map((r) => r.id))
      if (plan.length !== repos.length || !repos.every((r) => plan!.some((p) => p.repoId === r.id))) {
        throw new Error('Worktree plan does not match the selected repositories')
      }
    }

    const task: Task = {
      id: randomUUID(),
      projectId: input.projectId,
      title,
      mode: input.mode,
      workspaceId: input.mode === 'worktree' ? input.workspaceId ?? randomUUID() : null,
      status: 'idle',
      createdAt: Date.now(),
      pinnedAt: null,
      lastActiveAt: Date.now(),
    }
    const insertBinding = this.db.prepare(
      `INSERT INTO bindings (task_id, repo_id, mode, cwd, task_branch, base_ref, setup_state, setup_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    this.db.exec('BEGIN')
    try {
      if (input.mode === 'worktree' && !input.workspaceId) this.db.prepare('INSERT INTO workspaces (id, project_id, name, created_at) VALUES (?, ?, ?, ?)').run(task.workspaceId!, task.projectId, title, task.createdAt)
      this.db
        .prepare('INSERT INTO tasks (id, project_id, title, mode, status, created_at, workspace_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(task.id, task.projectId, task.title, task.mode, task.status, task.createdAt, task.workspaceId)
      // Current-checkout tasks store no bindings; they follow the project's repositories live.
      if (input.mode === 'worktree' && !input.workspaceId) {
        for (const repo of repos) {
          const p = plan!.find((e) => e.repoId === repo.id)!
          insertBinding.run(task.workspaceId!, repo.id, 'worktree', p.path, p.taskBranch, p.baseRef, 'pending')
        }
      }
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
    return task
  }

  /** Creates pending worktrees. Safe to call again after a partial failure: only unfinished bindings run. */
  async setupTask(taskId: string): Promise<RepositoryBinding[]> {
    for (const b of this.listBindings(taskId)) {
      if (b.mode !== 'worktree' || b.setupState === 'ready') continue
      const repo = this.getRepository(b.repoId)
      try {
        const registered = await this.registeredWorktree(repo.root, b.cwd)
        if (!registered) {
          await mkdir(join(b.cwd, '..'), { recursive: true })
          if (await gitCli.branchExists(repo.root, b.taskBranch!)) {
            // A previous attempt created the branch but not the worktree.
            await gitCli.worktreeAddExistingBranch(repo.root, b.cwd, b.taskBranch!)
          } else {
            await gitCli.worktreeAdd(repo.root, b.cwd, b.taskBranch!, b.baseRef!)
          }
        }
        const cwd = await realpath(b.cwd)
        this.db
          .prepare("UPDATE bindings SET cwd = ?, setup_state = 'ready', setup_error = NULL WHERE task_id = ? AND repo_id = ?")
          .run(cwd, this.workspaceIdOf(taskId)!, b.repoId)
      } catch (err) {
        this.db
          .prepare("UPDATE bindings SET setup_state = 'failed', setup_error = ? WHERE task_id = ? AND repo_id = ?")
          .run(err instanceof Error ? err.message : String(err), this.workspaceIdOf(taskId)!, b.repoId)
      }
    }
    return this.listBindings(taskId)
  }

  private async registeredWorktree(repoRoot: string, path: string): Promise<boolean> {
    if (!existsSync(path)) return false
    const target = realpathSync(path)
    const paths = await gitCli.worktreePaths(repoRoot)
    return paths.some((p) => existsSync(p) && realpathSync(p) === target)
  }

  /** The project a context belongs to; a context is a task id or "project:<id>" (the workspace view). */
  projectIdOf(ctx: string): string {
    if (isWorktreeCtx(ctx)) return this.getWorktreeWorkspace(ctx.slice(WORKTREE_PREFIX.length)).projectId
    return isProjectCtx(ctx) ? this.getProject(ctx.slice(PROJECT_PREFIX.length)).id : this.getTask(ctx).projectId
  }

  /**
   * Working directories for a context. The workspace view and current-checkout tasks use the
   * project's repositories live; worktree tasks use their own worktrees.
   */
  listBindings(ctx: string): RepositoryBinding[] {
    const workspaceId = this.workspaceIdOf(ctx)
    if (!workspaceId) {
      return this.listRepositories(this.projectIdOf(ctx)).map((r) => ({
        taskId: ctx,
        repoId: r.id,
        repoName: r.name,
        mode: 'current',
        cwd: r.root,
        taskBranch: null,
        baseRef: null,
        setupState: 'ready',
        setupError: null,
      }))
    }
    const rows = this.db
      .prepare(
        `SELECT b.*, r.name AS repo_name FROM bindings b JOIN repositories r ON r.id = b.repo_id
         WHERE b.task_id = ? ORDER BY r.name`,
      )
      .all(workspaceId) as unknown as BindingRow[]
    return rows.map((row) => ({ ...toBinding(row), taskId: ctx }))
  }

  /** File surfaces also expose each project-free chat's existing working folder. */
  fileBindings(ctx: string): RepositoryBinding[] {
    if (this.projectIdOf(ctx) !== NO_PROJECT) return this.listBindings(ctx)
    return [{ taskId: ctx, repoId: 'general', repoName: 'Chat files', folderOnly: true,
      cwd: this.agentScope(ctx).cwd, mode: 'current', taskBranch: null, baseRef: null,
      setupState: 'ready', setupError: null }]
  }

  /** The binding for (context, repo), which must be ready before any surface may use it. */
  getBinding(ctx: string, repoId: string): RepositoryBinding {
    const binding = this.fileBindings(ctx).find((b) => b.repoId === repoId)
    if (!binding) throw new Error('Repository is not part of this project')
    if (binding.setupState !== 'ready') throw new Error(`${binding.repoName} worktree is not ready (${binding.setupState})`)
    return binding
  }

  // ---- UI state ----

  getTaskUi(ctx: string): TaskUiState {
    if (isProjectCtx(ctx) || isWorktreeCtx(ctx)) return this.getAppState<TaskUiState>(`ui:${ctx}`, { views: [], activeViewId: null })
    const row = this.db.prepare('SELECT ui_state FROM tasks WHERE id = ?').get(ctx) as { ui_state: string | null } | undefined
    if (!row) throw new Error(`Unknown chat ${ctx}`)
    return row.ui_state ? (JSON.parse(row.ui_state) as TaskUiState) : { views: [], activeViewId: null }
  }

  setTaskUi(ctx: string, ui: TaskUiState): void {
    if (isProjectCtx(ctx) || isWorktreeCtx(ctx)) return this.setAppState(`ui:${ctx}`, ui)
    this.db.prepare('UPDATE tasks SET ui_state = ? WHERE id = ?').run(JSON.stringify(ui), ctx)
  }

  getAppState<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM app_state WHERE key = ?').get(key) as { value: string } | undefined
    return row ? (JSON.parse(row.value) as T) : fallback
  }

  setAppState(key: string, value: unknown): void {
    this.db
      .prepare('INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value))
  }
}

function toBinding(r: BindingRow): RepositoryBinding {
  return {
    taskId: r.task_id,
    repoId: r.repo_id,
    repoName: r.repo_name,
    mode: r.mode,
    cwd: r.cwd,
    taskBranch: r.task_branch,
    baseRef: r.base_ref,
    setupState: r.setup_state,
    setupError: r.setup_error,
  }
}
