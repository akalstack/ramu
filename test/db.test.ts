import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { openDb } from '../src/main/db'
import { Workspace } from '../src/main/workspace'

it('migrates legacy worktree conversations without losing bindings, transcripts, UI, or saved access settings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-migration-'))
  const path = join(dir, 'profile.sqlite')
  const legacy = new DatabaseSync(path)
  const savedUi = JSON.stringify({ views: [{ id: 'terminal-1', kind: 'terminal', repoId: 'repo' }], activeViewId: 'terminal-1' })
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
    INSERT INTO agent_events VALUES ('session', 1, '{"kind":"user","text":"Keep my conversation"}');
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
    expect(ws.getBinding('chat', 'repo')).toMatchObject({ cwd: '/isolated/Repo', taskBranch: 'ramu/existing', setupState: 'ready' })
    expect(ws.getBinding('worktree:chat', 'repo').cwd).toBe('/isolated/Repo')
    expect(ws.getTaskUi('worktree:chat')).toEqual(JSON.parse(savedUi))
    expect(db.prepare('SELECT event FROM agent_events').get()).toEqual({ event: '{"kind":"user","text":"Keep my conversation"}' })
    expect(JSON.parse((db.prepare('SELECT settings FROM agent_sessions').get() as { settings: string }).settings).access).toBe('ask')
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
