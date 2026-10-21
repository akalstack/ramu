// SQLite metadata store (node:sqlite, built into Node 24 / Electron 44).
// Source files stay on disk; only projects, tasks, bindings, sessions and UI state live here.
import { DatabaseSync } from 'node:sqlite'

const MIGRATIONS: (string | ((db: DatabaseSync) => void))[] = [
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
  // Memory shared by every provider. Archived rows stay restorable; memory_events is the audit trail of who changed what and why.
  `CREATE TABLE memories (id TEXT PRIMARY KEY, project_id TEXT, kind TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]',
    importance INTEGER NOT NULL DEFAULT 3, status TEXT NOT NULL DEFAULT 'active', archived_reason TEXT, source TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_used_at INTEGER, use_count INTEGER NOT NULL DEFAULT 0, expires_at INTEGER);
  CREATE INDEX memories_by_scope ON memories(status, project_id);
  CREATE TABLE memory_events (id INTEGER PRIMARY KEY AUTOINCREMENT, memory_id TEXT NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL, reason TEXT, before TEXT, at INTEGER NOT NULL);
  CREATE INDEX memory_events_by_memory ON memory_events(memory_id, at);`,
  `ALTER TABLE agent_sessions ADD COLUMN response_style_applied INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE managed_skills (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE skill_revisions (skill_id TEXT NOT NULL REFERENCES managed_skills(id) ON DELETE CASCADE, revision INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(skill_id, revision));
  CREATE TABLE learning_jobs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE, seq INTEGER NOT NULL, data TEXT NOT NULL, UNIQUE(session_id, seq));
  CREATE TABLE session_checkpoints (session_id TEXT PRIMARY KEY REFERENCES agent_sessions(id) ON DELETE CASCADE, data TEXT NOT NULL);
  CREATE TABLE tool_payloads (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE, content TEXT NOT NULL, compact_chars INTEGER NOT NULL, created_at INTEGER NOT NULL);
  CREATE INDEX payloads_by_session ON tool_payloads(session_id, created_at);`,
  // "What Ramu learned": one row per summary, plus the review chats started from it.
  `CREATE TABLE library_summaries (id TEXT PRIMARY KEY, period_start INTEGER NOT NULL, period_end INTEGER NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE library_summary_chats (summary_id TEXT NOT NULL REFERENCES library_summaries(id) ON DELETE CASCADE, task_id TEXT NOT NULL PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE, created_at INTEGER NOT NULL);
  CREATE INDEX library_summary_chats_by_summary ON library_summary_chats(summary_id);`,
  // Backups of installed SKILL.md files a review chat changed at the user's request, so each edit can be restored.
  `CREATE TABLE installed_skill_revisions (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, name TEXT NOT NULL, content TEXT NOT NULL, reason TEXT, session_id TEXT, at INTEGER NOT NULL);
  CREATE INDEX installed_skill_revisions_by_path ON installed_skill_revisions(path, id);`,
  // Full-text recall indexes visible prose only; original events remain authoritative.
  `CREATE VIEW session_search_messages AS
    SELECT rowid AS id, session_id, seq,
      CASE json_extract(event, '$.kind')
        WHEN 'content' THEN (SELECT group_concat(json_extract(value, '$.text'), char(10)) FROM json_each(event, '$.content') WHERE json_extract(value, '$.type') = 'text')
        ELSE json_extract(event, '$.text') END AS text
    FROM agent_events
    WHERE json_extract(event, '$.kind') IN ('user', 'text', 'content') AND json_extract(event, '$.agentId') IS NULL;
  CREATE VIRTUAL TABLE session_search_fts USING fts5(session_id UNINDEXED, seq UNINDEXED, text, tokenize='unicode61');
  INSERT INTO session_search_fts(rowid, session_id, seq, text) SELECT id, session_id, seq, text FROM session_search_messages WHERE text IS NOT NULL;
  CREATE TRIGGER session_search_insert AFTER INSERT ON agent_events BEGIN
    INSERT INTO session_search_fts(rowid, session_id, seq, text) SELECT id, session_id, seq, text FROM session_search_messages WHERE id=new.rowid AND text IS NOT NULL;
  END;
  CREATE TRIGGER session_search_delete AFTER DELETE ON agent_events BEGIN
    DELETE FROM session_search_fts WHERE rowid=old.rowid;
  END;
  CREATE TRIGGER session_search_update AFTER UPDATE ON agent_events BEGIN
    DELETE FROM session_search_fts WHERE rowid=old.rowid;
    INSERT INTO session_search_fts(rowid, session_id, seq, text) SELECT id, session_id, seq, text FROM session_search_messages WHERE id=new.rowid AND text IS NOT NULL;
  END;`,
  // Tool output compression was removed; its saved payloads are no longer read.
  `DROP INDEX IF EXISTS payloads_by_session;
  DROP TABLE IF EXISTS tool_payloads;`,
  // Reserve v19: a development build inserted done_at at v9 and shifted v9–v18.
  // Its databases may already report v19, with or without the column.
  `SELECT 1;`,
  // User acknowledgment is independent from the agent's running/idle status.
  // Check the schema so both released databases and affected development profiles upgrade safely.
  (db) => {
    const columns = db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]
    if (!columns.some((column) => column.name === 'done_at')) {
      db.exec('ALTER TABLE tasks ADD COLUMN done_at INTEGER;')
    }
  },
  // One native provider session per login a thread has used, with the last event that provider saw, so a thread that comes
  // back to a provider resumes it and carries only what it missed. `agent_sessions.provider_session_id` stays the current one.
  `CREATE TABLE IF NOT EXISTS session_provider_sessions (
    session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    account_id TEXT NOT NULL,
    provider_session_id TEXT NOT NULL,
    last_seq INTEGER NOT NULL,
    context_max INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (session_id, provider, account_id)
  );`,
  // Goal statuses `paused` and `waiting-provider` merged: a limit hold is `paused` with `pausedBy: 'provider-limit'`. A paused goal
  // with no `pausedBy` stays the user's, which is what every one was, so only the retired status needs rewriting. Goals persist as
  // events and are re-armed from the latest one at startup, so a goal held at a limit before the upgrade keeps resuming.
  `UPDATE agent_events
    SET event = json_set(event, '$.goal.status', 'paused', '$.goal.pausedBy', 'provider-limit')
    WHERE json_extract(event, '$.kind') = 'goal' AND json_extract(event, '$.goal.status') = 'waiting-provider';`,
  `CREATE TABLE interactive_previews (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    input TEXT NOT NULL, result TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE TABLE interactive_versions (
    id TEXT NOT NULL, version INTEGER NOT NULL, session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL, request_signature TEXT NOT NULL, reference TEXT NOT NULL, html TEXT NOT NULL, preview TEXT,
    PRIMARY KEY(id,version), UNIQUE(session_id,request_id)
  );
  CREATE INDEX interactive_versions_by_session ON interactive_versions(session_id);
  CREATE INDEX interactive_previews_by_session ON interactive_previews(session_id,created_at);`,
  // Title ownership and bounded, restart-safe generation. A manual rename invalidates every older request.
  (db) => {
    const columns = new Set(
      (db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]).map((column) => column.name),
    )
    for (const [name, definition] of [
      ['title_revision', 'INTEGER NOT NULL DEFAULT 0'],
      ['title_generation_state', "TEXT NOT NULL DEFAULT 'idle'"],
      ['title_auto_attempted', 'INTEGER NOT NULL DEFAULT 0'],
      ['title_needs_refinement', 'INTEGER NOT NULL DEFAULT 0'],
      ['title_refinement_attempted', 'INTEGER NOT NULL DEFAULT 0'],
    ])
      if (!columns.has(name!)) db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${definition};`)
    db.exec(`CREATE TABLE IF NOT EXISTS task_title_jobs (
      task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('automatic', 'refinement', 'manual')),
      settings TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    );`)
  },
  (db) => {
    const columns = new Set(
      (db.prepare('PRAGMA table_info(session_provider_sessions)').all() as { name: string }[]).map(
        (column) => column.name,
      ),
    )
    if (!columns.has('model')) db.exec('ALTER TABLE session_provider_sessions ADD COLUMN model TEXT;')
    if (!columns.has('context_used')) db.exec('ALTER TABLE session_provider_sessions ADD COLUMN context_used INTEGER;')
    db.exec(`CREATE TABLE IF NOT EXISTS model_context_windows (
      provider TEXT NOT NULL, account_id TEXT NOT NULL, model TEXT NOT NULL,
      context_max INTEGER NOT NULL, PRIMARY KEY (provider, account_id, model)
    );`)
  },
  `CREATE TABLE IF NOT EXISTS background_terminals (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS background_terminals_task ON background_terminals(task_id);`,
  // Names people call a project and a short description, used only to choose a destination for a first message.
  (db) => {
    const columns = new Set((db.prepare('PRAGMA table_info(projects)').all() as { name: string }[]).map((c) => c.name))
    if (!columns.has('aliases')) db.exec("ALTER TABLE projects ADD COLUMN aliases TEXT NOT NULL DEFAULT '[]'")
    if (!columns.has('description')) db.exec("ALTER TABLE projects ADD COLUMN description TEXT NOT NULL DEFAULT ''")
  },
  `CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    body TEXT NOT NULL,
    project_id TEXT,
    providers TEXT NOT NULL DEFAULT '[]',
    activation TEXT NOT NULL DEFAULT 'always',
    enabled INTEGER NOT NULL DEFAULT 1,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rule_revisions (
    rule_id TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    name TEXT NOT NULL,
    body TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (rule_id, revision)
  );`,
  `CREATE TABLE IF NOT EXISTS task_title_waits (
    task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    settings TEXT NOT NULL,
    due_at INTEGER NOT NULL
  );`,
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
      const migration = MIGRATIONS[v]!
      if (typeof migration === 'string') db.exec(migration)
      else migration(db)
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
