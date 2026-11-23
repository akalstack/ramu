// Project / task / binding model. Every surface (editor, diff, terminal, agent)
// takes its working directory from a RepositoryBinding, never from the repo root.
import { branchForTitle, validBranchName, type BranchChoice } from '@ramu/shared/workspaceDefaults'
import { KeyedLock } from '../ipc/keyedLock'
import { randomUUID } from 'node:crypto'
import { cleanLabel } from '@ramu/shared/text'
import { existsSync, mkdirSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { mkdir, readdir, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { homedir } from 'node:os'
import type { Db } from '../db'
import type { SettingsStore } from '../settings/settingsStore'
import { loadProjectConfig } from './projectConfig'
import * as gitCli from './git'
import { NO_PROJECT } from '@ramu/shared/types'
import { isSystemFolder } from '@ramu/shared/workspace/hostFolders'
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
  ThreadOrigin,
  WorktreePlanEntry,
  WorktreeWorkspace,
} from '@ramu/shared/types'

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

const TASK_COLUMNS = `t.id, t.project_id AS projectId, t.title, t.title_generation_state AS titleGenerationState, t.title_source AS titleSource, t.mode, t.workspace_id AS workspaceId, t.status, t.created_at AS createdAt, t.pinned_at AS pinnedAt, t.done_at AS doneAt,
  COALESCE((SELECT MAX(COALESCE(json_extract(e.event, '$.at'), s.created_at))
    FROM agent_sessions s JOIN agent_events e ON e.session_id = s.id
    WHERE s.task_id = t.id AND s.parent_session_id IS NULL
      AND json_extract(e.event, '$.kind') = 'user'
      AND json_extract(e.event, '$.agentId') IS NULL), t.created_at) AS lastActiveAt,
  (SELECT MIN(w.retryAt) FROM (SELECT (SELECT json_extract(e.event, '$.retryAt') FROM agent_events e
      WHERE e.session_id = s.id AND json_extract(e.event, '$.kind') = 'provider-wait' ORDER BY e.seq DESC LIMIT 1) AS retryAt
    FROM agent_sessions s WHERE s.task_id = t.id AND s.parent_session_id IS NULL) w) AS waitingUntil,
  (SELECT json_extract(value, '$') FROM app_state WHERE key = 'branch-fallback:' || t.id) AS branchNamingFallback,
  (SELECT 'library-review' FROM library_summary_chats c WHERE c.task_id = t.id) AS kind,
  (SELECT r.schedule_id FROM schedule_runs r WHERE r.task_id = t.id LIMIT 1) AS scheduleId,
  (SELECT json_object('groupId', l.group_id, 'taskId', l.source_task_id, 'title', COALESCE(st.title, l.source_title),
      'host', l.source_host)
    FROM thread_links l LEFT JOIN tasks st ON st.id = l.source_task_id WHERE l.target_task_id = t.id) AS startedFrom`

/** SQLite returns the origin as JSON text; a thread nobody else started has none, and a local origin names no host. */
function taskOf(row: Task & { startedFrom?: unknown }): Task {
  const { startedFrom, ...task } = row
  if (typeof startedFrom !== 'string') return task
  const { host, ...origin } = JSON.parse(startedFrom) as ThreadOrigin
  return { ...task, startedFrom: host ? { ...origin, host } : origin }
}

export const PROJECT_PREFIX = 'project:'
export const WORKTREE_PREFIX = 'worktree:'
export const isWorktreeCtx = (ctx: string) => ctx.startsWith(WORKTREE_PREFIX)
export const isProjectCtx = (ctx: string) => ctx.startsWith(PROJECT_PREFIX)

const PROJECT_PARENT = 'project-parent'
const USUAL_PROJECT_FOLDERS = ['Projects', 'Developer', 'Code', 'code', 'src', 'dev', 'repos', 'workspace'] as const
const isDirectory = (path: string) => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
const SKIP_DIRS = new Set(['node_modules', 'vendor', 'dist', 'build', 'target'])

function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
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

type ProjectRow = Omit<Project, 'aliases' | 'description'> & { aliases: string; description: string }

/** Aliases are stored as JSON; empty routing fields are left out. */
function projectOf(row: ProjectRow): Project {
  let aliases: string[] = []
  try {
    const parsed: unknown = JSON.parse(row.aliases)
    if (Array.isArray(parsed)) aliases = parsed.filter((alias): alias is string => typeof alias === 'string')
  } catch {
    // A damaged value only loses routing hints; the project itself is untouched.
  }
  const { aliases: _a, description, ...project } = row
  return { ...project, ...(aliases.length ? { aliases } : {}), ...(description ? { description } : {}) }
}

export class Workspace {
  settingsStore?: SettingsStore
  /** Told about each repository a project gains, so threads already working in its folder reach it too. */
  repositoryAdded?: (repo: Repository) => void
  private readonly allocation = new KeyedLock()
  constructor(
    private readonly db: Db,
    /** Directory under which task-owned worktrees are created. */
    private readonly worktreesRoot: string,
  ) {}

  // ---- Projects & repositories ----

  projectConfiguration(projectId: string) {
    return loadProjectConfig(this.getProject(projectId).root)
  }

  listProjects(): Project[] {
    return this.db
      .prepare(
        "SELECT id, name, root, created_at AS createdAt, aliases, description FROM projects WHERE id != 'no-project' ORDER BY position IS NULL, position, created_at",
      )
      .all()
      .map((row) => projectOf(row as unknown as ProjectRow))
  }

  /** Saves a drag-and-drop order. Ids not listed keep their relative order after the listed ones. */
  reorderProjects(ids: string[]): Project[] {
    const known = new Set(this.listProjects().map((project) => project.id))
    const update = this.db.prepare('UPDATE projects SET position = ? WHERE id = ?')
    this.db.exec('BEGIN')
    try {
      ids.filter((id) => known.has(id)).forEach((id, index) => update.run(index, id))
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
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
   * Where a new or cloned project goes: the folder the person last chose on this host, else the folder holding most of
   * their repositories, else a usual projects folder that exists, else `~/Projects`. Never the home folder itself.
   * `create` makes `~/Projects` when that is the answer, for a caller about to put a project there.
   */
  newProjectParent(create = false): string {
    const chosen = this.chosenProjectParent()
    if (chosen) return chosen
    const home = homedir()
    const counts = new Map<string, number>()
    for (const project of this.listProjects())
      for (const entry of this.listRepositories(project.id)) {
        const parent = dirname(entry.root)
        if (parent !== home && parent.startsWith(home + sep)) counts.set(parent, (counts.get(parent) ?? 0) + 1)
      }
    const busiest = [...counts].sort((a, b) => b[1] - a[1])[0]
    if (busiest) return busiest[0]
    for (const name of USUAL_PROJECT_FOLDERS) {
      const folder = join(home, name)
      if (isDirectory(folder)) return folder
    }
    const fallback = join(home, USUAL_PROJECT_FOLDERS[0])
    if (create) mkdirSync(fallback, { recursive: true })
    return fallback
  }

  /** The folder the person last put a new project in, while it still exists; shared by every device and the agents. */
  chosenProjectParent(): string | null {
    const saved = this.getAppState<string | null>(PROJECT_PARENT, null)
    return saved && isDirectory(saved) ? saved : null
  }

  rememberProjectParent(folder: string): void {
    this.setAppState(PROJECT_PARENT, folder)
  }

  /**
   * A No project thread joins a project at its current checkout. Current-checkout threads keep no bindings of their
   * own, so changing the project is the whole move; the caller moves the agent's session.
   */
  moveTaskToProject(taskId: string, projectId: string): Task {
    const task = this.getTask(taskId)
    if (task.projectId !== NO_PROJECT) throw new Error('Only a thread with no project can move into a project.')
    this.getProject(projectId)
    if (!this.listRepositories(projectId).length) throw new Error('This project has no repositories')
    this.db.prepare('UPDATE tasks SET project_id = ? WHERE id = ?').run(projectId, taskId)
    return this.getTask(taskId)
  }

  /**
   * A Git repository becomes a single-repository project. A plain folder whose children are
   * Git repositories becomes a workspace project grouping them. Reads only; changes nothing.
   */
  async inspectFolder(dir: string): Promise<FolderInspection> {
    const root = await realpath(dir)
    const top = await gitCli.topLevel(root).then(
      (p) => realpath(p),
      () => null,
    )
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

  /** Creates a project from a folder: a workspace with its child repositories (all, or only `repos`), or a single repository. */
  async addProjectFromFolder(dir: string, repos?: string[]): Promise<{ project: Project; repositories: Repository[] }> {
    const found = await this.inspectFolder(dir)
    // An agent given a filesystem root or a system folder as its project would work across the whole computer.
    if (isSystemFolder(found.root, process.platform))
      throw new Error(`${found.root} is a system folder. Choose a project folder inside it instead.`)
    const chosen = found.kind === 'workspace' && repos ? found.repos.filter((repo) => repos.includes(repo)) : null
    if (chosen && !chosen.length) throw new Error('Choose at least one repository.')
    const existing = this.listProjects().find((p) => p.root === found.root)
    if (existing) return { project: existing, repositories: this.listRepositories(existing.id) }
    // Not a Git repository: the folder itself becomes the project, and Source Control offers to initialize it.
    const project = this.createProject(found.kind === 'none' ? basename(found.root) : found.name, found.root)
    if (found.kind === 'none') return { project, repositories: [this.addFolderRepository(project.id, found.root)] }
    const paths = found.kind === 'repo' ? [found.root] : (chosen ?? found.repos)
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
    if (
      ctx === `${PROJECT_PREFIX}${NO_PROJECT}` ||
      (!isProjectCtx(ctx) && !isWorktreeCtx(ctx) && this.getTask(ctx).projectId === NO_PROJECT)
    ) {
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
    this.db
      .prepare('INSERT INTO repositories (id, project_id, name, root) VALUES (?, ?, ?, ?)')
      .run(repo.id, projectId, name, root)
    this.repositoryAdded?.(repo)
    return repo
  }

  /**
   * Git repositories directly inside a project's folder that are not among its repositories yet. Only a folder that
   * is not itself a repository groups repositories this way; clones inside a repository are its own business.
   */
  unregisteredChildRepositories(projectId: string): string[] {
    const project = this.getProject(projectId)
    if (!project.root || !existsSync(project.root) || existsSync(join(project.root, '.git'))) return []
    const known = new Set(this.listRepositories(projectId).map((repo) => repo.root))
    const found: string[] = []
    try {
      for (const entry of readdirSync(project.root, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
        const child = join(project.root, entry.name)
        if (!existsSync(join(child, '.git'))) continue
        const root = realpathSync(child)
        if (!known.has(root)) found.push(root)
      }
    } catch {
      return []
    }
    return found.sort()
  }

  /** The project whose own folder (not a repository) directly holds `dir`, which a clone there belongs to. */
  projectHolding(dir: string): Project | undefined {
    let parent: string
    try {
      parent = realpathSync(dirname(dir))
    } catch {
      return undefined
    }
    return this.listProjects().find(
      (project) => project.root === parent && !existsSync(join(parent, '.git')) && project.id !== NO_PROJECT,
    )
  }

  /** Registers a plain folder as the project's only repository entry; it works as files and terminals until initialized. */
  private addFolderRepository(projectId: string, root: string): Repository {
    const repo: Repository = { id: randomUUID(), projectId, name: basename(root), root }
    this.db
      .prepare('INSERT INTO repositories (id, project_id, name, root) VALUES (?, ?, ?, ?)')
      .run(repo.id, projectId, repo.name, root)
    return repo
  }

  private getProject(id: string): Project {
    const p = this.db
      .prepare('SELECT id, name, root, created_at AS createdAt, aliases, description FROM projects WHERE id = ?')
      .get(id) as unknown as ProjectRow | undefined
    if (!p) throw new Error(`Unknown project ${id}`)
    return projectOf(p)
  }

  listWorkspaces(projectId?: string): WorktreeWorkspace[] {
    return this.db
      .prepare(
        `SELECT id, project_id AS projectId, name, created_at AS createdAt FROM workspaces ${projectId ? 'WHERE project_id = ?' : ''} ORDER BY created_at DESC`,
      )
      .all(...(projectId ? [projectId] : [])) as unknown as WorktreeWorkspace[]
  }

  getWorktreeWorkspace(id: string): WorktreeWorkspace {
    const workspace = this.listWorkspaces().find((w) => w.id === id)
    if (!workspace) throw new Error('Unknown isolated workspace')
    return workspace
  }

  /** A shared display label only; thread titles, refs, bindings and paths retain their identities. */
  renameWorktreeWorkspace(id: string, name: string, before: string): WorktreeWorkspace {
    const label = cleanLabel(name)
    if (!label || label.length > 200) throw new Error('Workspace name must be between 1 and 200 characters')
    const workspace = this.getWorktreeWorkspace(id)
    if (workspace.name === label) return workspace
    const updated = this.db.prepare('UPDATE workspaces SET name = ? WHERE id = ? AND name = ?').run(label, id, before)
    if (!updated.changes) throw new Error('Workspace name changed elsewhere. Reopen the name editor to review it.')
    return { ...workspace, name: label }
  }

  workspaceIdOf(ctx: string): string | null {
    return isWorktreeCtx(ctx)
      ? this.getWorktreeWorkspace(ctx.slice(WORKTREE_PREFIX.length)).id
      : isProjectCtx(ctx)
        ? null
        : this.getTask(ctx).workspaceId
  }

  // ---- Chats ----

  listTasks(projectId?: string): Task[] {
    const sql = `SELECT ${TASK_COLUMNS} FROM tasks t ${projectId ? 'WHERE project_id = ?' : ''} ORDER BY created_at`
    const stmt = this.db.prepare(sql)
    return ((projectId ? stmt.all(projectId) : stmt.all()) as unknown as Task[]).map(taskOf)
  }

  /**
   * Where each thread's work lands, for thread lists: a worktree thread's own branch, or the branch its project's
   * checkout has out. Several repositories go by the first in name order, as bindings do. Threads without a branch
   * (no project, a plain folder, a worktree still being set up) are absent.
   */
  async threadBranches(tasks: Task[]): Promise<Map<string, string>> {
    const worktreeBranches = new Map<string, string>()
    const rows = this.db
      .prepare(
        `SELECT b.task_id AS workspaceId, b.task_branch AS branch FROM bindings b
         JOIN repositories r ON r.id = b.repo_id WHERE b.task_branch IS NOT NULL ORDER BY r.name`,
      )
      .all() as unknown as { workspaceId: string; branch: string }[]
    for (const row of rows)
      if (!worktreeBranches.has(row.workspaceId)) worktreeBranches.set(row.workspaceId, row.branch)
    const projectIds = [
      ...new Set(
        tasks.filter((task) => task.mode === 'current' && task.projectId !== NO_PROJECT).map((task) => task.projectId),
      ),
    ]
    const checkedOut = new Map(
      await Promise.all(
        projectIds.map(async (projectId) => {
          const first = this.listRepositories(projectId)[0]
          return [projectId, first ? await gitCli.checkedOutBranch(first.root) : null] as const
        }),
      ),
    )
    const branches = new Map<string, string>()
    for (const task of tasks) {
      const branch = task.workspaceId ? worktreeBranches.get(task.workspaceId) : checkedOut.get(task.projectId)
      if (branch) branches.set(task.id, branch)
    }
    return branches
  }

  getTask(id: string): Task {
    const t = this.db.prepare(`SELECT ${TASK_COLUMNS} FROM tasks t WHERE id = ?`).get(id) as unknown as Task | undefined
    if (!t) throw new Error(`Unknown thread ${id}`)
    return taskOf(t)
  }

  setTaskStatus(id: string, status: TaskStatus): void {
    this.db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, id)
  }

  renameTask(id: string, title: string): Task {
    const t = cleanLabel(title)
    if (!t) throw new Error('Thread title is required')
    this.getTask(id)
    this.db
      .prepare(
        "UPDATE tasks SET title = ?, title_source = 'manual', title_revision = title_revision + 1, title_generation_state = 'idle', title_needs_refinement = 0 WHERE id = ?",
      )
      .run(t, id)
    this.db.prepare('DELETE FROM task_title_jobs WHERE task_id = ?').run(id)
    this.db.prepare('DELETE FROM task_title_waits WHERE task_id = ?').run(id)
    return this.getTask(id)
  }

  /** Apply only to the captured revision; deliberate edits and newer requests always win. */
  setGeneratedTitle(
    id: string,
    title: string,
    force = false,
    revision?: number,
    needsRefinement = false,
    source: 'ai' | 'provider' = 'ai',
  ): Task {
    this.getTask(id)
    const cleaned = cleanLabel(title)
    if (!cleaned) return this.getTask(id)
    this.db
      .prepare(
        `UPDATE tasks SET title = ?, title_source = ?, title_revision = title_revision + 1,
        title_generation_state = 'complete', title_needs_refinement = ?
        WHERE id = ? AND (title_source != 'manual' OR ?) AND (? IS NULL OR title_revision = ?)`,
      )
      .run(cleaned, source, needsRefinement ? 1 : 0, id, force ? 1 : 0, revision ?? null, revision ?? null)
    this.db
      .prepare(
        'DELETE FROM task_title_jobs WHERE task_id = ? AND revision < (SELECT title_revision FROM tasks WHERE id = ?)',
      )
      .run(id, id)
    this.db
      .prepare(
        'DELETE FROM task_title_waits WHERE task_id = ? AND revision < (SELECT title_revision FROM tasks WHERE id = ?)',
      )
      .run(id, id)
    return this.getTask(id)
  }

  titleSource(id: string): 'prompt' | 'ai' | 'provider' | 'manual' {
    return (
      (
        this.db.prepare('SELECT title_source AS source FROM tasks WHERE id = ?').get(id) as
          { source: 'prompt' | 'ai' | 'provider' | 'manual' } | undefined
      )?.source ?? 'prompt'
    )
  }

  setPinned(id: string, pinned: boolean): Task {
    this.getTask(id)
    this.db.prepare('UPDATE tasks SET pinned_at = ? WHERE id = ?').run(pinned ? Date.now() : null, id)
    return this.getTask(id)
  }

  setDone(id: string, done: boolean): Task {
    this.getTask(id)
    this.db.prepare('UPDATE tasks SET done_at = ? WHERE id = ?').run(done ? Date.now() : null, id)
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
    const shared = workspaceId
      ? (
          this.db
            .prepare('SELECT COUNT(*) AS n FROM tasks WHERE workspace_id = ? AND id != ?')
            .get(workspaceId, id) as { n: number }
        ).n
      : 0
    if (removeWorktrees && shared)
      throw new Error(
        'This isolated workspace is used by other threads. Delete only this thread or remove the other threads first.',
      )
    if (removeWorktrees) {
      const owned = this.listBindings(id).filter(
        (b) => b.mode === 'worktree' && b.setupState === 'ready' && existsSync(b.cwd),
      )
      const dirty: string[] = []
      for (const b of owned) if ((await gitCli.status(b.cwd)).entries.length) dirty.push(b.repoName)
      if (dirty.length) {
        throw new Error(
          `Not deleted: ${dirty.join(', ')} ${dirty.length > 1 ? 'have' : 'has'} uncommitted changes in the worktree. Commit or discard them first.`,
        )
      }
      for (const b of owned) await gitCli.worktreeRemove(this.getRepository(b.repoId).root, b.cwd)
    }
    this.db.exec('BEGIN')
    try {
      this.db
        .prepare('DELETE FROM agent_events WHERE session_id IN (SELECT id FROM agent_sessions WHERE task_id = ?)')
        .run(id)
      this.db.prepare('DELETE FROM agent_sessions WHERE task_id = ?').run(id)
      this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
      this.db.prepare('DELETE FROM app_state WHERE key = ?').run(`branch-fallback:${id}`)
      // Threads it started keep their group; they only lose the link back to a thread that no longer exists.
      this.db.prepare('DELETE FROM thread_links WHERE target_task_id = ?').run(id)
      this.db
        .prepare('UPDATE thread_links SET source_task_id = NULL, source_session_id = NULL WHERE source_task_id = ?')
        .run(id)
      // Threads it started on other hosts keep running there; this host just stops following them.
      this.db
        .prepare('UPDATE remote_threads SET source_task_id = NULL, source_session_id = NULL WHERE source_task_id = ?')
        .run(id)
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

  /** Aliases and a description help Auto choose this project; blank values are dropped and lengths are bounded. */
  setProjectRouting(id: string, aliases: string[], description: string): Project {
    this.getProject(id)
    const clean = [...new Set(aliases.map(cleanLabel).filter(Boolean))].slice(0, 8)
    this.db
      .prepare('UPDATE projects SET aliases = ?, description = ? WHERE id = ?')
      .run(JSON.stringify(clean), description.trim().slice(0, 280), id)
    return this.getProject(id)
  }

  /** Removes the project from Ramu only. Folders on disk are untouched. */
  removeProject(id: string): void {
    this.getProject(id)
    const tasks = this.listTasks(id)
    if (tasks.length)
      throw new Error(`Delete this project's ${tasks.length} thread${tasks.length > 1 ? 's' : ''} first.`)
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
    const used = this.db
      .prepare("SELECT COUNT(*) AS n FROM bindings WHERE repo_id = ? AND mode = 'worktree'")
      .get(id) as { n: number }
    if (used.n) throw new Error('An isolated workspace still uses this repository. Remove its worktrees first.')
    this.db.prepare("DELETE FROM bindings WHERE repo_id = ? AND mode = 'current'").run(id)
    this.db.prepare('DELETE FROM repositories WHERE id = ?').run(id)
  }

  async worktreeUnavailable(projectId: string): Promise<string | null> {
    this.getProject(projectId)
    const repos = this.listRepositories(projectId)
    if (!repos.length) return 'This project has no repositories'
    for (const repo of repos) {
      if (!existsSync(join(repo.root, '.git'))) return `${repo.name} is not a Git repository`
      if (!(await gitCli.headOid(repo.root))) return `${repo.name} has no commits to branch from`
    }
    return null
  }

  /** Worktree paths and branch names that createTask would use, shown to the user before creation. */
  async planWorktrees(
    projectId: string,
    title: string,
    repoIds: string[],
    prefix = 'ramu/',
    choice?: BranchChoice,
    baseBranch?: string,
    checkout?: CreateTaskInput['checkout'],
  ): Promise<WorktreePlanEntry[]> {
    if (choice && (!validBranchName(choice.name) || choice.name.length > 160))
      throw new Error('Invalid Git branch name')
    const project = this.getProject(projectId)
    const slug = slugify(title)
    const taskDir = this.uniqueDir(join(this.worktreesRoot, slugify(project.name), slug))
    const suffix = basename(taskDir).slice(slug.length) // "" or "-2", "-3"...
    const plan: WorktreePlanEntry[] = []
    for (const repoId of repoIds) {
      const repo = this.getRepository(repoId)
      if (repo.projectId !== projectId) throw new Error(`Repository ${repo.name} is not in this project`)
      if (!existsSync(join(repo.root, '.git')))
        throw new Error(
          `${repo.name} is not a Git repository. Initialize it in Source Control to use isolated worktrees.`,
        )
      if (checkout?.repoId === repoId) {
        plan.push(await this.checkoutPlan(repo, checkout, join(taskDir, repo.name)))
        continue
      }
      const base = baseBranch ? await gitCli.fetchedBranch(repo.root, baseBranch) : null
      const baseOid = base?.oid ?? (await gitCli.headOid(repo.root))
      const baseRef = base?.ref ?? (await gitCli.currentBranch(repo.root)) ?? baseOid
      if (!baseRef || !baseOid) throw new Error(`${repo.name} has no commits to branch from`)
      const stem = choice ? choice.name : `${branchForTitle(title, prefix)}${suffix}`
      const reserved = (
        this.db
          .prepare("SELECT task_branch AS branch FROM bindings WHERE repo_id = ? AND mode = 'worktree'")
          .all(repoId) as { branch: string }[]
      ).map((b) => b.branch.toLowerCase())
      const names = new Set([...(await gitCli.branches(repo.root)).map((b) => b.name.toLowerCase()), ...reserved])
      let taskBranch = stem
      for (
        let n = 2;
        [...names].some(
          (name) =>
            name === taskBranch.toLowerCase() ||
            name.startsWith(`${taskBranch.toLowerCase()}/`) ||
            taskBranch.toLowerCase().startsWith(`${name}/`),
        );
        n++
      ) {
        if (choice?.source === 'manual') throw new Error(`Branch ${choice.name} is already taken in ${repo.name}`)
        if (n > 1000) throw new Error('No available worktree branch name')
        taskBranch = `${stem}-${n}`
      }
      plan.push({ repoId, repoName: repo.name, baseRef, baseOid, taskBranch, path: join(taskDir, repo.name) })
    }
    return plan
  }

  private uniqueDir(base: string): string {
    let dir = base
    const existingNames = new Set(
      existsSync(dirname(base)) ? readdirSync(dirname(base)).map((name) => name.toLowerCase()) : [],
    )
    const reserved = new Set(
      (this.db.prepare("SELECT cwd FROM bindings WHERE mode = 'worktree'").all() as { cwd: string }[]).map((b) =>
        dirname(b.cwd).toLowerCase(),
      ),
    )
    for (
      let n = 2;
      existingNames.has(basename(dir).toLowerCase()) || existsSync(dir) || reserved.has(dir.toLowerCase());
      n++
    ) {
      if (n > 1000) throw new Error('No available worktree directory')
      dir = `${base}-${n}`
    }
    return dir
  }

  /**
   * Creates the task and its bindings. Current-checkout bindings are ready immediately and
   * touch nothing in Git. Worktree bindings are recorded as pending; call setupTask to create them.
   */
  private readonly preparingNames = new Map<string, { fingerprint: string; promise: Promise<Task> }>()

  createTask(
    input: CreateTaskInput,
    plan?: WorktreePlanEntry[],
    prepareName?: () => Promise<BranchChoice>,
  ): Promise<Task> {
    const fingerprint = JSON.stringify(input)
    if (input.requestId) {
      const previous = this.getAppState<{ taskId: string; fingerprint: string } | null>(
        `task-request:${input.requestId}`,
        null,
      )
      if (previous)
        return previous.fingerprint === fingerprint
          ? Promise.resolve(this.getTask(previous.taskId))
          : Promise.reject(new Error('Creation request was already used with different inputs'))
      const preparing = this.preparingNames.get(input.requestId)
      if (preparing)
        return preparing.fingerprint === fingerprint
          ? preparing.promise
          : Promise.reject(new Error('Creation request was already used with different inputs'))
    }
    // Slow inference stays outside the global allocation lock. Allocation rechecks idempotency.
    const promise = (async () => {
      const choice =
        input.mode === 'worktree' && !input.workspaceId ? (input.branchChoice ?? (await prepareName?.())) : undefined
      const allocate = () => this.allocation.run('create', () => this.allocateTask(input, plan, choice))
      try {
        return await allocate()
      } catch (error) {
        // Another process on this database claimed the same folder or branch between planning and claiming it. The
        // re-plan sees the other claim and picks a free name; a second collision is reported as it is.
        if (!/UNIQUE constraint failed: bindings\./.test(String(error))) throw error
        return await allocate()
      }
    })()
    if (input.requestId) {
      const key = input.requestId
      this.preparingNames.set(key, { fingerprint, promise })
      void promise.finally(() => this.preparingNames.delete(key)).catch(() => {})
    }
    return promise
  }

  /** A worktree on an existing branch: the local one when it is there, otherwise created from the fetched remote head. */
  private async checkoutPlan(
    repo: Repository,
    checkout: NonNullable<CreateTaskInput['checkout']>,
    path: string,
  ): Promise<WorktreePlanEntry> {
    if (!validBranchName(checkout.branch) || checkout.branch.length > 160) throw new Error('Invalid Git branch name')
    const taken = this.db
      .prepare("SELECT 1 FROM bindings WHERE repo_id = ? AND mode = 'worktree' AND lower(task_branch) = lower(?)")
      .get(repo.id, checkout.branch)
    if (taken) throw new Error(`${checkout.branch} is already open in another thread's worktree.`)
    if (await gitCli.branchExists(repo.root, checkout.branch)) {
      const oid = (await gitCli.git(repo.root, ['rev-parse', '--verify', `refs/heads/${checkout.branch}`])).trim()
      return {
        repoId: repo.id,
        repoName: repo.name,
        baseRef: checkout.branch,
        baseOid: oid,
        taskBranch: checkout.branch,
        path,
      }
    }
    const fetched = checkout.fetchRef
      ? await gitCli.fetchedRef(repo.root, checkout.fetchRef, checkout.branch)
      : await gitCli.fetchedBranch(repo.root, checkout.branch)
    return {
      repoId: repo.id,
      repoName: repo.name,
      baseRef: fetched.ref,
      baseOid: fetched.oid,
      taskBranch: checkout.branch,
      path,
    }
  }

  private async allocateTask(input: CreateTaskInput, plan?: WorktreePlanEntry[], choice?: BranchChoice): Promise<Task> {
    const requestKey = input.requestId ? `task-request:${input.requestId}` : null
    const fingerprint = JSON.stringify(input)
    if (requestKey) {
      const previous = this.getAppState<{ taskId: string; fingerprint: string } | null>(requestKey, null)
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new Error('Creation request was already used with different inputs')
        return this.getTask(previous.taskId)
      }
    }
    const title = cleanLabel(input.title)
    if (!title) throw new Error('Thread title is required')
    // Repositories belong to the project: a task always covers all of them.
    const repos = this.listRepositories(input.projectId)
    if (!repos.length && input.projectId !== NO_PROJECT) throw new Error('This project has no repositories')
    if (input.projectId === NO_PROJECT && (input.mode !== 'current' || input.workspaceId))
      throw new Error('Project-free threads cannot use worktrees')

    if (input.workspaceId) {
      const existing = this.getWorktreeWorkspace(input.workspaceId)
      if (input.mode !== 'worktree' || existing.projectId !== input.projectId)
        throw new Error('Isolated workspace is not in this project')
      const bindings = this.listBindings(`worktree:${existing.id}`)
      if (!bindings.length || bindings.some((b) => b.setupState !== 'ready' || !existsSync(b.cwd)))
        throw new Error('This isolated workspace is not ready')
      for (const b of bindings)
        if (!(await this.registeredWorktree(this.getRepository(b.repoId).root, b.cwd)))
          throw new Error(`${b.repoName} is no longer a registered worktree`)
      if (plan) throw new Error('An existing workspace does not need a worktree plan')
    }
    if (input.mode === 'worktree' && !input.workspaceId) {
      const expected = plan
      plan = await this.planWorktrees(
        input.projectId,
        title,
        repos.map((r) => r.id),
        input.branchPrefix,
        choice,
        input.baseBranch,
        input.checkout,
      )
      if (expected) {
        if (expected.length !== repos.length || !repos.every((r) => expected.some((p) => p.repoId === r.id)))
          throw new Error('Worktree plan does not match the selected repositories')
        for (const entry of expected) {
          const actual = plan.find((p) => p.repoId === entry.repoId)!
          if (entry.baseOid && entry.baseOid !== actual.baseOid)
            throw new Error('Repository HEAD changed since preview. Review the worktree plan and try again.')
          // Paths and branch names are advisory. Only the server allocates mutation targets.
        }
      }
    }

    const task: Task = {
      id: randomUUID(),
      projectId: input.projectId,
      title,
      mode: input.mode,
      workspaceId: input.mode === 'worktree' ? (input.workspaceId ?? randomUUID()) : null,
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
      if (input.mode === 'worktree' && !input.workspaceId)
        this.db
          .prepare('INSERT INTO workspaces (id, project_id, name, created_at) VALUES (?, ?, ?, ?)')
          .run(task.workspaceId!, task.projectId, title, task.createdAt)
      this.db
        .prepare(
          'INSERT INTO tasks (id, project_id, title, mode, status, created_at, workspace_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(task.id, task.projectId, task.title, task.mode, task.status, task.createdAt, task.workspaceId)
      // Current-checkout tasks store no bindings; they follow the project's repositories live.
      if (input.mode === 'worktree' && !input.workspaceId) {
        for (const repo of repos) {
          const p = plan!.find((e) => e.repoId === repo.id)!
          insertBinding.run(task.workspaceId!, repo.id, 'worktree', p.path, p.taskBranch, p.baseRef, 'pending')
        }
      }
      if (plan && task.workspaceId && !input.workspaceId)
        this.setAppState(
          `worktree-bases:${task.workspaceId}`,
          Object.fromEntries(plan.map((p) => [p.repoId, p.baseOid])),
        )
      const checkout = input.checkout && plan?.find((entry) => entry.repoId === input.checkout!.repoId)
      if (checkout && task.workspaceId)
        // The branch already exists or comes from the remote, so setup adopts it instead of claiming a new one.
        this.setAppState(`worktree-checkout:${task.workspaceId}:${checkout.repoId}`, {
          upstream:
            !input.checkout!.fetchRef && checkout.baseRef.startsWith('refs/remotes/')
              ? checkout.baseRef.slice('refs/remotes/'.length)
              : null,
        })
      if (choice?.source === 'fallback') {
        task.branchNamingFallback = true
        this.setAppState(`branch-fallback:${task.id}`, true)
      }
      if (requestKey) this.setAppState(requestKey, { taskId: task.id, fingerprint })
      this.db.exec('COMMIT')
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
    return task
  }

  /** Creates pending worktrees. Safe to call again after a partial failure: only unfinished bindings run. */
  setupTask(taskId: string): Promise<RepositoryBinding[]> {
    return this.allocation.run(`setup:${this.workspaceIdOf(taskId) ?? taskId}`, () => this.setupBindings(taskId))
  }

  private async setupBindings(taskId: string): Promise<RepositoryBinding[]> {
    for (const b of this.listBindings(taskId)) {
      if (b.mode !== 'worktree' || b.setupState === 'ready') continue
      const repo = this.getRepository(b.repoId)
      try {
        const workspaceId = this.workspaceIdOf(taskId)!
        const baseOid = this.getAppState<Record<string, string>>(`worktree-bases:${workspaceId}`, {})[b.repoId]
        const ownershipKey = `worktree-branch:${workspaceId}:${b.repoId}`
        const registered = await this.registeredWorktree(repo.root, b.cwd)
        if (!registered) {
          await mkdir(this.worktreesRoot, { recursive: true })
          const root = await realpath(this.worktreesRoot)
          let ancestor = dirname(b.cwd)
          while (!existsSync(ancestor)) ancestor = dirname(ancestor)
          if (!isWithin(root, await realpath(ancestor))) throw new Error('Worktree directory escaped the managed root')
          await mkdir(join(b.cwd, '..'), { recursive: true })
          if (!isWithin(root, await realpath(dirname(b.cwd))))
            throw new Error('Worktree directory escaped the managed root')
          await gitCli.git(repo.root, ['check-ref-format', '--branch', b.taskBranch!])
          const adopted = this.getAppState<{ upstream: string | null } | null>(
            `worktree-checkout:${workspaceId}:${b.repoId}`,
            null,
          )
          if (adopted && (await gitCli.branchExists(repo.root, b.taskBranch!))) {
            // A pull request's existing local branch: worked on as it is.
          } else if (await gitCli.branchExists(repo.root, b.taskBranch!)) {
            const owned = this.getAppState<string | null>(ownershipKey, null)
            const actual = (
              await gitCli.git(repo.root, ['rev-parse', '--verify', `refs/heads/${b.taskBranch!}`])
            ).trim()
            if (!owned || owned !== actual)
              throw new Error(
                'Worktree branch already exists without matching ownership. Resolve the conflict before retrying setup.',
              )
          } else {
            const oid = baseOid ?? (await gitCli.git(repo.root, ['rev-parse', '--verify', b.baseRef!])).trim()
            await gitCli.git(repo.root, ['branch', '--', b.taskBranch!, oid])
            this.setAppState(ownershipKey, oid)
          }
          await gitCli.worktreeAddExistingBranch(repo.root, b.cwd, b.taskBranch!)
          if (adopted?.upstream)
            await gitCli
              .git(repo.root, ['branch', `--set-upstream-to=${adopted.upstream}`, '--', b.taskBranch!])
              .catch(() => {
                // Pushing still sets the upstream on first push; tracking is a convenience here.
              })
        } else if ((await gitCli.currentBranch(b.cwd)) !== b.taskBranch) {
          throw new Error('Registered worktree no longer uses its recorded branch')
        }
        const cwd = await realpath(b.cwd)
        this.db
          .prepare(
            "UPDATE bindings SET cwd = ?, setup_state = 'ready', setup_error = NULL WHERE task_id = ? AND repo_id = ?",
          )
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
        // A folder without Git has files and terminals only, until it is initialized.
        ...(existsSync(join(r.root, '.git')) ? {} : { folderOnly: true, notGit: true }),
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

  /** Folders Ramu manages for every thread: worktrees and project-free chat folders. */
  managedFolders(): string[] {
    return [this.worktreesRoot, join(this.worktreesRoot, '..', 'chats')]
  }

  /** Explorer must never allocate a project-free folder just by opening a read surface. */
  explorerBindings(ctx: string): RepositoryBinding[] {
    if (this.projectIdOf(ctx) === NO_PROJECT) {
      const folder = join(this.worktreesRoot, '..', 'chats', isProjectCtx(ctx) ? 'general' : this.getTask(ctx).id)
      if (!existsSync(folder)) return []
    }
    return this.fileBindings(ctx)
  }

  /** File surfaces also expose each project-free chat's existing working folder. */
  fileBindings(ctx: string): RepositoryBinding[] {
    if (this.projectIdOf(ctx) !== NO_PROJECT) return this.listBindings(ctx)
    return [
      {
        taskId: ctx,
        repoId: 'general',
        repoName: 'Thread files',
        folderOnly: true,
        cwd: this.agentScope(ctx).cwd,
        mode: 'current',
        taskBranch: null,
        baseRef: null,
        setupState: 'ready',
        setupError: null,
      },
    ]
  }

  /** The binding for (context, repo), which must be ready before any surface may use it. */
  getBinding(ctx: string, repoId: string): RepositoryBinding {
    const binding = this.fileBindings(ctx).find((b) => b.repoId === repoId)
    if (!binding) throw new Error('Repository is not part of this project')
    if (binding.setupState !== 'ready')
      throw new Error(`${binding.repoName} worktree is not ready (${binding.setupState})`)
    return binding
  }

  // ---- UI state ----

  getTaskUi(ctx: string): TaskUiState {
    if (isProjectCtx(ctx) || isWorktreeCtx(ctx))
      return this.getAppState<TaskUiState>(`ui:${ctx}`, { views: [], activeViewId: null })
    const row = this.db.prepare('SELECT ui_state FROM tasks WHERE id = ?').get(ctx) as
      { ui_state: string | null } | undefined
    if (!row) throw new Error(`Unknown thread ${ctx}`)
    return row.ui_state ? (JSON.parse(row.ui_state) as TaskUiState) : { views: [], activeViewId: null }
  }

  setTaskUi(ctx: string, ui: TaskUiState): void {
    if (isProjectCtx(ctx) || isWorktreeCtx(ctx)) return this.setAppState(`ui:${ctx}`, ui)
    this.db.prepare('UPDATE tasks SET ui_state = ? WHERE id = ?').run(JSON.stringify(ui), ctx)
  }

  getAppState<T>(key: string, fallback: T): T {
    if (this.settingsStore && key === 'app-preferences') return this.settingsStore.preferences() as T
    if (this.settingsStore && key === 'model-preferences') return (this.settingsStore.models() ?? fallback) as T
    const row = this.db.prepare('SELECT value FROM app_state WHERE key = ?').get(key) as { value: string } | undefined
    return row ? (JSON.parse(row.value) as T) : fallback
  }

  setAppState(key: string, value: unknown): void {
    if (this.settingsStore && key === 'app-preferences') return this.settingsStore.set(value)
    if (this.settingsStore && key === 'model-preferences') return this.settingsStore.set(undefined, value)
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
