import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Db } from '../db'
import type {
  InteractiveDocument,
  InteractiveFile,
  InteractivePreview,
  InteractiveReference,
} from '@ramu/shared/interactive'
import {
  INTERACTIVE_MAX_ASSET,
  INTERACTIVE_MAX_FILES,
  INTERACTIVE_MAX_HTML,
  checkInteractiveAssets,
  interactiveAssetAllowance,
  interactiveSourceBytes,
  interactiveOrigin,
  OFFLINE_NETWORK,
} from '@ramu/shared/interactive'
import { previewInteractive } from './preview'
import { bundleInteractive } from './bundle'
import { resolveInteractiveKit } from './kit'
import { compileInteractive, INTERACTIVE_MAX_ARTIFACT, pinnedLibraries } from './compile'
import { pageCapabilitiesOf } from './capabilities'
import { renderArtifactSource } from './kinds'
import { ARTIFACT_KINDS } from '@ramu/shared/artifacts'
import {
  DESIGN_FRAMES_MAX,
  MOTION_SCENES_MAX,
  designFrameSchema,
  motionAudio,
  motionSceneSchema,
  dashboardChartSchema,
  DASHBOARD_RANGE_MAX,
  designTokenCss,
  designTokensSchema,
  type DesignTokens,
  dashboardDatasetSchema,
  dashboardFigureSchema,
  parseArtifactSource,
  slideSchema,
  slideThemeSchema,
  SLIDES_MAX,
} from '@ramu/shared/artifactSource'

export const interactiveInput = z.object({
  kind: z
    .enum(ARTIFACT_KINDS)
    .optional()
    .describe(
      'app (default): interactive HTML in html or files. doc: writing to keep (a report, plan, spec, notes) as Markdown in source. diagram: a flowchart, sequence, state or concept diagram as Mermaid or SVG in source, with format. slides: a deck as slides and theme, with its images in files. dashboard: figures and charts over tables, in datasets, figures and charts. design: screens or mockups as fixed-size frames of HTML and CSS, in frames. motion: a short animated explainer as timed scenes, in scenes. card: a small native tool to keep, such as a tracker, checklist or log, as A2UI messages in messages with its record collections in records; drawn with the app’s own controls, no code.',
    ),
  source: z
    .string()
    .max(300_000)
    .optional()
    .describe(
      'The Doc or Diagram itself. Doc: Markdown with GFM tables, task lists, footnotes and ```mermaid blocks; raw HTML shows as text. Diagram: Mermaid text, or one <svg> element.',
    ),
  format: z.enum(['mermaid', 'svg']).optional().describe('How a diagram is written; required with kind diagram.'),
  messages: z
    .array(z.record(z.string(), z.unknown()))
    .max(20)
    .optional()
    .describe(
      'The card (kind card): A2UI v1.0 messages building one surface, as show_ui takes. Buttons save with {"functionCall":{"@call":"addRecord","args":{"collection":"expenses","values":{"amount":{"@path":"/form/amount"}}}}} and remove with deleteRecord {collection, id:{"@path":"id"}}; each collection is read at /records/<collection> (newest first, each record with id, createdAt and its fields); sum {values, field} and count {values} total them. Event actions are for threads only.',
    ),
  records: z
    .record(z.string(), z.object({ fields: z.record(z.string(), z.string()) }))
    .optional()
    .describe(
      'The record collections a card keeps (kind card), such as {"expenses":{"fields":{"amount":"number","note":"string?","day":"date"}}}. Field types: string, number, boolean, date, json, with ? for optional.',
    ),
  slides: z
    .array(slideSchema)
    .max(SLIDES_MAX)
    .optional()
    .describe(`The slides of a deck (kind slides), in order, at most ${SLIDES_MAX}.`),
  theme: slideThemeSchema.optional().describe('The colors of a deck or dashboard (kind slides or dashboard).'),
  datasets: z
    .array(dashboardDatasetSchema)
    .max(8)
    .optional()
    .describe('The tables a dashboard works from (kind dashboard), each with its columns, rows and when it was read.'),
  figures: z
    .array(dashboardFigureSchema)
    .max(12)
    .optional()
    .describe('Headline numbers of a dashboard: one column of one table, summed, averaged, counted, min, max or last.'),
  tokens: designTokensSchema
    .optional()
    .describe(
      'A design system’s colors, type and radius (kind design); a design with tokens can be chosen as the design system.',
    ),
  frames: z
    .array(designFrameSchema)
    .max(DESIGN_FRAMES_MAX)
    .optional()
    .describe('The frames of a design (kind design): screens, mockups or a one-pager, each at a fixed size.'),
  scenes: z
    .array(motionSceneSchema)
    .max(MOTION_SCENES_MAX)
    .optional()
    .describe('The scenes of a motion (kind motion), in order, at most two minutes together.'),
  music: motionAudio
    .optional()
    .describe(
      "A motion's background music: an audio file in files (make_music's attachment), looped under the video and quieter under narration.",
    ),
  refreshMinutes: z
    .number()
    .int()
    .min(5)
    .max(1440)
    .optional()
    .describe(
      'How often a dashboard with live tables reads them again: on opening and for watched figures (default 5).',
    ),
  rangeDays: z
    .number()
    .int()
    .min(1)
    .max(DASHBOARD_RANGE_MAX)
    .optional()
    .describe(
      'Show only the last this many days of a dashboard’s dated tables (such as 30), counted from when it is drawn.',
    ),
  charts: z
    .array(dashboardChartSchema)
    .max(12)
    .optional()
    .describe('Charts of a dashboard: one table, x as the categories, y as number columns added up per category.'),
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
        // An asset (a model, texture or sound) may be up to 25 MB; the rest of the source is held to 512 KB together.
        content: z
          .string()
          .max(Math.ceil((INTERACTIVE_MAX_ASSET * 4) / 3) + 4)
          .default(''),
        encoding: z.enum(['utf8', 'base64']).optional(),
        attachment: z
          .string()
          .uuid()
          .optional()
          .describe(
            'An image, audio, video or 3D model file this thread holds, such as one generate_image, make_music, make_sound, speak, make_video or make_model made (its attachmentId): the host puts its bytes in this file, so leave content out. In a revision, an asset path from the previous version with no content and no attachment keeps its bytes.',
          ),
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
/** A page with a design system's style placed inside its head, or first when it has none, never before a doctype. */
export function withDesignTokens(html: string, style: string): string {
  if (!style) return html
  const head = /<head\b[^>]*>/i.exec(html) ?? /<html\b[^>]*>/i.exec(html)
  return head
    ? `${html.slice(0, head.index + head[0].length)}${style}${html.slice(head.index + head[0].length)}`
    : `${style}${html}`
}

export function interactiveDocumentHtml(input: InteractiveInput): string {
  if (input.kind && input.kind !== 'app')
    throw new Error('A doc or diagram is drawn when it is previewed. Preview it again.')
  if (!input.html === !input.files) throw new Error('Provide either html or files, not both.')
  if (input.files) {
    if (interactiveSourceBytes(input.files) > INTERACTIVE_MAX_HTML)
      throw new Error('Interactive project files exceed 512 KB in total')
    checkInteractiveAssets(input.files)
  }
  const html = resolveInteractiveKit(
    input.files ? bundleInteractive(input.files, input.entry ?? 'index.html') : input.html!,
  )
  if (Buffer.byteLength(html) > INTERACTIVE_MAX_HTML + interactiveAssetAllowance(input.files ?? []))
    throw new Error('Interactive document exceeds 512 KB')
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
  artifactId?: string
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
  /**
   * The design system for a thread, when one is chosen: its project's own, else the host's. New visual artifacts and
   * apps from that thread are drawn with its tokens.
   */
  designSystem: (session: string) => DesignTokens | null = () => null

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
    if (input.kind && input.kind !== 'app') return this.previewKind(session, input, signal, kept)
    if (
      input.source !== undefined ||
      input.slides !== undefined ||
      input.datasets !== undefined ||
      input.frames !== undefined ||
      input.scenes !== undefined ||
      input.messages !== undefined
    )
      throw new Error(
        'Set kind to doc, diagram, slides or dashboard to publish source, slides or datasets; apps use html or files.',
      )
    if (!input.html === !input.files) throw new Error('Provide either html or files, not both.')
    // A declaration that does not validate fails here, before any browser starts.
    pageCapabilitiesOf(input)
    if (input.files && interactiveSourceBytes(input.files) > INTERACTIVE_MAX_HTML)
      throw new Error('Interactive project files exceed 512 KB in total')
    const compiled = input.files
      ? resolveInteractiveKit(await compileInteractive(input.files, input.entry ?? 'index.html'))
      : interactiveDocumentHtml(input)
    // Apps follow the host's design system too: its tokens take the place of the theme's in the page.
    const system = this.designSystem(session)
    const html = system ? withDesignTokens(compiled, designTokenCss(system)) : compiled
    if (Buffer.byteLength(html) > INTERACTIVE_MAX_ARTIFACT + interactiveAssetAllowance(input.files ?? []))
      throw new Error('Compiled interactive content exceeds 1.5 MB.')
    rejectViewportHeights(html)
    const output = await this.previewer(html, input.checks, signal, input.network)
    if (signal?.aborted) throw new Error('Preview cancelled')
    return this.savePreview(session, input, html, output, kept, null)
  }
  /**
   * A Doc, Diagram or deck is drawn into HTML on the host and checked like any page, with its kind's own checks: a
   * diagram parses, every heading of a doc has an anchor of its own, and every slide's text fits its box.
   */
  private async previewKind(
    session: string,
    input: InteractiveInput,
    signal: AbortSignal | undefined,
    kept: InteractiveInput['checks'],
  ) {
    // Docs and decks carry their images in files, designs their images and fonts, and a motion its music and sounds.
    if (
      input.html !== undefined ||
      (input.files !== undefined &&
        input.kind !== 'doc' &&
        input.kind !== 'slides' &&
        input.kind !== 'design' &&
        input.kind !== 'motion')
    )
      throw new Error(
        input.kind === 'slides'
          ? 'A deck is written in slides; html is for apps.'
          : input.kind === 'dashboard'
            ? 'A dashboard is written in datasets, figures and charts; html and files are for apps.'
            : input.kind === 'design'
              ? 'A design is written in frames, each with its own html and css; html and files are for apps.'
              : input.kind === 'motion'
                ? 'A motion is written in scenes, each with its seconds, html and css; html is for apps.'
                : input.kind === 'card'
                  ? 'A card is written in messages, with its record collections in records; html and files are for apps.'
                  : input.kind === 'doc'
                    ? 'A doc is written in source, with its images in files; html is for apps.'
                    : `A ${input.kind} is written in source; html and files are for apps.`,
      )
    const source = parseArtifactSource({ ...input, kind: input.kind ?? 'app' })
    const offline = { ...input, network: OFFLINE_NETWORK }
    const rendered = await renderArtifactSource(source, input.title, input.files)
    // A design that sets its own tokens keeps them; the other visual kinds follow the host's design system.
    const system =
      (source.kind === 'slides' || source.kind === 'dashboard' || (source.kind === 'design' && !source.tokens)) &&
      this.designSystem(session)
    if (system) rendered.html = designTokenCss(system) + rendered.html
    if (signal?.aborted) throw new Error('Preview cancelled')
    if (Buffer.byteLength(rendered.html) > INTERACTIVE_MAX_ARTIFACT)
      throw new Error(`This ${input.kind} draws to more than 1.5 MB. Split it or simplify its diagrams.`)
    const output = await this.previewer(rendered.html, offline.checks, signal, OFFLINE_NETWORK)
    if (signal?.aborted) throw new Error('Preview cancelled')
    output.errors = [...rendered.problems, ...output.errors].slice(0, 20)
    return this.savePreview(session, offline, rendered.html, output, kept, rendered.files)
  }
  private savePreview(
    session: string,
    input: InteractiveInput,
    html: string,
    output: Awaited<ReturnType<typeof previewInteractive>>,
    kept: InteractiveInput['checks'],
    sourceFiles: InteractiveFile[] | null,
  ): InteractivePreview & { keptChecks?: string[] } {
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
    this.db.prepare('INSERT INTO interactive_previews(id,session_id,input,result,created_at) VALUES(?,?,?,?,?)').run(
      result.id,
      session,
      JSON.stringify(input),
      JSON.stringify({
        ...result,
        artifact: html,
        artifactDigest: createHash('sha256').update(html).digest('hex'),
        ...(sourceFiles ? { sourceFiles } : {}),
      }),
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
    const preview = JSON.parse(row.result) as InteractivePreview & {
      artifact?: string
      artifactDigest?: string
      sourceFiles?: InteractiveFile[]
    }
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
    // A deck's files are its images, kept with its drawn source rather than as an app's project.
    const project = input.kind && input.kind !== 'app' ? undefined : input.files
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
      ...(project ? { libraries: pinnedLibraries() } : {}),
      ...(input.stateSchema ? { stateSchema: input.stateSchema } : {}),
      ...(project ? { files: entryFirst(project, input.entry).map((file) => file.path) } : {}),
      ...(input.kind && input.kind !== 'app' ? { kind: input.kind } : {}),
      ...(preview.sourceFiles ? { files: preview.sourceFiles.map((file) => file.path) } : {}),
      ...(previous ? { changes: options.changes!.trim().slice(0, 300) } : {}),
      ...(options.restoredFrom ? { restoredFrom: options.restoredFrom } : {}),
      ...(options.artifactId ? { artifactId: options.artifactId } : {}),
    }
    const html = preview.artifact ?? interactiveDocumentHtml(input)
    const files = project
      ? JSON.stringify(entryFirst(project, input.entry))
      : preview.sourceFiles
        ? JSON.stringify(preview.sourceFiles)
        : null
    // The immutable version and its canonical event commit together. Reopening never resurrects a deliberately rewound event.
    this.db.exec('SAVEPOINT publish_artifact')
    try {
      this.insert(session, requestId, signature, reference, html, preview.screenshot, files, {
        wide: preview.wideScreenshot ?? null,
        light: preview.lightScreenshot ?? null,
        checks: input.checks,
      })
      options.onPublished?.({ reference, html, preview: preview.screenshot, files })
      this.record(session, reference)
      this.db.exec('RELEASE publish_artifact')
    } catch (error) {
      this.db.exec('ROLLBACK TO publish_artifact; RELEASE publish_artifact')
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
      ...(latest.artifactId ? { artifactId: latest.artifactId } : {}),
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
