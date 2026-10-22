import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { openDb } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import { ProviderSessions } from '../src/agent/providerSessions'

it('upgrades saved native sessions without assuming their old context belongs to a known model', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-context-migration-'))
  const path = join(dir, 'profile.sqlite')
  let db = openDb(path)
  try {
    db.exec(`INSERT INTO projects (id, name, created_at) VALUES ('p', 'Project', 0);
      INSERT INTO tasks (id, project_id, title, mode, status, created_at) VALUES ('t', 'p', 'Task', 'current', 'idle', 0);
      INSERT INTO agent_sessions (id, task_id, provider, cwd, additional_dirs, covers, state, created_at) VALUES ('s', 't', 'codex', '/work', '[]', '[]', 'idle', 0);`)
    new ProviderSessions(db).save('s', 'codex', undefined, 'native-thread', 12, 1_000_000, 'large', 150_000)
    db.exec(`ALTER TABLE session_provider_sessions DROP COLUMN model;
      ALTER TABLE session_provider_sessions DROP COLUMN context_used;
      DROP TABLE model_context_windows;
      ALTER TABLE interactive_versions DROP COLUMN files;
      PRAGMA user_version = 24;`)
    db.close()
    db = openDb(path)
    expect(new ProviderSessions(db).get('s', 'codex', undefined)).toEqual({
      providerSessionId: 'native-thread',
      lastSeq: 12,
      contextMax: 1_000_000,
      model: null,
      contextUsed: null,
    })
    expect(db.prepare('SELECT * FROM model_context_windows').all()).toEqual([])
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

it('migrates legacy worktree conversations without losing bindings, transcripts, UI, or saved access settings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-migration-'))
  const path = join(dir, 'profile.sqlite')
  const legacy = new DatabaseSync(path)
  const savedUi = JSON.stringify({
    views: [{ id: 'terminal-1', kind: 'terminal', repoId: 'repo' }],
    activeViewId: 'terminal-1',
  })
  legacy.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, root TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE repositories (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), name TEXT, root TEXT);
    CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id), title TEXT, mode TEXT, status TEXT, ui_state TEXT, created_at INTEGER);
    CREATE TABLE bindings (task_id TEXT REFERENCES tasks(id), repo_id TEXT REFERENCES repositories(id), mode TEXT, cwd TEXT, task_branch TEXT, base_ref TEXT, setup_state TEXT, setup_error TEXT, PRIMARY KEY(task_id, repo_id));
    CREATE TABLE agent_sessions (id TEXT PRIMARY KEY, task_id TEXT REFERENCES tasks(id), repo_id TEXT, provider TEXT, cwd TEXT, additional_dirs TEXT, covers TEXT, state TEXT, provider_session_id TEXT, created_at INTEGER, settings TEXT);
    CREATE TABLE agent_events (session_id TEXT REFERENCES agent_sessions(id), seq INTEGER, event TEXT, PRIMARY KEY(session_id, seq));
    CREATE TABLE app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO projects VALUES ('project', 'Project', '/checkout', 1);
    INSERT INTO repositories VALUES ('repo', 'project', 'Repo', '/checkout');
    INSERT INTO tasks VALUES ('chat', 'project', 'Existing worktree', 'worktree', 'idle', NULL, 2);
    INSERT INTO tasks VALUES ('current', 'project', 'Current conversation', 'current', 'idle', NULL, 3);
    INSERT INTO bindings VALUES ('chat', 'repo', 'worktree', '/isolated/Repo', 'ramu/existing', 'main', 'ready', NULL);
    INSERT INTO agent_sessions VALUES ('session', 'chat', NULL, 'codex', '/isolated', '[]', '["/isolated/Repo"]', 'idle', 'native-thread', 4, '{"provider":"codex","model":"saved-model","effort":"high","access":"ask","autoFallback":false}');
    INSERT INTO agent_events (session_id, seq, event) VALUES ('session', 1, '{"kind":"user","text":"Keep my conversation"}');
    PRAGMA user_version = 3;
  `)
  legacy.prepare('UPDATE tasks SET ui_state = ? WHERE id = ?').run(savedUi, 'chat')
  legacy.close()
  const db = openDb(path)
  try {
    const ws = new Workspace(db, join(dir, 'worktrees'))
    expect(ws.getTask('chat')).toMatchObject({ workspaceId: 'chat', title: 'Existing worktree' })
    expect(ws.getTask('current').workspaceId).toBeNull()
    expect(ws.listWorkspaces()).toEqual([{ id: 'chat', projectId: 'project', name: 'Existing worktree', createdAt: 2 }])
    expect(ws.getBinding('chat', 'repo')).toMatchObject({
      cwd: '/isolated/Repo',
      taskBranch: 'ramu/existing',
      setupState: 'ready',
    })
    expect(ws.getBinding('worktree:chat', 'repo').cwd).toBe('/isolated/Repo')
    expect(ws.getTaskUi('worktree:chat')).toEqual(JSON.parse(savedUi))
    expect(db.prepare('SELECT event FROM agent_events').get()).toEqual({
      event: '{"kind":"user","text":"Keep my conversation"}',
    })
    expect(
      JSON.parse((db.prepare('SELECT settings FROM agent_sessions').get() as { settings: string }).settings).access,
    ).toBe('edits')
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(
      db.prepare("SELECT session_id, seq FROM session_search_fts WHERE session_search_fts MATCH 'conversation'").all(),
    ).toEqual([{ session_id: 'session', seq: 1 }])
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

it.each([
  { version: 18, hasDoneAt: false },
  { version: 19, hasDoneAt: false },
  { version: 19, hasDoneAt: true },
])('repairs task completion for schema v$version (done_at: $hasDoneAt)', async ({ version, hasDoneAt }) => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-done-migration-'))
  const path = join(dir, 'profile.sqlite')
  let db = openDb(path)
  try {
    const workspace = new Workspace(db, join(dir, 'worktrees'))
    const task = await workspace.createTask({ projectId: 'no-project', title: 'Keep this chat', mode: 'current' })
    if (hasDoneAt) db.prepare('UPDATE tasks SET done_at = ? WHERE id = ?').run(123, task.id)
    else db.exec('ALTER TABLE tasks DROP COLUMN done_at;')
    db.exec('DROP TABLE interactive_previews; DROP TABLE interactive_versions;')
    db.exec(`PRAGMA user_version = ${version}`)
    db.close()

    db = openDb(path)
    const migrated = new Workspace(db, join(dir, 'worktrees'))
    expect(migrated.getTask(task.id)).toMatchObject({ title: 'Keep this chat', doneAt: hasDoneAt ? 123 : null })
    expect(migrated.setDone(task.id, true).doneAt).toEqual(expect.any(Number))
    expect(migrated.setDone(task.id, false).doneAt).toBeNull()
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    db.close()

    db = openDb(path)
    expect(new Workspace(db, join(dir, 'worktrees')).getTask(task.id).doneAt).toBeNull()
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
