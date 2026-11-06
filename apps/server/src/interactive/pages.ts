import { randomBytes, randomUUID } from 'node:crypto'
import type { Db } from '../db'
import type { InteractiveDocument, InteractiveReference, JsonValue } from '@ramu/shared/interactive'
import { interactiveOrigin, readInteractiveState } from '@ramu/shared/interactive'
import {
  ARTIFACT_LIMITS,
  artifactKind,
  declaredCapabilities,
  migrateRecord,
  pendingGrants,
  recordProblem,
  type ArtifactCapabilities,
  type ArtifactError,
  type ArtifactGrants,
  type ArtifactInfo,
  type ArtifactRecord,
  type ArtifactRecordQuery,
  type ArtifactRun,
  type ArtifactShare,
  type ArtifactState,
  type ArtifactUsage,
  type ArtifactVersion,
} from '@ramu/shared/artifacts'
import { pageCapabilitiesOf } from './capabilities'
import type { InteractiveStore } from './store'

/** What a page row keeps beside its columns. */
interface PageData {
  title: string
  icon: string
  projectId: string | null
  sessionId: string
  capabilities: ArtifactCapabilities
  grants: ArtifactGrants
  lastError?: ArtifactError
  grewInto?: ArtifactInfo['grewInto']
  published?: ArtifactInfo['published']
  duplicatedFrom?: string
  usage?: ArtifactUsage
}
interface PageRow {
  id: string
  kind: string
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
    private readonly changed: (artifactId: string, run?: ArtifactRun) => void = () => {},
  ) {}

  private row(id: string): PageRow {
    const row = this.db.prepare('SELECT * FROM artifacts WHERE id=?').get(id) as PageRow | undefined
    if (!row) throw new Error('Page not found. It may have been deleted.')
    return row
  }
  private info(row: PageRow): ArtifactInfo {
    const data = JSON.parse(row.data) as PageData
    return {
      id: row.id,
      kind: artifactKind(row.kind),
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
      .prepare(`UPDATE artifacts SET data=?${touch ? ', changed_at=?' : ''} WHERE id=?`)
      .run(...(touch ? [JSON.stringify(next), Date.now(), id] : [JSON.stringify(next), id]))
    this.changed(id)
  }

  list(): ArtifactInfo[] {
    return (
      this.db
        .prepare('SELECT * FROM artifacts ORDER BY pinned DESC, changed_at DESC LIMIT 500')
        .all() as unknown as PageRow[]
    ).map((row) => this.info(row))
  }
  get(id: string): ArtifactInfo {
    return this.info(this.row(id))
  }
  /** Whether a page exists, without throwing; thread cards ask this to show a deleted page. */
  has(id: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM artifacts WHERE id=?').get(id)
  }

  /** Capabilities a document declares, read from its sources; previews call this so a bad declaration fails early. */
  capabilitiesOf(id: string, version: number): ArtifactCapabilities {
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
          'INSERT INTO artifacts(id,kind,data,current_version,pinned,created_at,changed_at) VALUES(?,?,?,?,0,?,?)',
        )
        .run(contentId, latest.kind ?? 'app', JSON.stringify(data), latest.version, now, now)
      for (const version of versions)
        this.db
          .prepare(
            'INSERT INTO artifact_versions(artifact_id,version,reference,html,preview,files) VALUES(?,?,?,?,?,?)',
          )
          .run(
            contentId,
            version.version,
            JSON.stringify({ ...JSON.parse(version.reference), artifactId: contentId }),
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
  private declared(_id: string, _version: number, row: { html: string; files: string | null }): ArtifactCapabilities {
    const files = row.files ? (JSON.parse(row.files) as InteractiveDocument['files']) : undefined
    try {
      return pageCapabilitiesOf(files ? { files } : { html: row.html })
    } catch {
      return {}
    }
  }

  /** A version published from a thread with this page as its target; runs inside the publication's transaction. */
  addVersion(
    artifactId: string,
    published: { reference: InteractiveReference; html: string; preview: string | null; files: string | null },
  ) {
    const capabilities = this.declared(artifactId, published.reference.version, published)
    this.migrate(artifactId, capabilities, false)
    this.db
      .prepare('INSERT INTO artifact_versions(artifact_id,version,reference,html,preview,files) VALUES(?,?,?,?,?,?)')
      .run(
        artifactId,
        published.reference.version,
        JSON.stringify(published.reference),
        published.html,
        published.preview,
        published.files,
      )
    this.db
      .prepare('UPDATE artifacts SET kind=?, current_version=?, changed_at=? WHERE id=?')
      .run(published.reference.kind ?? 'app', published.reference.version, Date.now(), artifactId)
    this.write(artifactId, (data) => ({
      ...data,
      sessionId: published.reference.sessionId,
      capabilities,
      // A version that asks for more shows the grant sheet again for what is new; what it no longer asks for is dropped.
      grants: Object.fromEntries(
        Object.entries(data.grants).filter(
          ([name]) => name in capabilities || (name === 'records' && capabilities.records),
        ),
      ) as ArtifactGrants,
      lastError: undefined,
    }))
  }

  /**
   * Moves records to a new version's schema. A dry run reports what would not fit; a real one rewrites them. Records
   * of collections the new version drops are kept, unread, so restoring the old version brings them back.
   */
  migrate(
    artifactId: string,
    capabilities: ArtifactCapabilities,
    dryRun: boolean,
  ): { moved: number; problems: string[] } {
    const problems: string[] = []
    let moved = 0
    for (const [collection, schema] of Object.entries(capabilities.records ?? {})) {
      const rows = this.db
        .prepare('SELECT id,data FROM artifact_records WHERE artifact_id=? AND collection=?')
        .all(artifactId, collection) as { id: string; data: string }[]
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
            .prepare('UPDATE artifact_records SET data=?, updated_at=? WHERE artifact_id=? AND collection=? AND id=?')
            .run(JSON.stringify(next.data), Date.now(), artifactId, collection, row.id)
      }
    }
    if (problems.length && !dryRun)
      throw new Error(
        `Existing records do not fit the new schema: ${problems.join('; ')}. Declare a migrate rule (from or default) for these fields.`,
      )
    return { moved, problems }
  }

  versions(artifactId: string): ArtifactVersion[] {
    this.row(artifactId)
    return (
      this.db
        .prepare(
          'SELECT v.reference, v.preview, m.wide FROM artifact_versions v LEFT JOIN interactive_media m ON m.id=v.artifact_id AND m.version=v.version WHERE v.artifact_id=? ORDER BY v.version DESC LIMIT 100',
        )
        .all(artifactId) as { reference: string; preview: string | null; wide: string | null }[]
    ).map((row) => ({ reference: JSON.parse(row.reference), preview: row.preview, wide: row.wide }))
  }
  document(artifactId: string, version?: number): InteractiveDocument {
    const target = version ?? this.row(artifactId).current_version
    const row = this.db
      .prepare('SELECT reference,html,preview,files FROM artifact_versions WHERE artifact_id=? AND version=?')
      .get(artifactId, target) as
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
      this.db.prepare('UPDATE artifacts SET pinned=? WHERE id=?').run(patch.pinned ? 1 : 0, id)
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
    this.db.prepare('DELETE FROM artifacts WHERE id=?').run(id)
    this.changed(id)
  }

  /** Restores an older version as the newest, with the same tested bytes. */
  restoreVersion(artifactId: string, version: number): ArtifactInfo {
    const source = this.document(artifactId, version)
    const current = this.row(artifactId).current_version
    if (current === version) return this.get(artifactId)
    const reference: InteractiveReference = {
      ...source.reference,
      version: current + 1,
      createdAt: Date.now(),
      changes: `Restored v${version}`,
      restoredFrom: version,
      artifactId,
    }
    this.db.exec('SAVEPOINT restore_page')
    try {
      this.addVersion(artifactId, {
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
    return this.get(artifactId)
  }

  /** A copy with the same code and capabilities and none of the records, state, grants or history. */
  duplicate(artifactId: string, title?: string): ArtifactInfo {
    const source = this.get(artifactId)
    const document = this.document(artifactId)
    const id = randomUUID()
    const now = Date.now()
    const data: PageData = {
      title: clipTitle(title ?? `${source.title} copy`),
      icon: source.icon,
      projectId: source.projectId,
      sessionId: source.sessionId,
      capabilities: source.capabilities,
      grants: {},
      duplicatedFrom: artifactId,
    }
    this.db.exec('SAVEPOINT duplicate_page')
    try {
      this.db
        .prepare(
          'INSERT INTO artifacts(id,kind,data,current_version,pinned,created_at,changed_at) VALUES(?,?,?,1,0,?,?)',
        )
        .run(id, source.kind, JSON.stringify(data), now, now)
      this.db
        .prepare('INSERT INTO artifact_versions(artifact_id,version,reference,html,preview,files) VALUES(?,1,?,?,?,?)')
        .run(
          id,
          JSON.stringify({ ...document.reference, id, version: 1, artifactId: id, createdAt: now, changes: undefined }),
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

  /**
   * A copy of a page another host shared: its code, capabilities and screenshot as a new page here, with none of its
   * records, values, grants or history. The bytes still run only in the sandboxed frame, and every capability asks again.
   */
  importPage(document: InteractiveDocument, from: { title: string; icon: string }): ArtifactInfo {
    const id = randomUUID()
    const now = Date.now()
    const network = {
      resources: document.reference.network.resources.map(interactiveOrigin).slice(0, 12),
      connect: document.reference.network.connect.map(interactiveOrigin).slice(0, 12),
    }
    const files = document.files ? JSON.stringify(document.files) : null
    const capabilities = this.declared(id, 1, { html: document.html, files })
    // The kind comes from another host's answer, so only a kind this build knows is kept.
    const kind = artifactKind(document.reference.kind)
    const reference: InteractiveReference = {
      id,
      version: 1,
      sessionId: '',
      title: clipTitle(from.title),
      summary: document.reference.summary.slice(0, 3000),
      digest: document.reference.digest.slice(0, 128),
      createdAt: now,
      checked: false,
      network,
      artifactId: id,
      ...(document.reference.files ? { files: document.reference.files.slice(0, 40) } : {}),
      ...(document.reference.libraries ? { libraries: document.reference.libraries } : {}),
      ...(kind !== 'app' ? { kind } : {}),
    }
    const data: PageData = {
      title: clipTitle(from.title),
      icon: pageIcon(from.icon),
      projectId: null,
      sessionId: '',
      capabilities,
      grants: {},
    }
    this.db.exec('SAVEPOINT import_page')
    try {
      this.db
        .prepare(
          'INSERT INTO artifacts(id,kind,data,current_version,pinned,created_at,changed_at) VALUES(?,?,?,1,0,?,?)',
        )
        .run(id, reference.kind ?? 'app', JSON.stringify(data), now, now)
      this.db
        .prepare('INSERT INTO artifact_versions(artifact_id,version,reference,html,preview,files) VALUES(?,1,?,?,?,?)')
        .run(id, JSON.stringify(reference), document.html, document.preview, files)
      this.db.exec('RELEASE import_page')
    } catch (error) {
      this.db.exec('ROLLBACK TO import_page; RELEASE import_page')
      throw error
    }
    this.changed(id)
    return this.get(id)
  }

  // Shared state

  state(artifactId: string): ArtifactState {
    this.row(artifactId)
    const row = this.db.prepare('SELECT state,revision FROM artifact_state WHERE artifact_id=?').get(artifactId) as
      { state: string; revision: number } | undefined
    return row
      ? { state: readInteractiveState(JSON.parse(row.state)), revision: row.revision }
      : { state: null, revision: 0 }
  }
  /**
   * Last write wins, but only over the revision the device read: a device that missed another device's change gets
   * the newer state back instead of overwriting it.
   */
  saveState(artifactId: string, value: unknown, revision: number): ArtifactState & { accepted: boolean } {
    const current = this.state(artifactId)
    if (current.revision !== revision) return { ...current, accepted: false }
    const state = value === null ? null : readInteractiveState(value)
    if (value !== null && !state) throw new Error('Page state is too large or malformed.')
    const next = current.revision + 1
    this.db
      .prepare(
        'INSERT INTO artifact_state(artifact_id,state,revision,updated_at) VALUES(?,?,?,?) ON CONFLICT(artifact_id) DO UPDATE SET state=excluded.state, revision=excluded.revision, updated_at=excluded.updated_at',
      )
      .run(artifactId, JSON.stringify(state), next, Date.now())
    this.changed(artifactId)
    return { state, revision: next, accepted: true }
  }

  // Grants and usage

  grant(artifactId: string, grants: ArtifactGrants): ArtifactInfo {
    // Only what the page declares can be allowed; anything else in the request is ignored.
    const declared = new Set<string>(declaredCapabilities(this.data(artifactId).capabilities))
    grants = Object.fromEntries(Object.entries(grants).filter(([name]) => declared.has(name))) as ArtifactGrants
    this.write(
      artifactId,
      (data) => {
        const next: ArtifactGrants = { ...data.grants, ...grants }
        if (next.ai) next.ai = { ...next.ai, daily: Math.min(ARTIFACT_LIMITS.aiDaily, Math.max(1, next.ai.daily)) }
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
    return this.get(artifactId)
  }
  /** Refuses a capability the page did not declare or the person did not allow, in words the page can show. */
  requireGrant(artifactId: string, name: keyof ArtifactGrants): ArtifactInfo {
    const page = this.get(artifactId)
    const declared =
      name === 'records'
        ? !!page.capabilities.records
        : (page.capabilities as Record<string, unknown>)[name] !== undefined
    if (!declared) throw new Error(`This page did not declare ${name}.`)
    if (!page.grants[name]) throw new Error(`This page is not allowed to use ${name}. Allow it in Page settings.`)
    return page
  }
  usage(artifactId: string): ArtifactUsage {
    const usage = this.data(artifactId).usage
    return usage?.day === today() ? usage : { day: today(), ai: 0, notify: 0 }
  }
  /** Counts one use against the day's limit, or refuses when the limit is reached. */
  spend(artifactId: string, kind: 'ai' | 'notify') {
    const page = this.get(artifactId)
    const usage = this.usage(artifactId)
    const limit =
      kind === 'ai'
        ? page.grants.ai
          ? page.grants.ai.daily
          : 0
        : Math.min(ARTIFACT_LIMITS.notifyDaily, page.capabilities.notify?.daily ?? ARTIFACT_LIMITS.notifyDaily)
    if (usage[kind] >= limit)
      throw new Error(
        kind === 'ai'
          ? `This page reached its ${limit} model requests for today. Raise the limit in Page settings.`
          : 'This page has sent all its notifications for today.',
      )
    this.write(artifactId, (data) => ({ ...data, usage: { ...usage, [kind]: usage[kind] + 1 } }), false)
  }

  // Records

  private collection(artifactId: string, name: string) {
    const page = this.requireGrant(artifactId, 'records')
    const schema = page.capabilities.records?.[name]
    if (!schema) throw new Error(`This page has no collection named ${name}.`)
    return schema
  }
  private bytes(artifactId: string): number {
    const records = this.db
      .prepare('SELECT COALESCE(SUM(LENGTH(data)),0) AS n, COUNT(*) AS c FROM artifact_records WHERE artifact_id=?')
      .get(artifactId) as { n: number; c: number }
    const files = this.db
      .prepare('SELECT COALESCE(SUM(LENGTH(data)),0) AS n FROM artifact_files WHERE artifact_id=?')
      .get(artifactId) as { n: number }
    return records.n + files.n
  }
  private count(artifactId: string): number {
    return (
      this.db.prepare('SELECT COUNT(*) AS n FROM artifact_records WHERE artifact_id=?').get(artifactId) as { n: number }
    ).n
  }
  records(artifactId: string, collection: string, query: ArtifactRecordQuery = {}): ArtifactRecord[] {
    this.collection(artifactId, collection)
    const rows = this.db
      .prepare(
        'SELECT id,data,created_at,updated_at FROM artifact_records WHERE artifact_id=? AND collection=? ORDER BY created_at',
      )
      .all(artifactId, collection) as { id: string; data: string; created_at: number; updated_at: number }[]
    let list: ArtifactRecord[] = rows.map((row) => ({
      id: row.id,
      collection,
      data: JSON.parse(row.data),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
    const value = (record: ArtifactRecord, field: string): JsonValue | number =>
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
  sum(artifactId: string, collection: string, field: string, by?: string, query: ArtifactRecordQuery = {}) {
    const totals: Record<string, number> = {}
    for (const record of this.records(artifactId, collection, { ...query, limit: 1000 })) {
      const amount = record.data[field]
      if (typeof amount !== 'number') continue
      const key = by ? String(record.data[by] ?? '') : 'total'
      totals[key] = (totals[key] ?? 0) + amount
    }
    return totals
  }
  /** Told about records the person, an agent or a webhook added or changed, for triggers; runs change records quietly. */
  onRecord?: (artifactId: string, record: ArtifactRecord) => void
  addRecord(
    artifactId: string,
    collection: string,
    data: Record<string, JsonValue>,
    options: { id?: string; quiet?: boolean } = {},
  ): ArtifactRecord {
    const schema = this.collection(artifactId, collection)
    const problem = recordProblem(schema, data)
    if (problem) throw new Error(`Record not saved: ${problem}.`)
    const text = JSON.stringify(data)
    if (text.length > 100_000) throw new Error('Record not saved: it is larger than 100 KB.')
    if (this.count(artifactId) >= ARTIFACT_LIMITS.records) throw new Error('This page already keeps 10,000 records.')
    if (this.bytes(artifactId) + text.length > ARTIFACT_LIMITS.bytes)
      throw new Error('This page already keeps 20 MB of records.')
    const now = Date.now()
    const recordId = options.id ?? randomUUID()
    this.db
      .prepare('INSERT INTO artifact_records(artifact_id,collection,id,data,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run(artifactId, collection, recordId, text, now, now)
    this.changed(artifactId)
    const record = { id: recordId, collection, data, createdAt: now, updatedAt: now }
    if (!options.quiet) this.onRecord?.(artifactId, record)
    return record
  }
  record(artifactId: string, collection: string, id: string): ArtifactRecord | null {
    this.collection(artifactId, collection)
    const row = this.db
      .prepare('SELECT data,created_at,updated_at FROM artifact_records WHERE artifact_id=? AND collection=? AND id=?')
      .get(artifactId, collection, id) as { data: string; created_at: number; updated_at: number } | undefined
    return row
      ? { id, collection, data: JSON.parse(row.data), createdAt: row.created_at, updatedAt: row.updated_at }
      : null
  }
  updateRecord(
    artifactId: string,
    collection: string,
    id: string,
    patch: Record<string, JsonValue>,
    options: { quiet?: boolean } = {},
  ): ArtifactRecord {
    const schema = this.collection(artifactId, collection)
    const current = this.record(artifactId, collection, id)
    if (!current) throw new Error('Record not found.')
    const data = Object.fromEntries(
      Object.entries({ ...current.data, ...patch }).filter(([, value]) => value !== null),
    ) as Record<string, JsonValue>
    const problem = recordProblem(schema, data)
    if (problem) throw new Error(`Record not saved: ${problem}.`)
    const now = Date.now()
    this.db
      .prepare('UPDATE artifact_records SET data=?, updated_at=? WHERE artifact_id=? AND collection=? AND id=?')
      .run(JSON.stringify(data), now, artifactId, collection, id)
    this.changed(artifactId)
    const record = { ...current, data, updatedAt: now }
    if (!options.quiet) this.onRecord?.(artifactId, record)
    return record
  }
  deleteRecord(artifactId: string, collection: string, id: string): ArtifactRecord | null {
    const current = this.record(artifactId, collection, id)
    if (!current) return null
    this.db
      .prepare('DELETE FROM artifact_records WHERE artifact_id=? AND collection=? AND id=?')
      .run(artifactId, collection, id)
    this.changed(artifactId)
    return current
  }
  /** Puts a record back exactly as it was, for undoing a run. */
  putRecord(artifactId: string, record: ArtifactRecord) {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO artifact_records(artifact_id,collection,id,data,created_at,updated_at) VALUES(?,?,?,?,?,?)',
      )
      .run(artifactId, record.collection, record.id, JSON.stringify(record.data), record.createdAt, record.updatedAt)
  }
  /** Records as CSV per collection and one JSON document, for Export. */
  exportRecords(artifactId: string): { json: string; csv: Record<string, string> } {
    const page = this.get(artifactId)
    const all: Record<string, ArtifactRecord[]> = {}
    const csv: Record<string, string> = {}
    for (const [name, schema] of Object.entries(page.capabilities.records ?? {})) {
      const list = this.db
        .prepare(
          'SELECT id,data,created_at,updated_at FROM artifact_records WHERE artifact_id=? AND collection=? ORDER BY created_at',
        )
        .all(artifactId, name) as { id: string; data: string; created_at: number; updated_at: number }[]
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
  importCsv(artifactId: string, collection: string, text: string): { added: number } {
    const schema = this.collection(artifactId, collection)
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
          this.addRecord(artifactId, collection, data)
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

  addFile(artifactId: string, dataUrl: string): string {
    this.requireGrant(artifactId, 'camera')
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
    if (!match) throw new Error('Only JPEG, PNG and WebP photos can be kept.')
    const bytes = Buffer.from(match[2]!, 'base64')
    if (bytes.length > ARTIFACT_LIMITS.file) throw new Error('That photo is larger than 2 MB after resizing.')
    if (this.bytes(artifactId) + bytes.length > ARTIFACT_LIMITS.bytes) throw new Error('This page already keeps 20 MB.')
    const id = randomUUID()
    this.db
      .prepare('INSERT INTO artifact_files(artifact_id,id,mime,data,created_at) VALUES(?,?,?,?,?)')
      .run(artifactId, id, match[1]!, stripJpegMetadata(bytes, match[1]!), Date.now())
    return `ramu-file:${id}`
  }
  file(artifactId: string, ref: string): string {
    const id = ref.replace(/^ramu-file:/, '')
    const row = this.db
      .prepare('SELECT mime,data FROM artifact_files WHERE artifact_id=? AND id=?')
      .get(artifactId, id) as { mime: string; data: Uint8Array } | undefined
    if (!row) throw new Error('File not found.')
    return `data:${row.mime};base64,${Buffer.from(row.data).toString('base64')}`
  }

  // Errors reported by any device, for Fix this

  reportError(artifactId: string, error: Omit<ArtifactError, 'at'>) {
    this.write(
      artifactId,
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
  clearError(artifactId: string) {
    this.write(artifactId, (data) => ({ ...data, lastError: undefined }), false)
  }

  // Runs

  saveRun(run: ArtifactRun & { undo?: PageUndo[] }) {
    const existing = this.db.prepare('SELECT data FROM artifact_runs WHERE id=?').get(run.id) as
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
      .prepare('INSERT OR REPLACE INTO artifact_runs(id,artifact_id,data,created_at) VALUES(?,?,?,?)')
      .run(run.id, run.artifactId, JSON.stringify(stored), run.startedAt)
    this.db
      .prepare(
        'DELETE FROM artifact_runs WHERE artifact_id=? AND id NOT IN (SELECT id FROM artifact_runs WHERE artifact_id=? ORDER BY created_at DESC LIMIT 50)',
      )
      .run(run.artifactId, run.artifactId)
    const { undo: _undo, ...visible } = run
    void _undo
    this.changed(run.artifactId, visible)
  }
  runs(artifactId: string): ArtifactRun[] {
    this.row(artifactId)
    return (
      this.db
        .prepare('SELECT data FROM artifact_runs WHERE artifact_id=? ORDER BY created_at DESC LIMIT 50')
        .all(artifactId) as {
        data: string
      }[]
    ).map((row) => {
      const { undo: _undo, ...run } = JSON.parse(row.data) as ArtifactRun & { undo?: PageUndo[] }
      void _undo
      return run
    })
  }
  run(id: string): ArtifactRun & { undo?: PageUndo[] } {
    const row = this.db.prepare('SELECT data FROM artifact_runs WHERE id=?').get(id) as { data: string } | undefined
    if (!row) throw new Error('Run not found.')
    return JSON.parse(row.data)
  }
  /** Puts back every record a run changed, newest change first, as one step. */
  undoRun(id: string): ArtifactRun {
    const run = this.run(id)
    if (run.status === 'undone') return run
    if (run.status === 'running') throw new Error('Stop the run before undoing it.')
    this.db.exec('SAVEPOINT undo_run')
    try {
      for (const change of [...(run.undo ?? [])].reverse()) {
        if (change.before) this.putRecord(run.artifactId, change.before)
        else
          this.db
            .prepare('DELETE FROM artifact_records WHERE artifact_id=? AND collection=? AND id=?')
            .run(run.artifactId, change.collection, change.id)
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

  share(artifactId: string, canAdd: boolean): ArtifactShare {
    this.row(artifactId)
    const token = randomBytes(18).toString('base64url')
    const now = Date.now()
    const share: ArtifactShare = { token, artifactId, canAdd, createdAt: now, expiresAt: now + 30 * 86_400_000 }
    this.db
      .prepare('INSERT INTO artifact_shares(token,artifact_id,data,created_at,expires_at) VALUES(?,?,?,?,?)')
      .run(token, artifactId, JSON.stringify({ canAdd }), now, share.expiresAt)
    return share
  }
  shares(artifactId: string): ArtifactShare[] {
    return (
      this.db
        .prepare(
          'SELECT token,artifact_id,data,created_at,expires_at FROM artifact_shares WHERE artifact_id=? AND expires_at>? ORDER BY created_at DESC',
        )
        .all(artifactId, Date.now()) as {
        token: string
        artifact_id: string
        data: string
        created_at: number
        expires_at: number
      }[]
    ).map((row) => ({
      token: row.token,
      artifactId: row.artifact_id,
      canAdd: !!(JSON.parse(row.data) as { canAdd?: boolean }).canAdd,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    }))
  }
  renewShare(token: string): ArtifactShare {
    this.db.prepare('UPDATE artifact_shares SET expires_at=? WHERE token=?').run(Date.now() + 30 * 86_400_000, token)
    return this.resolveShare(token)
  }
  revokeShare(token: string) {
    this.db.prepare('DELETE FROM artifact_shares WHERE token=?').run(token)
  }
  /** A live share link, or an error a viewer can read. */
  resolveShare(token: string): ArtifactShare {
    const row = this.db
      .prepare('SELECT token,artifact_id,data,created_at,expires_at FROM artifact_shares WHERE token=?')
      .get(token) as
      { token: string; artifact_id: string; data: string; created_at: number; expires_at: number } | undefined
    if (!row || row.expires_at <= Date.now()) throw new Error('This share link expired or was revoked.')
    return {
      token: row.token,
      artifactId: row.artifact_id,
      canAdd: !!(JSON.parse(row.data) as { canAdd?: boolean }).canAdd,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    }
  }

  markPublished(artifactId: string, published: NonNullable<ArtifactInfo['published']>) {
    this.write(artifactId, (data) => ({ ...data, published }), false)
  }
  markGrewInto(artifactId: string, grewInto: NonNullable<ArtifactInfo['grewInto']>) {
    this.write(artifactId, (data) => ({ ...data, grewInto }), false)
  }
}

/** One record change a run made: the record before it (none when the run added it). */
export interface PageUndo {
  collection: string
  id: string
  before: ArtifactRecord | null
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
  return rows.slice(0, ARTIFACT_LIMITS.records + 1)
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
