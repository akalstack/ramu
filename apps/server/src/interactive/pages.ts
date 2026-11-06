import { randomBytes, randomUUID } from 'node:crypto'
import type { Db } from '../db'
import type { InteractiveDocument, InteractiveReference, JsonValue } from '@ramu/shared/interactive'
import { readInteractiveState } from '@ramu/shared/interactive'
import {
  PAGE_LIMITS,
  declaredCapabilities,
  migrateRecord,
  pendingGrants,
  recordProblem,
  type PageCapabilities,
  type PageError,
  type PageGrants,
  type PageInfo,
  type PageRecord,
  type PageRecordQuery,
  type PageRun,
  type PageShare,
  type PageState,
  type PageUsage,
  type PageVersion,
} from '@ramu/shared/pages'
import { pageCapabilitiesOf } from './capabilities'
import type { InteractiveStore } from './store'

/** What a page row keeps beside its columns. */
interface PageData {
  title: string
  icon: string
  projectId: string | null
  sessionId: string
  capabilities: PageCapabilities
  grants: PageGrants
  lastError?: PageError
  grewInto?: PageInfo['grewInto']
  published?: PageInfo['published']
  duplicatedFrom?: string
  usage?: PageUsage
}
interface PageRow {
  id: string
  data: string
  current_version: number
  pinned: number
  created_at: number
  changed_at: number
}

const today = () => new Date().toISOString().slice(0, 10)
const clipTitle = (title: string) => title.trim().slice(0, 160) || 'Page'
/** One emoji, or the default page mark. */
export const pageIcon = (icon: string | undefined) => {
  const value = [...(icon?.trim() ?? '')].slice(0, 2).join('')
  return value && !/[\w<>"'`]/.test(value) ? value : '📄'
}

/**
 * Pages are interactive documents the host owns instead of a thread: one id, a title and icon, versions published from
 * any thread, state shared by every device, and records, runs and grants of their own.
 */
export class PageStore {
  constructor(
    private readonly db: Db,
    private readonly interactive: InteractiveStore,
    private readonly changed: (pageId: string, run?: PageRun) => void = () => {},
  ) {}

  private row(id: string): PageRow {
    const row = this.db.prepare('SELECT * FROM interactive_pages WHERE id=?').get(id) as PageRow | undefined
    if (!row) throw new Error('Page not found. It may have been deleted.')
    return row
  }
  private info(row: PageRow): PageInfo {
    const data = JSON.parse(row.data) as PageData
    return {
      id: row.id,
      title: data.title,
      icon: data.icon,
      projectId: data.projectId,
      pinned: !!row.pinned,
      version: row.current_version,
      createdAt: row.created_at,
      changedAt: row.changed_at,
      sessionId: data.sessionId,
      capabilities: data.capabilities,
      grants: data.grants,
      pendingGrants: pendingGrants(data.capabilities, data.grants),
      ...(data.lastError ? { lastError: data.lastError } : {}),
      ...(data.grewInto ? { grewInto: data.grewInto } : {}),
      ...(data.published ? { published: data.published } : {}),
      ...(data.duplicatedFrom ? { duplicatedFrom: data.duplicatedFrom } : {}),
    }
  }
  private data(id: string): PageData {
    return JSON.parse(this.row(id).data) as PageData
  }
  private write(id: string, update: (data: PageData) => PageData, touch = true) {
    const next = update(this.data(id))
    this.db
      .prepare(`UPDATE interactive_pages SET data=?${touch ? ', changed_at=?' : ''} WHERE id=?`)
      .run(...(touch ? [JSON.stringify(next), Date.now(), id] : [JSON.stringify(next), id]))
    this.changed(id)
  }

  list(): PageInfo[] {
    return (
      this.db
        .prepare('SELECT * FROM interactive_pages ORDER BY pinned DESC, changed_at DESC LIMIT 500')
        .all() as unknown as PageRow[]
    ).map((row) => this.info(row))
  }
  get(id: string): PageInfo {
    return this.info(this.row(id))
  }
  /** Whether a page exists, without throwing; thread cards ask this to show a deleted page. */
  has(id: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM interactive_pages WHERE id=?').get(id)
  }

  /** Capabilities a document declares, read from its sources; previews call this so a bad declaration fails early. */
  capabilitiesOf(id: string, version: number): PageCapabilities {
    const document = this.document(id, version)
    return pageCapabilitiesOf({ html: document.files ? undefined : document.html, files: document.files })
  }

  /**
   * Keeps a thread's document as a page. Its versions so far become the page's, so Versions shows its whole history;
   * the thread card keeps working and points at the page from then on.
   */
  keep(
    sessionId: string,
    contentId: string,
    options: { title?: string; icon?: string; projectId?: string | null } = {},
  ) {
    if (this.has(contentId)) return this.get(contentId)
    const latest = this.interactive.latest(sessionId, contentId)
    const versions = this.db
      .prepare('SELECT version,reference,html,preview,files FROM interactive_versions WHERE id=? ORDER BY version')
      .all(contentId) as {
      version: number
      reference: string
      html: string
      preview: string | null
      files: string | null
    }[]
    const capabilities = this.declared(latest.id, latest.version, versions.at(-1)!)
    const now = Date.now()
    const data: PageData = {
      title: clipTitle(options.title ?? latest.title),
      icon: pageIcon(options.icon),
      projectId: options.projectId ?? null,
      sessionId,
      capabilities,
      grants: {},
    }
    this.db.exec('SAVEPOINT keep_page')
    try {
      this.db
        .prepare(
          'INSERT INTO interactive_pages(id,data,current_version,pinned,created_at,changed_at) VALUES(?,?,?,0,?,?)',
        )
        .run(contentId, JSON.stringify(data), latest.version, now, now)
      for (const version of versions)
        this.db
          .prepare(
            'INSERT INTO interactive_page_versions(page_id,version,reference,html,preview,files) VALUES(?,?,?,?,?,?)',
          )
          .run(
            contentId,
            version.version,
            JSON.stringify({ ...JSON.parse(version.reference), pageId: contentId }),
            version.html,
            version.preview,
            version.files,
          )
      this.db.exec('RELEASE keep_page')
    } catch (error) {
      this.db.exec('ROLLBACK TO keep_page; RELEASE keep_page')
      throw error
    }
    this.changed(contentId)
    return this.get(contentId)
  }
  private declared(_id: string, _version: number, row: { html: string; files: string | null }): PageCapabilities {
    const files = row.files ? (JSON.parse(row.files) as InteractiveDocument['files']) : undefined
    try {
      return pageCapabilitiesOf(files ? { files } : { html: row.html })
    } catch {
      return {}
    }
  }

  /** A version published from a thread with this page as its target; runs inside the publication's transaction. */
  addVersion(
    pageId: string,
    published: { reference: InteractiveReference; html: string; preview: string | null; files: string | null },
  ) {
    const capabilities = this.declared(pageId, published.reference.version, published)
    this.migrate(pageId, capabilities, false)
    this.db
      .prepare(
        'INSERT INTO interactive_page_versions(page_id,version,reference,html,preview,files) VALUES(?,?,?,?,?,?)',
      )
      .run(
        pageId,
        published.reference.version,
        JSON.stringify(published.reference),
        published.html,
        published.preview,
        published.files,
      )
    this.db
      .prepare('UPDATE interactive_pages SET current_version=?, changed_at=? WHERE id=?')
      .run(published.reference.version, Date.now(), pageId)
    this.write(pageId, (data) => ({
      ...data,
      sessionId: published.reference.sessionId,
      capabilities,
      // A version that asks for more shows the grant sheet again for what is new; what it no longer asks for is dropped.
      grants: Object.fromEntries(
        Object.entries(data.grants).filter(
          ([name]) => name in capabilities || (name === 'records' && capabilities.records),
        ),
      ) as PageGrants,
      lastError: undefined,
    }))
  }

  /**
   * Moves records to a new version's schema. A dry run reports what would not fit; a real one rewrites them. Records
   * of collections the new version drops are kept, unread, so restoring the old version brings them back.
   */
  migrate(pageId: string, capabilities: PageCapabilities, dryRun: boolean): { moved: number; problems: string[] } {
    const problems: string[] = []
    let moved = 0
    for (const [collection, schema] of Object.entries(capabilities.records ?? {})) {
      const rows = this.db
        .prepare('SELECT id,data FROM page_records WHERE page_id=? AND collection=?')
        .all(pageId, collection) as { id: string; data: string }[]
      for (const row of rows) {
        const before = JSON.parse(row.data) as Record<string, JsonValue>
        const next = migrateRecord(schema, before)
        if (next.problem) {
          if (problems.length < 5) problems.push(`${collection} ${row.id}: ${next.problem}`)
          continue
        }
        if (JSON.stringify(next.data) === row.data) continue
        moved++
        if (!dryRun)
          this.db
            .prepare('UPDATE page_records SET data=?, updated_at=? WHERE page_id=? AND collection=? AND id=?')
            .run(JSON.stringify(next.data), Date.now(), pageId, collection, row.id)
      }
    }
    if (problems.length && !dryRun)
      throw new Error(
        `Existing records do not fit the new schema: ${problems.join('; ')}. Declare a migrate rule (from or default) for these fields.`,
      )
    return { moved, problems }
  }

  versions(pageId: string): PageVersion[] {
    this.row(pageId)
    return (
      this.db
        .prepare(
          'SELECT reference,preview FROM interactive_page_versions WHERE page_id=? ORDER BY version DESC LIMIT 100',
        )
        .all(pageId) as { reference: string; preview: string | null }[]
    ).map((row) => ({ reference: JSON.parse(row.reference), preview: row.preview }))
  }
  document(pageId: string, version?: number): InteractiveDocument {
    const target = version ?? this.row(pageId).current_version
    const row = this.db
      .prepare('SELECT reference,html,preview,files FROM interactive_page_versions WHERE page_id=? AND version=?')
      .get(pageId, target) as
      { reference: string; html: string; preview: string | null; files: string | null } | undefined
    if (!row) throw new Error('Page version not found')
    return {
      reference: JSON.parse(row.reference),
      html: row.html,
      preview: row.preview,
      ...(row.files ? { files: JSON.parse(row.files) } : {}),
    }
  }

  update(id: string, patch: { title?: string; icon?: string; pinned?: boolean; projectId?: string | null }) {
    if (patch.pinned !== undefined)
      this.db.prepare('UPDATE interactive_pages SET pinned=? WHERE id=?').run(patch.pinned ? 1 : 0, id)
    this.write(
      id,
      (data) => ({
        ...data,
        ...(patch.title !== undefined ? { title: clipTitle(patch.title) } : {}),
        ...(patch.icon !== undefined ? { icon: pageIcon(patch.icon) } : {}),
        ...(patch.projectId !== undefined ? { projectId: patch.projectId } : {}),
      }),
      patch.pinned === undefined,
    )
    return this.get(id)
  }
  /** The person's action only: records, files, runs and shares go with it; thread cards say the page was deleted. */
  delete(id: string) {
    this.row(id)
    this.db.prepare('DELETE FROM interactive_pages WHERE id=?').run(id)
    this.changed(id)
  }

  /** Restores an older version as the newest, with the same tested bytes. */
  restoreVersion(pageId: string, version: number): PageInfo {
    const source = this.document(pageId, version)
    const current = this.row(pageId).current_version
    if (current === version) return this.get(pageId)
    const reference: InteractiveReference = {
      ...source.reference,
      version: current + 1,
      createdAt: Date.now(),
      changes: `Restored v${version}`,
      restoredFrom: version,
      pageId,
    }
    this.db.exec('SAVEPOINT restore_page')
    try {
      this.addVersion(pageId, {
        reference,
        html: source.html,
        preview: source.preview,
        files: source.files ? JSON.stringify(source.files) : null,
      })
      this.db.exec('RELEASE restore_page')
    } catch (error) {
      this.db.exec('ROLLBACK TO restore_page; RELEASE restore_page')
      throw error
    }
    return this.get(pageId)
  }

  /** A copy with the same code and capabilities and none of the records, state, grants or history. */
  duplicate(pageId: string, title?: string): PageInfo {
    const source = this.get(pageId)
    const document = this.document(pageId)
    const id = randomUUID()
    const now = Date.now()
    const data: PageData = {
      title: clipTitle(title ?? `${source.title} copy`),
      icon: source.icon,
      projectId: source.projectId,
      sessionId: source.sessionId,
      capabilities: source.capabilities,
      grants: {},
      duplicatedFrom: pageId,
    }
    this.db.exec('SAVEPOINT duplicate_page')
    try {
      this.db
        .prepare(
          'INSERT INTO interactive_pages(id,data,current_version,pinned,created_at,changed_at) VALUES(?,?,1,0,?,?)',
        )
        .run(id, JSON.stringify(data), now, now)
      this.db
        .prepare(
          'INSERT INTO interactive_page_versions(page_id,version,reference,html,preview,files) VALUES(?,1,?,?,?,?)',
        )
        .run(
          id,
          JSON.stringify({ ...document.reference, id, version: 1, pageId: id, createdAt: now, changes: undefined }),
          document.html,
          document.preview,
          document.files ? JSON.stringify(document.files) : null,
        )
      this.db.exec('RELEASE duplicate_page')
    } catch (error) {
      this.db.exec('ROLLBACK TO duplicate_page; RELEASE duplicate_page')
      throw error
    }
    this.changed(id)
    return this.get(id)
  }

  // Shared state

  state(pageId: string): PageState {
    this.row(pageId)
    const row = this.db.prepare('SELECT state,revision FROM interactive_page_state WHERE page_id=?').get(pageId) as
      { state: string; revision: number } | undefined
    return row
      ? { state: readInteractiveState(JSON.parse(row.state)), revision: row.revision }
      : { state: null, revision: 0 }
  }
  /**
   * Last write wins, but only over the revision the device read: a device that missed another device's change gets
   * the newer state back instead of overwriting it.
   */
  saveState(pageId: string, value: unknown, revision: number): PageState & { accepted: boolean } {
    const current = this.state(pageId)
    if (current.revision !== revision) return { ...current, accepted: false }
    const state = value === null ? null : readInteractiveState(value)
    if (value !== null && !state) throw new Error('Page state is too large or malformed.')
    const next = current.revision + 1
    this.db
      .prepare(
        'INSERT INTO interactive_page_state(page_id,state,revision,updated_at) VALUES(?,?,?,?) ON CONFLICT(page_id) DO UPDATE SET state=excluded.state, revision=excluded.revision, updated_at=excluded.updated_at',
      )
      .run(pageId, JSON.stringify(state), next, Date.now())
    this.changed(pageId)
    return { state, revision: next, accepted: true }
  }

  // Grants and usage

  grant(pageId: string, grants: PageGrants): PageInfo {
    // Only what the page declares can be allowed; anything else in the request is ignored.
    const declared = new Set<string>(declaredCapabilities(this.data(pageId).capabilities))
    grants = Object.fromEntries(Object.entries(grants).filter(([name]) => declared.has(name))) as PageGrants
    this.write(
      pageId,
      (data) => {
        const next: PageGrants = { ...data.grants, ...grants }
        if (next.ai) next.ai = { ...next.ai, daily: Math.min(PAGE_LIMITS.aiDaily, Math.max(1, next.ai.daily)) }
        if (grants.webhook === undefined && data.grants.webhook) next.webhook = data.grants.webhook
        else if (grants.webhook && typeof grants.webhook === 'object')
          next.webhook = {
            token: data.grants.webhook
              ? (data.grants.webhook as { token: string }).token
              : randomBytes(24).toString('base64url'),
          }
        return { ...data, grants: next }
      },
      false,
    )
    return this.get(pageId)
  }
  /** Refuses a capability the page did not declare or the person did not allow, in words the page can show. */
  requireGrant(pageId: string, name: keyof PageGrants): PageInfo {
    const page = this.get(pageId)
    const declared =
      name === 'records'
        ? !!page.capabilities.records
        : (page.capabilities as Record<string, unknown>)[name] !== undefined
    if (!declared) throw new Error(`This page did not declare ${name}.`)
    if (!page.grants[name]) throw new Error(`This page is not allowed to use ${name}. Allow it in Page settings.`)
    return page
  }
  usage(pageId: string): PageUsage {
    const usage = this.data(pageId).usage
    return usage?.day === today() ? usage : { day: today(), ai: 0, notify: 0 }
  }
  /** Counts one use against the day's limit, or refuses when the limit is reached. */
  spend(pageId: string, kind: 'ai' | 'notify') {
    const page = this.get(pageId)
    const usage = this.usage(pageId)
    const limit =
      kind === 'ai'
        ? (page.grants.ai?.daily ?? 0)
        : Math.min(PAGE_LIMITS.notifyDaily, page.capabilities.notify?.daily ?? PAGE_LIMITS.notifyDaily)
    if (usage[kind] >= limit)
      throw new Error(
        kind === 'ai'
          ? `This page reached its ${limit} model requests for today. Raise the limit in Page settings.`
          : 'This page has sent all its notifications for today.',
      )
    this.write(pageId, (data) => ({ ...data, usage: { ...usage, [kind]: usage[kind] + 1 } }), false)
  }

  // Records

  private collection(pageId: string, name: string) {
    const page = this.requireGrant(pageId, 'records')
    const schema = page.capabilities.records?.[name]
    if (!schema) throw new Error(`This page has no collection named ${name}.`)
    return schema
  }
  private bytes(pageId: string): number {
    const records = this.db
      .prepare('SELECT COALESCE(SUM(LENGTH(data)),0) AS n, COUNT(*) AS c FROM page_records WHERE page_id=?')
      .get(pageId) as { n: number; c: number }
    const files = this.db
      .prepare('SELECT COALESCE(SUM(LENGTH(data)),0) AS n FROM page_files WHERE page_id=?')
      .get(pageId) as { n: number }
    return records.n + files.n
  }
  private count(pageId: string): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM page_records WHERE page_id=?').get(pageId) as { n: number }).n
  }
  records(pageId: string, collection: string, query: PageRecordQuery = {}): PageRecord[] {
    this.collection(pageId, collection)
    const rows = this.db
      .prepare(
        'SELECT id,data,created_at,updated_at FROM page_records WHERE page_id=? AND collection=? ORDER BY created_at',
      )
      .all(pageId, collection) as { id: string; data: string; created_at: number; updated_at: number }[]
    let list: PageRecord[] = rows.map((row) => ({
      id: row.id,
      collection,
      data: JSON.parse(row.data),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
    const value = (record: PageRecord, field: string): JsonValue | number =>
      field === 'createdAt' ? record.createdAt : field === 'id' ? record.id : (record.data[field] ?? null)
    const comparable = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d\d-\d\d/.test(v) ? Date.parse(v) : v)
    for (const condition of query.where ?? [])
      list = list.filter((record) => {
        const left = comparable(value(record, condition.field)) as string | number
        const right = comparable(condition.value) as string | number
        switch (condition.op) {
          case '=':
            return left === right
          case '!=':
            return left !== right
          case '>':
            return left > right
          case '>=':
            return left >= right
          case '<':
            return left < right
          case '<=':
            return left <= right
          case 'contains':
            return String(left ?? '')
              .toLowerCase()
              .includes(String(right ?? '').toLowerCase())
        }
      })
    if (query.range) {
      const field = query.range.field ?? 'createdAt'
      const from = query.range.from === undefined ? -Infinity : Number(comparable(query.range.from))
      const to = query.range.to === undefined ? Infinity : Number(comparable(query.range.to))
      list = list.filter((record) => {
        const at = Number(comparable(value(record, field)))
        return at >= from && at <= to
      })
    }
    if (query.sort) {
      const direction = query.sort.direction === 'desc' ? -1 : 1
      const field = query.sort.field
      list.sort((a, b) => {
        const x = comparable(value(a, field)) as string | number,
          y = comparable(value(b, field)) as string | number
        return x === y ? 0 : x > y ? direction : -direction
      })
    }
    return list.slice(0, Math.min(query.limit ?? 1000, 1000))
  }
  /** Sums a number field, by another field when given: totals by category, the month's spending. */
  sum(pageId: string, collection: string, field: string, by?: string, query: PageRecordQuery = {}) {
    const totals: Record<string, number> = {}
    for (const record of this.records(pageId, collection, { ...query, limit: 1000 })) {
      const amount = record.data[field]
      if (typeof amount !== 'number') continue
      const key = by ? String(record.data[by] ?? '') : 'total'
      totals[key] = (totals[key] ?? 0) + amount
    }
    return totals
  }
  /** Told about records the person, an agent or a webhook added or changed, for triggers; runs change records quietly. */
  onRecord?: (pageId: string, record: PageRecord) => void
  addRecord(
    pageId: string,
    collection: string,
    data: Record<string, JsonValue>,
    options: { id?: string; quiet?: boolean } = {},
  ): PageRecord {
    const schema = this.collection(pageId, collection)
    const problem = recordProblem(schema, data)
    if (problem) throw new Error(`Record not saved: ${problem}.`)
    const text = JSON.stringify(data)
    if (text.length > 100_000) throw new Error('Record not saved: it is larger than 100 KB.')
    if (this.count(pageId) >= PAGE_LIMITS.records) throw new Error('This page already keeps 10,000 records.')
    if (this.bytes(pageId) + text.length > PAGE_LIMITS.bytes)
      throw new Error('This page already keeps 20 MB of records.')
    const now = Date.now()
    const recordId = options.id ?? randomUUID()
    this.db
      .prepare('INSERT INTO page_records(page_id,collection,id,data,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run(pageId, collection, recordId, text, now, now)
    this.changed(pageId)
    const record = { id: recordId, collection, data, createdAt: now, updatedAt: now }
    if (!options.quiet) this.onRecord?.(pageId, record)
    return record
  }
  record(pageId: string, collection: string, id: string): PageRecord | null {
    this.collection(pageId, collection)
    const row = this.db
      .prepare('SELECT data,created_at,updated_at FROM page_records WHERE page_id=? AND collection=? AND id=?')
      .get(pageId, collection, id) as { data: string; created_at: number; updated_at: number } | undefined
    return row
      ? { id, collection, data: JSON.parse(row.data), createdAt: row.created_at, updatedAt: row.updated_at }
      : null
  }
  updateRecord(
    pageId: string,
    collection: string,
    id: string,
    patch: Record<string, JsonValue>,
    options: { quiet?: boolean } = {},
  ): PageRecord {
    const schema = this.collection(pageId, collection)
    const current = this.record(pageId, collection, id)
    if (!current) throw new Error('Record not found.')
    const data = Object.fromEntries(
      Object.entries({ ...current.data, ...patch }).filter(([, value]) => value !== null),
    ) as Record<string, JsonValue>
    const problem = recordProblem(schema, data)
    if (problem) throw new Error(`Record not saved: ${problem}.`)
    const now = Date.now()
    this.db
      .prepare('UPDATE page_records SET data=?, updated_at=? WHERE page_id=? AND collection=? AND id=?')
      .run(JSON.stringify(data), now, pageId, collection, id)
    this.changed(pageId)
    const record = { ...current, data, updatedAt: now }
    if (!options.quiet) this.onRecord?.(pageId, record)
    return record
  }
  deleteRecord(pageId: string, collection: string, id: string): PageRecord | null {
    const current = this.record(pageId, collection, id)
    if (!current) return null
    this.db.prepare('DELETE FROM page_records WHERE page_id=? AND collection=? AND id=?').run(pageId, collection, id)
    this.changed(pageId)
    return current
  }
  /** Puts a record back exactly as it was, for undoing a run. */
  putRecord(pageId: string, record: PageRecord) {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO page_records(page_id,collection,id,data,created_at,updated_at) VALUES(?,?,?,?,?,?)',
      )
      .run(pageId, record.collection, record.id, JSON.stringify(record.data), record.createdAt, record.updatedAt)
  }
  /** Records as CSV per collection and one JSON document, for Export. */
  exportRecords(pageId: string): { json: string; csv: Record<string, string> } {
    const page = this.get(pageId)
    const all: Record<string, PageRecord[]> = {}
    const csv: Record<string, string> = {}
    for (const [name, schema] of Object.entries(page.capabilities.records ?? {})) {
      const list = this.db
        .prepare(
          'SELECT id,data,created_at,updated_at FROM page_records WHERE page_id=? AND collection=? ORDER BY created_at',
        )
        .all(pageId, name) as { id: string; data: string; created_at: number; updated_at: number }[]
      all[name] = list.map((row) => ({
        id: row.id,
        collection: name,
        data: JSON.parse(row.data),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }))
      const fields = Object.keys(schema.fields)
      const cell = (value: unknown) => {
        const text =
          value === undefined || value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
      }
      csv[name] = [
        ['id', ...fields].join(','),
        ...all[name]!.map((record) => [record.id, ...fields.map((field) => record.data[field])].map(cell).join(',')),
      ].join('\n')
    }
    return { json: JSON.stringify(all, null, 2), csv }
  }
  /** Adds rows from CSV with a header row; numbers and booleans follow the schema. Stops at the first bad row. */
  importCsv(pageId: string, collection: string, text: string): { added: number } {
    const schema = this.collection(pageId, collection)
    const rows = parseCsv(text)
    const header = rows.shift() ?? []
    let added = 0
    this.db.exec('SAVEPOINT import_records')
    try {
      for (const [index, row] of rows.entries()) {
        if (row.every((cell) => !cell.trim())) continue
        const data: Record<string, JsonValue> = {}
        header.forEach((name, column) => {
          const type = schema.fields[name]?.replace('?', '')
          const raw = row[column] ?? ''
          if (!type || raw === '') return
          data[name] = type === 'number' ? Number(raw) : type === 'boolean' ? raw.toLowerCase() === 'true' : raw
        })
        try {
          this.addRecord(pageId, collection, data)
        } catch (error) {
          throw new Error(`Row ${index + 2}: ${(error as Error).message}`, { cause: error })
        }
        added++
      }
      this.db.exec('RELEASE import_records')
    } catch (error) {
      this.db.exec('ROLLBACK TO import_records; RELEASE import_records')
      throw error
    }
    return { added }
  }

  // Files the person chose (photos of receipts, labels)

  addFile(pageId: string, dataUrl: string): string {
    this.requireGrant(pageId, 'camera')
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
    if (!match) throw new Error('Only JPEG, PNG and WebP photos can be kept.')
    const bytes = Buffer.from(match[2]!, 'base64')
    if (bytes.length > PAGE_LIMITS.file) throw new Error('That photo is larger than 2 MB after resizing.')
    if (this.bytes(pageId) + bytes.length > PAGE_LIMITS.bytes) throw new Error('This page already keeps 20 MB.')
    const id = randomUUID()
    this.db
      .prepare('INSERT INTO page_files(page_id,id,mime,data,created_at) VALUES(?,?,?,?,?)')
      .run(pageId, id, match[1]!, stripJpegMetadata(bytes, match[1]!), Date.now())
    return `ramu-file:${id}`
  }
  file(pageId: string, ref: string): string {
    const id = ref.replace(/^ramu-file:/, '')
    const row = this.db.prepare('SELECT mime,data FROM page_files WHERE page_id=? AND id=?').get(pageId, id) as
      { mime: string; data: Uint8Array } | undefined
    if (!row) throw new Error('File not found.')
    return `data:${row.mime};base64,${Buffer.from(row.data).toString('base64')}`
  }

  // Errors reported by any device, for Fix this

  reportError(pageId: string, error: Omit<PageError, 'at'>) {
    this.write(
      pageId,
      (data) => ({
        ...data,
        lastError: {
          ...error,
          message: error.message.slice(0, 1000),
          steps: error.steps?.slice(-20).map((step) => step.slice(0, 200)),
          at: Date.now(),
        },
      }),
      false,
    )
  }
  clearError(pageId: string) {
    this.write(pageId, (data) => ({ ...data, lastError: undefined }), false)
  }

  // Runs

  saveRun(run: PageRun & { undo?: PageUndo[] }) {
    const existing = this.db.prepare('SELECT data FROM page_runs WHERE id=?').get(run.id) as
      { data: string } | undefined
    // A call or confirmation is a moment in the run, not part of its record; the undo log stays on the host.
    const { call: _call, confirm: _confirm, ...kept } = run
    void _call
    void _confirm
    const stored = {
      ...kept,
      undo: run.undo ?? (existing ? (JSON.parse(existing.data) as { undo?: PageUndo[] }).undo : undefined),
    }
    this.db
      .prepare('INSERT OR REPLACE INTO page_runs(id,page_id,data,created_at) VALUES(?,?,?,?)')
      .run(run.id, run.pageId, JSON.stringify(stored), run.startedAt)
    this.db
      .prepare(
        'DELETE FROM page_runs WHERE page_id=? AND id NOT IN (SELECT id FROM page_runs WHERE page_id=? ORDER BY created_at DESC LIMIT 50)',
      )
      .run(run.pageId, run.pageId)
    const { undo: _undo, ...visible } = run
    void _undo
    this.changed(run.pageId, visible)
  }
  runs(pageId: string): PageRun[] {
    this.row(pageId)
    return (
      this.db.prepare('SELECT data FROM page_runs WHERE page_id=? ORDER BY created_at DESC LIMIT 50').all(pageId) as {
        data: string
      }[]
    ).map((row) => {
      const { undo: _undo, ...run } = JSON.parse(row.data) as PageRun & { undo?: PageUndo[] }
      void _undo
      return run
    })
  }
  run(id: string): PageRun & { undo?: PageUndo[] } {
    const row = this.db.prepare('SELECT data FROM page_runs WHERE id=?').get(id) as { data: string } | undefined
    if (!row) throw new Error('Run not found.')
    return JSON.parse(row.data)
  }
  /** Puts back every record a run changed, newest change first, as one step. */
  undoRun(id: string): PageRun {
    const run = this.run(id)
    if (run.status === 'undone') return run
    if (run.status === 'running') throw new Error('Stop the run before undoing it.')
    this.db.exec('SAVEPOINT undo_run')
    try {
      for (const change of [...(run.undo ?? [])].reverse()) {
        if (change.before) this.putRecord(run.pageId, change.before)
        else
          this.db
            .prepare('DELETE FROM page_records WHERE page_id=? AND collection=? AND id=?')
            .run(run.pageId, change.collection, change.id)
      }
      this.db.exec('RELEASE undo_run')
    } catch (error) {
      this.db.exec('ROLLBACK TO undo_run; RELEASE undo_run')
      throw error
    }
    const next = { ...run, status: 'undone' as const }
    this.saveRun(next)
    return next
  }

  // Share links

  share(pageId: string, canAdd: boolean): PageShare {
    this.row(pageId)
    const token = randomBytes(18).toString('base64url')
    const now = Date.now()
    const share: PageShare = { token, pageId, canAdd, createdAt: now, expiresAt: now + 30 * 86_400_000 }
    this.db
      .prepare('INSERT INTO page_shares(token,page_id,data,created_at,expires_at) VALUES(?,?,?,?,?)')
      .run(token, pageId, JSON.stringify({ canAdd }), now, share.expiresAt)
    return share
  }
  shares(pageId: string): PageShare[] {
    return (
      this.db
        .prepare(
          'SELECT token,page_id,data,created_at,expires_at FROM page_shares WHERE page_id=? AND expires_at>? ORDER BY created_at DESC',
        )
        .all(pageId, Date.now()) as {
        token: string
        page_id: string
        data: string
        created_at: number
        expires_at: number
      }[]
    ).map((row) => ({
      token: row.token,
      pageId: row.page_id,
      canAdd: !!(JSON.parse(row.data) as { canAdd?: boolean }).canAdd,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    }))
  }
  renewShare(token: string): PageShare {
    this.db.prepare('UPDATE page_shares SET expires_at=? WHERE token=?').run(Date.now() + 30 * 86_400_000, token)
    return this.resolveShare(token)
  }
  revokeShare(token: string) {
    this.db.prepare('DELETE FROM page_shares WHERE token=?').run(token)
  }
  /** A live share link, or an error a viewer can read. */
  resolveShare(token: string): PageShare {
    const row = this.db
      .prepare('SELECT token,page_id,data,created_at,expires_at FROM page_shares WHERE token=?')
      .get(token) as
      { token: string; page_id: string; data: string; created_at: number; expires_at: number } | undefined
    if (!row || row.expires_at <= Date.now()) throw new Error('This share link expired or was revoked.')
    return {
      token: row.token,
      pageId: row.page_id,
      canAdd: !!(JSON.parse(row.data) as { canAdd?: boolean }).canAdd,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    }
  }

  markPublished(pageId: string, published: NonNullable<PageInfo['published']>) {
    this.write(pageId, (data) => ({ ...data, published }), false)
  }
  markGrewInto(pageId: string, grewInto: NonNullable<PageInfo['grewInto']>) {
    this.write(pageId, (data) => ({ ...data, grewInto }), false)
  }
}

/** One record change a run made: the record before it (none when the run added it). */
export interface PageUndo {
  collection: string
  id: string
  before: PageRecord | null
}

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"') quoted = true
    else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += char
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.slice(0, PAGE_LIMITS.records + 1)
}

/** Drops JPEG APP1 (EXIF, which carries location) segments; other formats are stored as given. */
export function stripJpegMetadata(bytes: Buffer, mime: string): Buffer {
  if (mime !== 'image/jpeg' || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes
  const parts: Buffer[] = [bytes.subarray(0, 2)]
  let offset = 2
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1]!
    if (marker === 0xda) break
    const length = bytes.readUInt16BE(offset + 2)
    if (marker !== 0xe1) parts.push(bytes.subarray(offset, offset + 2 + length))
    offset += 2 + length
  }
  parts.push(bytes.subarray(offset))
  return Buffer.concat(parts)
}
