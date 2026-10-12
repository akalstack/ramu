// SQLite metadata store (node:sqlite, built into Node 24 / Electron 44).
// Source files stay on disk; only projects, tasks, bindings, sessions and UI state live here.
import { DatabaseSync } from 'node:sqlite'

const MIGRATIONS: string[] = [
  `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE repositories (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    root TEXT NOT NULL,
    UNIQUE (project_id, root),
    UNIQUE (project_id, name)
  );
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    title TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('current', 'worktree')),
    status TEXT NOT NULL,
    ui_state TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE bindings (
    task_id TEXT NOT NULL REFERENCES tasks(id),
    repo_id TEXT NOT NULL REFERENCES repositories(id),
    mode TEXT NOT NULL,
    cwd TEXT NOT NULL,
    task_branch TEXT,
    base_ref TEXT,
    setup_state TEXT NOT NULL,
    setup_error TEXT,
    PRIMARY KEY (task_id, repo_id)
  );
  CREATE TABLE agent_sessions (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    repo_id TEXT NOT NULL REFERENCES repositories(id),
    provider TEXT NOT NULL,
    cwd TEXT NOT NULL,
    state TEXT NOT NULL,
    provider_session_id TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE agent_events (
    session_id TEXT NOT NULL REFERENCES agent_sessions(id),
    seq INTEGER NOT NULL,
    event TEXT NOT NULL,
    PRIMARY KEY (session_id, seq)
  );
  CREATE TABLE app_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // v2: projects can have a workspace root folder; agent sessions run at task scope
  // (a working directory plus extra directories) instead of being tied to one repository.
  `
  ALTER TABLE projects ADD COLUMN root TEXT;
  CREATE TABLE agent_sessions_v2 (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    repo_id TEXT REFERENCES repositories(id),
    provider TEXT NOT NULL,
    cwd TEXT NOT NULL,
    additional_dirs TEXT NOT NULL DEFAULT '[]',
    covers TEXT NOT NULL DEFAULT '[]',
    state TEXT NOT NULL,
    provider_session_id TEXT,
    created_at INTEGER NOT NULL
  );
  INSERT INTO agent_sessions_v2 (id, task_id, repo_id, provider, cwd, covers, state, provider_session_id, created_at)
    SELECT id, task_id, repo_id, provider, cwd, json_array(cwd), state, provider_session_id, created_at FROM agent_sessions;
  DROP TABLE agent_sessions;
  ALTER TABLE agent_sessions_v2 RENAME TO agent_sessions;
  `,
  `ALTER TABLE agent_sessions ADD COLUMN settings TEXT NOT NULL DEFAULT '{"provider":"claude-code","model":"","effort":null,"access":"ask","autoFallback":true}';`,

  // Worktree workspaces outlive individual chats. Existing chat IDs become workspace IDs.
  `CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  ALTER TABLE tasks ADD COLUMN workspace_id TEXT REFERENCES workspaces(id);
  INSERT INTO workspaces SELECT id, project_id, title, created_at FROM tasks WHERE mode = 'worktree';
  UPDATE tasks SET workspace_id = id WHERE mode = 'worktree';
  CREATE TABLE workspace_bindings (
    task_id TEXT NOT NULL REFERENCES workspaces(id),
    repo_id TEXT NOT NULL REFERENCES repositories(id),
    mode TEXT NOT NULL,
    cwd TEXT NOT NULL,
    task_branch TEXT,
    base_ref TEXT,
    setup_state TEXT NOT NULL,
    setup_error TEXT,
    PRIMARY KEY (task_id, repo_id)
  );
  INSERT INTO workspace_bindings SELECT * FROM bindings WHERE mode = 'worktree';
  DROP TABLE bindings;
  ALTER TABLE workspace_bindings RENAME TO bindings;
  INSERT INTO app_state (key, value)
    SELECT 'ui:worktree:' || id, ui_state FROM tasks WHERE mode = 'worktree' AND ui_state IS NOT NULL;
  `,

  `INSERT INTO projects (id, name, created_at) VALUES ('no-project', 'No project', 0);
  CREATE TABLE schedules (id TEXT PRIMARY KEY, data TEXT NOT NULL, state TEXT NOT NULL, next_run_at INTEGER, created_at INTEGER NOT NULL);
  CREATE TABLE schedule_runs (id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
    due_at INTEGER NOT NULL, task_id TEXT, session_id TEXT, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    retry_at INTEGER, error TEXT, created_at INTEGER NOT NULL, UNIQUE(schedule_id, due_at));
  CREATE INDEX schedule_due ON schedules(state, next_run_at);
  CREATE INDEX run_queue ON schedule_runs(status, retry_at);
  CREATE TABLE recap_items (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
  `,
  `CREATE TABLE change_reviews (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, session_id TEXT, state TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE INDEX reviews_by_session ON change_reviews(session_id, created_at);`,
  // Where a chat's title came from, so an automatic title never overwrites one the user typed.
  `ALTER TABLE tasks ADD COLUMN title_source TEXT NOT NULL DEFAULT 'prompt';`,
  // Pinned chats float to the top of the sidebar; the value is when they were pinned.
  `ALTER TABLE tasks ADD COLUMN pinned_at INTEGER;`,
  // The order projects were dragged into; projects never dragged keep creation order after them.
  `ALTER TABLE projects ADD COLUMN position INTEGER;`,
  // A sub-agent Ramu runs itself is a session of its own, hidden from the chat list and tied to the chat that started it.
  `ALTER TABLE agent_sessions ADD COLUMN parent_session_id TEXT; CREATE INDEX sessions_by_parent ON agent_sessions(parent_session_id);`,
  // Keep restart intent durable even if another restart happens before the provider launches.
  `CREATE TABLE agent_recovery (session_id TEXT PRIMARY KEY REFERENCES agent_sessions(id) ON DELETE CASCADE, queue_paused INTEGER NOT NULL DEFAULT 0);`,
  // The Supervised access mode is gone; anything saved with it now asks before commands only, the closest remaining mode.
  `UPDATE agent_sessions SET settings = replace(settings, '"access":"ask"', '"access":"edits"') WHERE settings LIKE '%"access":"ask"%';
  UPDATE agent_events SET event = replace(event, '"access":"ask"', '"access":"edits"') WHERE event LIKE '%"access":"ask"%';
  UPDATE schedules SET data = replace(data, '"access":"ask"', '"access":"edits"') WHERE data LIKE '%"access":"ask"%';
  UPDATE app_state SET value = replace(replace(value, '"access":"ask"', '"access":"edits"'), '"defaultAccess":"ask"', '"defaultAccess":"edits"') WHERE key = 'app-preferences' OR key = 'model-preferences' OR key LIKE 'asides:%';`,
]

export type Db = DatabaseSync

export function openDb(path: string): Db {
  const db = new DatabaseSync(path)
  // Foreign keys stay off while migrating: table rebuilds drop a parent table that others reference.
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF;')
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN')
    try {
      db.exec(MIGRATIONS[v]!)
      db.exec(`PRAGMA user_version = ${v + 1}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
  db.exec('PRAGMA foreign_keys = ON;')
  return db
}
