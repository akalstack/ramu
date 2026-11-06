import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Db } from '../db'
import type { InteractiveDocument, InteractivePreview, InteractiveReference } from '@ramu/shared/interactive'
import {
  INTERACTIVE_MAX_FILES,
  INTERACTIVE_MAX_HTML,
  interactiveOrigin,
  OFFLINE_NETWORK,
} from '@ramu/shared/interactive'
import { previewInteractive } from './preview'
import { bundleInteractive } from './bundle'
import { resolveInteractiveKit } from './kit'
import { compileInteractive, INTERACTIVE_MAX_ARTIFACT } from './compile'

export const interactiveInput = z.object({
  network: z
    .object({
      resources: z
        .array(
          z
            .string()
            .max(250)
            .transform((value, ctx) => {
              try {
                return interactiveOrigin(value)
              } catch {
                ctx.addIssue({ code: 'custom', message: 'Use an exact public HTTPS origin.' })
                return z.NEVER
              }
            }),
        )
        .max(12)
        .default([]),
      connect: z
        .array(
          z
            .string()
            .max(250)
            .transform((value, ctx) => {
              try {
                return interactiveOrigin(value)
              } catch {
                ctx.addIssue({ code: 'custom', message: 'Use an exact public HTTPS origin.' })
                return z.NEVER
              }
            }),
        )
        .max(12)
        .default([]),
    })
    .optional(),
  stateSchema: z.string().trim().min(1).max(80).optional(),
  html: z.string().min(1).max(INTERACTIVE_MAX_HTML).optional(),
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(200),
        content: z.string().max(INTERACTIVE_MAX_HTML),
        encoding: z.enum(['utf8', 'base64']).optional(),
      }),
    )
    .min(1)
    .max(INTERACTIVE_MAX_FILES)
    .optional(),
  entry: z.string().min(1).max(200).optional(),
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(3000),
  checks: z
    .array(
      z.object({
        action: z.enum(['click', 'fill', 'select', 'check']),
        label: z.string().min(1).max(200),
        value: z.string().max(2000).optional(),
        expect: z.string().min(1).max(1000),
      }),
    )
    .max(24)
    .default([]),
})
export type InteractiveInput = z.infer<typeof interactiveInput>
/** Exactly one of a single document or a project; the runnable document is always one bundled HTML string. */
export function interactiveDocumentHtml(input: InteractiveInput): string {
  if (!input.html === !input.files) throw new Error('Provide either html or files, not both.')
  if (input.files) {
    const bytes = input.files.reduce((total, file) => total + Buffer.byteLength(file.content), 0)
    if (bytes > INTERACTIVE_MAX_HTML) throw new Error('Interactive project files exceed 512 KB in total')
  }
  const html = resolveInteractiveKit(
    input.files ? bundleInteractive(input.files, input.entry ?? 'index.html') : input.html!,
  )
  if (Buffer.byteLength(html) > INTERACTIVE_MAX_HTML) throw new Error('Interactive document exceeds 512 KB')
  rejectViewportHeights(html)
  return html
}
/**
 * The frame grows to fit the document, so a height that follows the viewport grows it again on every measurement.
 * Only stylesheet text and style attributes are checked; script text and prose are left alone.
 */
export function rejectViewportHeights(html: string) {
  const css = [
    ...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi),
    ...html.matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi),
  ].map((match) => match.slice(1).find((part) => part !== undefined) ?? '')
  const unit = css.join('\n').match(/\d(?:[sld]?vh|vb)\b/i)
  if (unit)
    throw new Error(
      `Viewport height units (${unit[0].slice(1)}) make the frame grow without end. Use fixed pixel heights or let content set the height.`,
    )
}
export const interactiveDigest = (input: InteractiveInput) =>
  createHash('sha256').update(JSON.stringify(input)).digest('hex')
export interface PublishOptions {
  previous?: { id: string; version: number }
  /** What the revision changes; required with previous. */
  changes?: string
  restoredFrom?: number
  pageId?: string
  /** Pages take new versions from any thread, so their latest version is not this thread's. */
  acrossSessions?: boolean
  /** Runs inside the publication's transaction, so a page's own copy commits with the thread's event. */
  onPublished?: (published: {
    reference: InteractiveReference
    html: string
    preview: string | null
    files: string | null
  }) => void
}
const entryFirst = <T extends { path: string }>(files: T[], entry = 'index.html') => [
  ...files.filter((file) => file.path === entry),
  ...files.filter((file) => file.path !== entry),
]
export class InteractiveStore {
  constructor(
    private readonly db: Db,
    private readonly record: (session: string, ref: InteractiveReference) => void,
    private readonly previewer = previewInteractive,
  ) {}
  private session(id: string) {
    if (!this.db.prepare('SELECT id FROM agent_sessions WHERE id=?').get(id))
      throw new Error('Thread session not found')
  }
  /**
   * Checks a revision must still pass: the ones kept with the version it revises, less any the agent drops because that
   * behavior changed on purpose. New checks with the same label replace the kept ones.
   */
  keptChecks(previous: { id: string; version: number } | undefined, input: InteractiveInput, drop: string[] = []) {
    if (!previous) return []
    const row = this.db
      .prepare('SELECT checks FROM interactive_media WHERE id=? AND version=?')
      .get(previous.id, previous.version) as { checks: string } | undefined
    const kept = row ? (JSON.parse(row.checks) as InteractiveInput['checks']) : []
    const own = new Set(input.checks.map((check) => check.label))
    return kept.filter((check) => !own.has(check.label) && !drop.includes(check.label)).slice(0, 12)
  }
  async preview(
    session: string,
    value: InteractiveInput,
    signal?: AbortSignal,
    revision?: { previous?: { id: string; version: number }; dropChecks?: string[] },
  ): Promise<InteractivePreview & { keptChecks?: string[] }> {
    this.session(session)
    const parsed = interactiveInput.parse({ ...value, network: value.network ?? OFFLINE_NETWORK })
    const kept = this.keptChecks(revision?.previous, parsed, revision?.dropChecks)
    const input = kept.length ? { ...parsed, checks: [...parsed.checks, ...kept].slice(0, 24) } : parsed
    if (signal?.aborted) throw new Error('Preview cancelled')
    if (!input.html === !input.files) throw new Error('Provide either html or files, not both.')
    if (
      input.files &&
      input.files.reduce((total, file) => total + Buffer.byteLength(file.content), 0) > INTERACTIVE_MAX_HTML
    )
      throw new Error('Interactive project files exceed 512 KB in total')
    const html = input.files
      ? resolveInteractiveKit(await compileInteractive(input.files, input.entry ?? 'index.html'))
      : interactiveDocumentHtml(input)
    if (Buffer.byteLength(html) > INTERACTIVE_MAX_ARTIFACT)
      throw new Error('Compiled interactive content exceeds 1.5 MB.')
    rejectViewportHeights(html)
    const output = await this.previewer(html, input.checks, signal, input.network)
    if (signal?.aborted) throw new Error('Preview cancelled')
    const result: InteractivePreview & { keptChecks?: string[] } = {
      ...output,
      ...(kept.length ? { keptChecks: kept.map((check) => check.label) } : {}),
      id: randomUUID(),
      digest: interactiveDigest(input),
      createdAt: Date.now(),
    }
    // Previews expire and remain bounded independently of immutable published content.
    this.db.prepare('DELETE FROM interactive_previews WHERE created_at < ?').run(Date.now() - 30 * 60_000)
    const count = this.db.prepare('SELECT COUNT(*) AS n FROM interactive_previews WHERE session_id=?').get(session) as {
      n: number
    }
    if (count.n >= 20)
      this.db
        .prepare(
          'DELETE FROM interactive_previews WHERE id=(SELECT id FROM interactive_previews WHERE session_id=? ORDER BY created_at LIMIT 1)',
        )
        .run(session)
    this.db
      .prepare('INSERT INTO interactive_previews(id,session_id,input,result,created_at) VALUES(?,?,?,?,?)')
      .run(
        result.id,
        session,
        JSON.stringify(input),
        JSON.stringify({ ...result, artifact: html, artifactDigest: createHash('sha256').update(html).digest('hex') }),
        result.createdAt,
      )
    return result
  }
  publish(session: string, previewId: string, requestId: string, options: PublishOptions = {}): InteractiveReference {
    this.session(session)
    const { previous } = options
    if (previous && !options.changes?.trim())
      throw new Error('Say in a sentence what this revision changes (changes), so the person can tell versions apart.')
    const retry = this.db
      .prepare('SELECT reference,request_signature FROM interactive_versions WHERE session_id=? AND request_id=?')
      .get(session, requestId) as { reference: string; request_signature: string } | undefined
    const signature = JSON.stringify([previewId, previous ?? null])
    if (retry && retry.request_signature !== signature)
      throw new Error('requestId already belongs to a different publication')
    if (retry) {
      const ref = JSON.parse(retry.reference) as InteractiveReference
      return ref
    }
    const row = this.db
      .prepare('SELECT input,result,created_at FROM interactive_previews WHERE id=? AND session_id=?')
      .get(previewId, session) as { input: string; result: string; created_at: number } | undefined
    if (!row || row.created_at < Date.now() - 30 * 60_000)
      throw new Error('Preview expired or belongs to another session. Preview again.')
    const input = interactiveInput.parse(JSON.parse(row.input))
    const preview = JSON.parse(row.result) as InteractivePreview & { artifact?: string; artifactDigest?: string }
    if (
      preview.artifact !== undefined &&
      createHash('sha256').update(preview.artifact).digest('hex') !== preview.artifactDigest
    )
      throw new Error('Preview artifact digest mismatch. Preview again.')
    if (preview.digest !== interactiveDigest(input)) throw new Error('Preview digest mismatch. Preview again.')
    if (preview.errors.length || preview.checks.some((check) => !check.passed))
      throw new Error('Fix preview errors and failed checks before publishing.')
    let id: string = randomUUID(),
      version = 1
    if (previous) {
      // A kept page's versions come from any thread, so the latest is read across sessions for its id.
      const latest = this.db
        .prepare(
          options.acrossSessions
            ? 'SELECT MAX(version) AS version FROM interactive_versions WHERE id=?'
            : 'SELECT MAX(version) AS version FROM interactive_versions WHERE session_id=? AND id=?',
        )
        .get(...(options.acrossSessions ? [previous.id] : [session, previous.id])) as { version: number | null }
      if (latest.version !== previous.version)
        throw new Error('Content changed or belongs to another session. Read the latest version first.')
      id = previous.id
      version = previous.version + 1
    }
    const reference: InteractiveReference = {
      id,
      version,
      sessionId: session,
      title: input.title,
      summary: input.summary,
      digest: preview.digest,
      createdAt: Date.now(),
      checked: preview.checks.length > 0,
      network: input.network ?? OFFLINE_NETWORK,
      ...(input.files
        ? { libraries: { react: '19.3.0', 'react-dom': '19.3.0', 'chart.js': '4.6.1', '@dagrejs/dagre': '2.0.4' } }
        : {}),
      ...(input.stateSchema ? { stateSchema: input.stateSchema } : {}),
      ...(input.files ? { files: entryFirst(input.files, input.entry).map((file) => file.path) } : {}),
      ...(previous ? { changes: options.changes!.trim().slice(0, 300) } : {}),
      ...(options.restoredFrom ? { restoredFrom: options.restoredFrom } : {}),
      ...(options.pageId ? { pageId: options.pageId } : {}),
    }
    const html = preview.artifact ?? interactiveDocumentHtml(input)
    const files = input.files ? JSON.stringify(entryFirst(input.files, input.entry)) : null
    // The immutable version and its canonical event commit together. Reopening never resurrects a deliberately rewound event.
    this.db.exec('SAVEPOINT publish_interactive')
    try {
      this.insert(session, requestId, signature, reference, html, preview.screenshot, files, {
        wide: preview.wideScreenshot ?? null,
        light: preview.lightScreenshot ?? null,
        checks: input.checks,
      })
      options.onPublished?.({ reference, html, preview: preview.screenshot, files })
      this.record(session, reference)
      this.db.exec('RELEASE publish_interactive')
    } catch (error) {
      this.db.exec('ROLLBACK TO publish_interactive; RELEASE publish_interactive')
      throw error
    }
    return reference
  }
  private insert(
    session: string,
    requestId: string,
    signature: string,
    reference: InteractiveReference,
    html: string,
    preview: string | null,
    files: string | null,
    media: { wide: string | null; light: string | null; checks: InteractiveInput['checks'] },
  ) {
    this.db
      .prepare(
        'INSERT INTO interactive_versions(id,version,session_id,request_id,request_signature,reference,html,preview,files) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .run(
        reference.id,
        reference.version,
        session,
        requestId,
        signature,
        JSON.stringify(reference),
        html,
        preview,
        files,
      )
    this.db
      .prepare('INSERT OR REPLACE INTO interactive_media(id,version,wide,light,checks) VALUES(?,?,?,?,?)')
      .run(reference.id, reference.version, media.wide, media.light, JSON.stringify(media.checks))
  }
  /**
   * The person brings an older version back. It is published as the newest version with the same tested bytes, so the
   * latest card is always the one in use and nothing in the transcript is rewritten.
   */
  restore(session: string, id: string, version: number): InteractiveReference {
    const source = this.get(session, id, version)
    const latest = this.latest(session, id)
    if (latest.version === version) return latest
    const media = this.media(id, version)
    const reference: InteractiveReference = {
      ...source.reference,
      version: latest.version + 1,
      sessionId: session,
      createdAt: Date.now(),
      changes: `Restored v${version}`,
      restoredFrom: version,
      ...(latest.pageId ? { pageId: latest.pageId } : {}),
    }
    this.db.exec('SAVEPOINT restore_interactive')
    try {
      this.insert(
        session,
        `restore:${id}:${reference.version}`,
        JSON.stringify(['restore', id, version]),
        reference,
        source.html,
        source.preview,
        source.files ? JSON.stringify(source.files) : null,
        { wide: media.wide, light: media.light, checks: media.checks },
      )
      this.record(session, reference)
      this.db.exec('RELEASE restore_interactive')
    } catch (error) {
      this.db.exec('ROLLBACK TO restore_interactive; RELEASE restore_interactive')
      throw error
    }
    return reference
  }
  /** The newest version of one document in this thread. */
  latest(session: string, id: string): InteractiveReference {
    const row = this.db
      .prepare('SELECT reference FROM interactive_versions WHERE session_id=? AND id=? ORDER BY version DESC LIMIT 1')
      .get(session, id) as { reference: string } | undefined
    if (!row) throw new Error('Interactive content not found in this session')
    return JSON.parse(row.reference)
  }
  /** The desktop and light screenshots and the checks a version passed, kept for Compare and later revisions. */
  media(
    id: string,
    version: number,
  ): { wide: string | null; light: string | null; checks: InteractiveInput['checks'] } {
    const row = this.db
      .prepare('SELECT wide,light,checks FROM interactive_media WHERE id=? AND version=?')
      .get(id, version) as { wide: string | null; light: string | null; checks: string } | undefined
    return row
      ? { wide: row.wide, light: row.light, checks: JSON.parse(row.checks) }
      : { wide: null, light: null, checks: [] }
  }
  get(session: string, id: string, version: number): InteractiveDocument {
    const row = this.db
      .prepare(
        'SELECT reference,html,preview,files FROM interactive_versions WHERE session_id=? AND id=? AND version=?',
      )
      .get(session, id, version) as
      { reference: string; html: string; preview: string; files: string | null } | undefined
    if (!row) throw new Error('Interactive content not found in this session')
    return {
      reference: JSON.parse(row.reference),
      html: row.html,
      preview: row.preview,
      ...(row.files ? { files: JSON.parse(row.files) } : {}),
    }
  }
  list(session: string): InteractiveReference[] {
    return (
      this.db
        .prepare('SELECT reference FROM interactive_versions WHERE session_id=? ORDER BY rowid DESC LIMIT 100')
        .all(session) as { reference: string }[]
    ).map((row) => JSON.parse(row.reference))
  }
}
