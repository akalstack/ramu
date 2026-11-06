// SQLite metadata store (node:sqlite, built into Node 24 / Electron 44).
// Source files stay on disk; only projects, tasks, bindings, sessions and UI state live here.
import { DatabaseSync } from 'node:sqlite'

/** Stamped on every database, so a profile from a build with another schema is refused rather than misread. */
const SCHEMA_VERSION = 36

/**
 * Tables added after this schema version was stamped. Each is created if missing on every open, so an existing profile
 * gains them in place; they only ever add tables and indexes, and `ADDED_COLUMNS` only adds columns with defaults.
 */
const ADDED_TABLES = `
CREATE TABLE IF NOT EXISTS interactive_media (
    id TEXT NOT NULL, version INTEGER NOT NULL, wide TEXT, light TEXT, checks TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY(id,version)
  );
CREATE TABLE IF NOT EXISTS interactive_pages (
    id TEXT PRIMARY KEY, data TEXT NOT NULL, current_version INTEGER NOT NULL, pinned INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, changed_at INTEGER NOT NULL
  );
CREATE TABLE IF NOT EXISTS interactive_page_versions (
    page_id TEXT NOT NULL REFERENCES interactive_pages(id) ON DELETE CASCADE, version INTEGER NOT NULL,
    reference TEXT NOT NULL, html TEXT NOT NULL, preview TEXT, files TEXT, PRIMARY KEY(page_id,version)
  );
CREATE TABLE IF NOT EXISTS interactive_page_state (
    page_id TEXT PRIMARY KEY REFERENCES interactive_pages(id) ON DELETE CASCADE, state TEXT NOT NULL,
    revision INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
CREATE TABLE IF NOT EXISTS page_records (
    page_id TEXT NOT NULL REFERENCES interactive_pages(id) ON DELETE CASCADE, collection TEXT NOT NULL, id TEXT NOT NULL,
    data TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(page_id,collection,id)
  );
CREATE TABLE IF NOT EXISTS page_files (
    page_id TEXT NOT NULL REFERENCES interactive_pages(id) ON DELETE CASCADE, id TEXT NOT NULL, mime TEXT NOT NULL,
    data BLOB NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(page_id,id)
  );
CREATE TABLE IF NOT EXISTS page_runs (
    id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES interactive_pages(id) ON DELETE CASCADE, data TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
CREATE TABLE IF NOT EXISTS page_shares (
    token TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES interactive_pages(id) ON DELETE CASCADE, data TEXT NOT NULL,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
  );
CREATE INDEX IF NOT EXISTS page_records_by_page ON page_records(page_id, collection, created_at);
CREATE INDEX IF NOT EXISTS page_runs_by_page ON page_runs(page_id, created_at);
`

/**
 * Columns added to tables after this schema version was stamped, each with a default, so existing rows read as that
 * default and nothing is copied.
 */
const ADDED_COLUMNS: { table: string; column: string; definition: string }[] = [
  // Every page kept before artifacts had kinds is an App.
  { table: 'interactive_pages', column: 'kind', definition: "TEXT NOT NULL DEFAULT 'app'" },
]

function addColumns(db: DatabaseSync) {
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    if (!columns.some((entry) => entry.name === column))
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

const SCHEMA = `
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  , root TEXT, position INTEGER, aliases TEXT NOT NULL DEFAULT '[]', description TEXT NOT NULL DEFAULT '');

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
  , workspace_id TEXT REFERENCES workspaces(id), title_source TEXT NOT NULL DEFAULT 'prompt', pinned_at INTEGER, done_at INTEGER, title_revision INTEGER NOT NULL DEFAULT 0, title_generation_state TEXT NOT NULL DEFAULT 'idle', title_auto_attempted INTEGER NOT NULL DEFAULT 0, title_needs_refinement INTEGER NOT NULL DEFAULT 0, title_refinement_attempted INTEGER NOT NULL DEFAULT 0);

CREATE TABLE agent_events (
    session_id TEXT NOT NULL REFERENCES agent_sessions(id),
    seq INTEGER NOT NULL,
    event TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (session_id, seq)
  );

CREATE TABLE app_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

CREATE TABLE "agent_sessions" (
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
  , settings TEXT NOT NULL DEFAULT '{"provider":"claude-code","model":"","effort":null,"access":"ask","autoFallback":true}', parent_session_id TEXT, response_style_applied INTEGER NOT NULL DEFAULT 0);

CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

CREATE TABLE "bindings" (
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

CREATE TABLE schedules (id TEXT PRIMARY KEY, data TEXT NOT NULL, state TEXT NOT NULL, next_run_at INTEGER, created_at INTEGER NOT NULL);

CREATE TABLE schedule_runs (id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
    due_at INTEGER NOT NULL, task_id TEXT, session_id TEXT, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    retry_at INTEGER, error TEXT, created_at INTEGER NOT NULL, UNIQUE(schedule_id, due_at));

CREATE TABLE recap_items (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, data TEXT NOT NULL);

CREATE TABLE change_reviews (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, session_id TEXT, state TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL);

CREATE TABLE agent_recovery (session_id TEXT PRIMARY KEY REFERENCES agent_sessions(id) ON DELETE CASCADE, queue_paused INTEGER NOT NULL DEFAULT 0);

CREATE TABLE memories (id TEXT PRIMARY KEY, project_id TEXT, kind TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]',
    importance INTEGER NOT NULL DEFAULT 3, status TEXT NOT NULL DEFAULT 'active', archived_reason TEXT, source TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_used_at INTEGER, use_count INTEGER NOT NULL DEFAULT 0, expires_at INTEGER);

CREATE TABLE memory_events (id INTEGER PRIMARY KEY AUTOINCREMENT, memory_id TEXT NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL, reason TEXT, before TEXT, at INTEGER NOT NULL);

CREATE TABLE managed_skills (id TEXT PRIMARY KEY, data TEXT NOT NULL);

CREATE TABLE skill_revisions (skill_id TEXT NOT NULL REFERENCES managed_skills(id) ON DELETE CASCADE, revision INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(skill_id, revision));

CREATE TABLE learning_jobs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE, seq INTEGER NOT NULL, data TEXT NOT NULL, UNIQUE(session_id, seq));

CREATE TABLE session_checkpoints (session_id TEXT PRIMARY KEY REFERENCES agent_sessions(id) ON DELETE CASCADE, data TEXT NOT NULL);

CREATE TABLE library_summaries (id TEXT PRIMARY KEY, period_start INTEGER NOT NULL, period_end INTEGER NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL);

CREATE TABLE library_summary_chats (summary_id TEXT NOT NULL REFERENCES library_summaries(id) ON DELETE CASCADE, task_id TEXT NOT NULL PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE, created_at INTEGER NOT NULL);

CREATE TABLE installed_skill_revisions (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, name TEXT NOT NULL, content TEXT NOT NULL, reason TEXT, session_id TEXT, at INTEGER NOT NULL);

CREATE TABLE session_provider_sessions (
    session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    account_id TEXT NOT NULL,
    provider_session_id TEXT NOT NULL,
    last_seq INTEGER NOT NULL,
    context_max INTEGER,
    updated_at INTEGER NOT NULL, model TEXT, context_used INTEGER,
    PRIMARY KEY (session_id, provider, account_id)
  );

CREATE TABLE interactive_previews (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    input TEXT NOT NULL, result TEXT NOT NULL, created_at INTEGER NOT NULL
  );

CREATE TABLE interactive_versions (
    id TEXT NOT NULL, version INTEGER NOT NULL, session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    request_id TEXT NOT NULL, request_signature TEXT NOT NULL, reference TEXT NOT NULL, html TEXT NOT NULL, preview TEXT, files TEXT,
    PRIMARY KEY(id,version), UNIQUE(session_id,request_id)
  );

CREATE TABLE task_title_jobs (
      task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('automatic', 'refinement', 'manual')),
      settings TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    );

CREATE TABLE model_context_windows (
      provider TEXT NOT NULL, account_id TEXT NOT NULL, model TEXT NOT NULL,
      context_max INTEGER NOT NULL, PRIMARY KEY (provider, account_id, model)
    );

CREATE TABLE background_terminals (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    data TEXT NOT NULL
  );

CREATE TABLE rules (
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

CREATE TABLE rule_revisions (
    rule_id TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    name TEXT NOT NULL,
    body TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (rule_id, revision)
  );

CREATE TABLE task_title_waits (
    task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    settings TEXT NOT NULL,
    due_at INTEGER NOT NULL
  );

CREATE TABLE advice_reads (
    session_id TEXT PRIMARY KEY REFERENCES agent_sessions(id) ON DELETE CASCADE,
    read_rev INTEGER NOT NULL
  );

CREATE TABLE thread_links (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    source_task_id TEXT,
    source_session_id TEXT,
    target_task_id TEXT NOT NULL UNIQUE,
    target_session_id TEXT,
    depth INTEGER NOT NULL,
    reported TEXT,
    created_at INTEGER NOT NULL
  , source_device TEXT, source_host TEXT, source_title TEXT);

CREATE TABLE remote_threads (
      id TEXT PRIMARY KEY,
      host_id TEXT NOT NULL,
      remote_task_id TEXT,
      title TEXT NOT NULL,
      source_task_id TEXT,
      source_session_id TEXT,
      state TEXT NOT NULL,
      request TEXT,
      reported TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      retry_until INTEGER
    );

CREATE VIRTUAL TABLE session_search_fts USING fts5(session_id UNINDEXED, seq UNINDEXED, text, tokenize='unicode61');

CREATE VIEW session_search_messages AS
    SELECT rowid AS id, session_id, seq,
      CASE json_extract(event, '$.kind')
        WHEN 'content' THEN (SELECT group_concat(json_extract(value, '$.text'), char(10)) FROM json_each(event, '$.content') WHERE json_extract(value, '$.type') = 'text')
        ELSE json_extract(event, '$.text') END AS text
    FROM agent_events
    WHERE json_extract(event, '$.kind') IN ('user', 'text', 'content') AND json_extract(event, '$.agentId') IS NULL;

CREATE INDEX schedule_due ON schedules(state, next_run_at);

CREATE INDEX run_queue ON schedule_runs(status, retry_at);

CREATE INDEX reviews_by_session ON change_reviews(session_id, created_at);

CREATE INDEX sessions_by_parent ON agent_sessions(parent_session_id);

CREATE INDEX memories_by_scope ON memories(status, project_id);

CREATE INDEX memory_events_by_memory ON memory_events(memory_id, at);

CREATE INDEX library_summary_chats_by_summary ON library_summary_chats(summary_id);

CREATE INDEX installed_skill_revisions_by_path ON installed_skill_revisions(path, id);

CREATE INDEX interactive_versions_by_session ON interactive_versions(session_id);

CREATE INDEX interactive_previews_by_session ON interactive_previews(session_id,created_at);

CREATE INDEX background_terminals_task ON background_terminals(task_id);

CREATE INDEX agent_events_rev ON agent_events(session_id, rev);

CREATE UNIQUE INDEX bindings_worktree_path ON bindings(cwd) WHERE mode = 'worktree';

CREATE UNIQUE INDEX bindings_worktree_branch ON bindings(repo_id, task_branch) WHERE mode = 'worktree' AND task_branch IS NOT NULL;

CREATE INDEX thread_links_source ON thread_links(source_task_id);

CREATE INDEX thread_links_group ON thread_links(group_id);

CREATE INDEX remote_threads_source ON remote_threads(source_task_id);

CREATE INDEX agent_events_kind ON agent_events(session_id, json_extract(event, '$.kind'), seq);

CREATE TRIGGER session_search_insert AFTER INSERT ON agent_events BEGIN
    INSERT INTO session_search_fts(rowid, session_id, seq, text) SELECT id, session_id, seq, text FROM session_search_messages WHERE id=new.rowid AND text IS NOT NULL;
  END;

CREATE TRIGGER session_search_delete AFTER DELETE ON agent_events BEGIN
    DELETE FROM session_search_fts WHERE rowid=old.rowid;
  END;

CREATE TRIGGER session_search_update AFTER UPDATE ON agent_events BEGIN
    DELETE FROM session_search_fts WHERE rowid=old.rowid;
    INSERT INTO session_search_fts(rowid, session_id, seq, text) SELECT id, session_id, seq, text FROM session_search_messages WHERE id=new.rowid AND text IS NOT NULL;
  END;

INSERT INTO projects (id, name, created_at) VALUES ('no-project', 'No project', 0);
`

export type Db = DatabaseSync

export function openDb(path: string): Db {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF;')
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  if (version === 0) {
    db.exec('BEGIN')
    try {
      db.exec(SCHEMA)
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  } else if (version !== SCHEMA_VERSION) {
    db.close()
    throw new Error(
      `${path} has schema version ${version}, and this build reads ${SCHEMA_VERSION}. Move the file aside to start fresh.`,
    )
  }
  db.exec(ADDED_TABLES)
  addColumns(db)
  db.exec('PRAGMA foreign_keys = ON;')
  return db
}
