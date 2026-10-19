import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Db } from '../db'
import type { InteractiveDocument, InteractivePreview, InteractiveReference } from '@ramu/shared/interactive'
import { INTERACTIVE_MAX_HTML } from '@ramu/shared/interactive'
import { previewInteractive } from './preview'

export const interactiveInput = z.object({
  stateSchema: z.string().trim().min(1).max(80).optional(),
  html: z.string().min(1).max(INTERACTIVE_MAX_HTML),
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
export const interactiveDigest = (input: InteractiveInput) =>
  createHash('sha256').update(JSON.stringify(input)).digest('hex')
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
    const input = interactiveInput.parse(value)
    if (Buffer.byteLength(input.html) > INTERACTIVE_MAX_HTML) throw new Error('Interactive document exceeds 512 KB')
    const output = await this.previewer(input.html, input.checks, signal)
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
      .run(result.id, session, JSON.stringify(input), JSON.stringify(result), result.createdAt)
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
    const preview = JSON.parse(row.result) as InteractivePreview
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
      ...(input.stateSchema ? { stateSchema: input.stateSchema } : {}),
    }
    // The immutable version and its canonical event commit together. Reopening never resurrects a deliberately rewound event.
    this.db.exec('SAVEPOINT publish_interactive')
    try {
      this.db
        .prepare(
          'INSERT INTO interactive_versions(id,version,session_id,request_id,request_signature,reference,html,preview) VALUES(?,?,?,?,?,?,?,?)',
        )
        .run(id, version, session, requestId, signature, JSON.stringify(reference), input.html, preview.screenshot)
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
      .prepare('SELECT reference,html,preview FROM interactive_versions WHERE session_id=? AND id=? AND version=?')
      .get(session, id, version) as { reference: string; html: string; preview: string } | undefined
    if (!row) throw new Error('Interactive content not found in this session')
    return { reference: JSON.parse(row.reference), html: row.html, preview: row.preview }
  }
  list(session: string): InteractiveReference[] {
    return (
      this.db
        .prepare('SELECT reference FROM interactive_versions WHERE session_id=? ORDER BY rowid DESC LIMIT 100')
        .all(session) as { reference: string }[]
    ).map((row) => JSON.parse(row.reference))
  }
}
