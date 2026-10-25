import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Db } from '../db'
import type { InteractiveDocument, InteractivePreview, InteractiveReference } from '@ramu/shared/interactive'
import { INTERACTIVE_MAX_FILES, INTERACTIVE_MAX_HTML, interactiveOrigin } from '@ramu/shared/interactive'
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
    .max(12)
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
  async preview(session: string, value: InteractiveInput, signal?: AbortSignal): Promise<InteractivePreview> {
    this.session(session)
    const input = interactiveInput.parse({ ...value, network: value.network ?? { resources: [], connect: [] } })
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
    const result: InteractivePreview = {
      ...output,
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
  publish(
    session: string,
    previewId: string,
    requestId: string,
    previous?: { id: string; version: number },
  ): InteractiveReference {
    this.session(session)
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
      const latest = this.db
        .prepare('SELECT MAX(version) AS version FROM interactive_versions WHERE session_id=? AND id=?')
        .get(session, previous.id) as { version: number | null }
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
      ...(input.network ? { network: input.network } : {}),
      ...(input.files
        ? { libraries: { react: '19.3.0', 'react-dom': '19.3.0', 'chart.js': '4.6.1', '@dagrejs/dagre': '2.0.4' } }
        : {}),
      ...(input.stateSchema ? { stateSchema: input.stateSchema } : {}),
      ...(input.files ? { files: entryFirst(input.files, input.entry).map((file) => file.path) } : {}),
    }
    // The immutable version and its canonical event commit together. Reopening never resurrects a deliberately rewound event.
    this.db.exec('SAVEPOINT publish_interactive')
    try {
      this.db
        .prepare(
          'INSERT INTO interactive_versions(id,version,session_id,request_id,request_signature,reference,html,preview,files) VALUES(?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          version,
          session,
          requestId,
          signature,
          JSON.stringify(reference),
          preview.artifact ?? interactiveDocumentHtml(input),
          preview.screenshot,
          input.files ? JSON.stringify(entryFirst(input.files, input.entry)) : null,
        )
      this.record(session, reference)
      this.db.exec('RELEASE publish_interactive')
    } catch (error) {
      this.db.exec('ROLLBACK TO publish_interactive; RELEASE publish_interactive')
      throw error
    }
    return reference
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
