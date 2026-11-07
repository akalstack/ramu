import { z } from 'zod'

/** Markdown for a Doc: long reports fit, a book does not. */
export const DOC_MAX_SOURCE = 200_000
/** Mermaid text for a Diagram, the same bound the chat's diagram renderer draws. */
const MERMAID_MAX_SOURCE = 50_000
/** Hand-written SVG for a Diagram. */
const SVG_MAX_SOURCE = 300_000

const docSource = z.object({
  kind: z.literal('doc'),
  source: z
    .string({ error: 'Write the doc as Markdown in source.' })
    .max(DOC_MAX_SOURCE, `A doc is at most ${DOC_MAX_SOURCE / 1000} KB of Markdown.`)
    .refine((text) => text.trim().length > 0, 'Write the doc as Markdown in source.'),
})
const diagramSource = z
  .object({
    kind: z.literal('diagram'),
    format: z.enum(['mermaid', 'svg'], { error: 'Say which the diagram is written in: format "mermaid" or "svg".' }),
    source: z
      .string({ error: 'Write the diagram in source.' })
      .refine((text) => text.trim().length > 0, 'Write the diagram in source.'),
  })
  .superRefine((value, ctx) => {
    const limit = value.format === 'mermaid' ? MERMAID_MAX_SOURCE : SVG_MAX_SOURCE
    if (value.source.length > limit)
      ctx.addIssue({
        code: 'custom',
        path: ['source'],
        message: `A ${value.format === 'mermaid' ? 'Mermaid' : 'SVG'} diagram is at most ${limit / 1000} KB.`,
      })
    if (value.format === 'svg' && !/<svg[\s>]/i.test(value.source))
      ctx.addIssue({ code: 'custom', path: ['source'], message: 'An SVG diagram needs an <svg> element.' })
  })

/** A deck long enough for a talk; past this it is two decks. */
export const SLIDES_MAX = 60
export const SLIDE_LAYOUTS = ['title', 'content', 'two-columns', 'image', 'chart', 'quote'] as const
type SlideLayout = (typeof SLIDE_LAYOUTS)[number]

const slideText = (max: number) => z.string().max(max, `Slide text is at most ${max} characters. Split the slide.`)
const slideMarkdown = slideText(3000).describe(
  'A Markdown subset: paragraphs, "- " bullets, "1. " numbered items, **bold**, *italic* and `code`.',
)
const slideChart = z.object({
  type: z.enum(['bar', 'line', 'pie']),
  labels: z.array(z.string().max(40)).min(1).max(24).describe('The categories along the axis, or the pie slices.'),
  series: z
    .array(z.object({ name: z.string().max(60), values: z.array(z.number()).max(24) }))
    .min(1)
    .max(6)
    .describe('One value per label in each series. A pie has one series.'),
  unit: z.string().max(12).optional().describe('Shown after each value, such as "%" or " ms".'),
})

/** One slide: the layout decides which of the other fields it shows. */
export const slideSchema = z.object({
  layout: z
    .enum(SLIDE_LAYOUTS)
    .describe(
      'title: title and an optional subtitle in body. content: title and body, with an optional image beside it. two-columns: title and columns. image: an image with an optional title and caption in body. chart: a chart with an optional title and caption in body. quote: the quote in body and who said it in by.',
    ),
  title: slideText(200).optional(),
  body: slideMarkdown.optional(),
  columns: z.tuple([slideMarkdown, slideMarkdown]).optional().describe('The two columns of a two-columns slide.'),
  image: z
    .object({
      path: z.string().min(1).max(200).describe('A PNG or JPEG sent in files with encoding base64.'),
      alt: z.string().trim().min(1).max(300).describe('What the image shows, for people who cannot see it.'),
    })
    .optional(),
  chart: slideChart.optional(),
  by: slideText(120).optional().describe('Who said the quote.'),
  notes: z
    .string()
    .max(5000)
    .optional()
    .describe('Speaker notes: kept in PowerPoint and Keynote, not shown on the slide.'),
})
export type Slide = z.infer<typeof slideSchema>

/** The words of one slide a person can change in place; its layout, chart and image stay as the agent made them. */
export const slideTextEdit = z.object({
  /** Where this slide was in the version being edited; the edits' order is the deck's new order. */
  from: z
    .number()
    .int()
    .min(0)
    .max(SLIDES_MAX - 1)
    .optional(),
  title: slideText(200).optional(),
  body: slideMarkdown.optional(),
  columns: z.tuple([slideMarkdown, slideMarkdown]).optional(),
  by: slideText(120).optional(),
  notes: z.string().max(5000).optional(),
})
export type SlideTextEdit = z.infer<typeof slideTextEdit>

/**
 * A deck with the person's text put into each slide's existing fields, in the order of the edits: each edit names the
 * slide it came from, so moving a slide keeps its layout, chart and image.
 */
export function editSlideText(slides: Slide[], edits: SlideTextEdit[]): Slide[] {
  const from = edits.map((edit, index) => edit.from ?? index)
  if (edits.length !== slides.length || new Set(from).size !== from.length || from.some((at) => !slides[at]))
    throw new Error('The deck changed while you were editing. Reopen it and edit again.')
  return edits.map((edit, index) => {
    const slide = slides[from[index]!]!
    const next: Slide = { ...slide }
    for (const key of ['title', 'body', 'by', 'notes'] as const) {
      const value = edit[key]
      if (value === undefined) continue
      if (value.trim()) next[key] = value
      else delete next[key]
    }
    if (edit.columns) next.columns = edit.columns
    return next
  })
}
export type SlideChart = z.infer<typeof slideChart>

/** The deck's colors: Ramu's light or dark tokens, or the reader's own (auto), with an optional accent. */
export const slideThemeSchema = z.object({
  appearance: z
    .enum(['auto', 'light', 'dark'])
    .default('auto')
    .describe('auto follows the reader’s light or dark mode; light or dark fixes it, as in exported files.'),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Give the accent as a hex color such as #7652d4.')
    .optional()
    .describe('Titles’ rule, bullets and the first chart series; Ramu’s violet when absent.'),
})
export type SlideTheme = z.infer<typeof slideThemeSchema>

/** What each layout needs and what only it may carry, so a field is never silently dropped. */
const LAYOUT_NEEDS: Record<SlideLayout, { needs: (keyof Slide)[]; allows: (keyof Slide)[] }> = {
  title: { needs: ['title'], allows: ['body'] },
  content: { needs: ['title', 'body'], allows: ['image'] },
  'two-columns': { needs: ['columns'], allows: ['title'] },
  image: { needs: ['image'], allows: ['title', 'body'] },
  chart: { needs: ['chart'], allows: ['title', 'body'] },
  quote: { needs: ['body'], allows: ['by'] },
}
const SHOWN: (keyof Slide)[] = ['title', 'body', 'columns', 'image', 'chart', 'by']

const slidesSource = z
  .object({
    kind: z.literal('slides'),
    slides: z
      .array(slideSchema, { error: 'Write the deck as a list of slides in slides.' })
      .min(1, 'Write the deck as a list of slides in slides.')
      .max(SLIDES_MAX, `A deck has at most ${SLIDES_MAX} slides. Split it into two decks.`),
    theme: slideThemeSchema.default({ appearance: 'auto' }),
  })
  .superRefine((deck, ctx) => {
    deck.slides.forEach((slide, index) => {
      const problem = (message: string) =>
        ctx.addIssue({ code: 'custom', path: ['slides', index], message: `Slide ${index + 1}: ${message}` })
      const rule = LAYOUT_NEEDS[slide.layout]
      const kind = `${/^[aeiou]/.test(slide.layout) ? 'an' : 'a'} ${slide.layout} slide`
      for (const name of rule.needs)
        if (slide[name] === undefined || (typeof slide[name] === 'string' && !slide[name].trim()))
          problem(`${kind} needs ${name}.`)
      for (const name of SHOWN)
        if (slide[name] !== undefined && !rule.needs.includes(name) && !rule.allows.includes(name))
          problem(`${kind} does not show ${name}. Remove it or change the layout.`)
      const chart = slide.chart
      if (!chart) return
      if (chart.series.some((series) => series.values.length !== chart.labels.length))
        problem('every chart series needs one value per label.')
      if (chart.type === 'pie' && chart.series.length !== 1) problem('a pie chart has exactly one series.')
      if (
        chart.type === 'pie' &&
        (chart.series[0]!.values.some((value) => value < 0) || !chart.series[0]!.values.some((value) => value > 0))
      )
        problem('a pie chart needs values of zero or more, and at least one above zero.')
    })
  })
export type SlidesSource = z.infer<typeof slidesSource>

export const DASHBOARD_ROWS_MAX = 5000
const columnName = z.string().trim().min(1).max(60)
/**
 * Live tables a dashboard reads from its own project on the host, each with fixed columns; the host reads them again
 * when the dashboard is opened, at most every few minutes.
 */
export const DASHBOARD_SOURCES = {
  deployments: ['created', 'state', 'production', 'branch', 'message', 'url'],
  usage: ['platform', 'metric', 'service', 'used', 'limit', 'unit'],
  uptime: ['checked', 'result', 'status', 'ms'],
} as const
export type DashboardSourceKind = keyof typeof DASHBOARD_SOURCES

export const dashboardDatasetSchema = z
  .object({
    id: z.string().trim().min(1).max(40).describe('The name figures and charts use for this table.'),
    columns: z.array(columnName).min(1).max(30).optional().describe('Required unless the table has a source.'),
    rows: z
      .array(z.array(z.union([z.string().max(200), z.number(), z.null()])).max(30))
      .max(DASHBOARD_ROWS_MAX, `A table has at most ${DASHBOARD_ROWS_MAX} rows. Summarize it first.`)
      .default([])
      .describe('One value per column in each row: text, a number or null.'),
    asOf: z.iso.datetime({ offset: true }).optional().describe('When this data was read, shown as "As of".'),
    source: z
      .enum(Object.keys(DASHBOARD_SOURCES) as [DashboardSourceKind, ...DashboardSourceKind[]])
      .optional()
      .describe(
        "A live table from the dashboard's project, read again when it is opened: deployments (created, state, production, branch, message, url), usage (platform, metric, service, used, limit, unit) or uptime (checked, result, status, ms). Leave columns and rows out.",
      ),
    file: z
      .string()
      .trim()
      .max(260)
      .regex(
        /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+\.(?:csv|json)$/i,
        'A file is a .csv or .json path inside the project.',
      )
      .optional()
      .describe(
        "A CSV (with a header row) or JSON (an array of objects) file in the dashboard's project folder, read again when it is opened and never written. columns names which of its columns to show, by header or key. Leave rows out.",
      ),
  })
  .transform((table, ctx) => {
    if (table.source && table.file) {
      ctx.addIssue({ code: 'custom', message: `Give ${table.id} a source or a file, not both.` })
      return z.NEVER
    }
    if (table.source) return { ...table, columns: [...DASHBOARD_SOURCES[table.source]], rows: table.rows }
    if (!table.columns) {
      ctx.addIssue({ code: 'custom', message: `Give ${table.id} its columns, or a source.` })
      return z.NEVER
    }
    return { ...table, columns: table.columns }
  })
export const DASHBOARD_AGGREGATES = ['sum', 'average', 'count', 'min', 'max', 'last'] as const
export const dashboardFigureSchema = z.object({
  label: z.string().trim().min(1).max(60),
  dataset: z.string().max(40),
  column: columnName,
  aggregate: z.enum(DASHBOARD_AGGREGATES).default('sum'),
  unit: z.string().max(12).optional(),
  notify: z
    .boolean()
    .optional()
    .describe("Tell the person's devices when this number changes; for figures over a live table."),
})
export const dashboardChartSchema = z.object({
  title: z.string().trim().min(1).max(100),
  type: z.enum(['bar', 'line', 'pie']),
  dataset: z.string().max(40),
  x: columnName.describe('The column whose values become the categories along the axis, or the pie slices.'),
  y: z.array(columnName).min(1).max(6).describe('Number columns, one series each; rows with the same x are added up.'),
  unit: z.string().max(12).optional(),
})
const dashboardSource = z
  .object({
    kind: z.literal('dashboard'),
    datasets: z.array(dashboardDatasetSchema).min(1, 'A dashboard needs at least one table in datasets.').max(8),
    figures: z.array(dashboardFigureSchema).max(12).default([]),
    charts: z.array(dashboardChartSchema).max(12).default([]),
    theme: slideThemeSchema.default({ appearance: 'auto' }),
    refreshMinutes: z.number().int().min(5).max(1440).optional(),
  })
  .superRefine((board, ctx) => {
    const tables = new Map(board.datasets.map((table) => [table.id, table]))
    if (tables.size !== board.datasets.length) ctx.addIssue({ code: 'custom', message: 'Give each table its own id.' })
    board.datasets.forEach((table) => {
      if (table.rows.some((row) => row.length !== table.columns.length))
        ctx.addIssue({ code: 'custom', message: `Every row of ${table.id} needs one value per column.` })
    })
    if (!board.figures.length && !board.charts.length)
      ctx.addIssue({ code: 'custom', message: 'A dashboard shows at least one figure or chart.' })
    const numeric = (table: (typeof board.datasets)[number], column: string) => {
      const at = table.columns.indexOf(column)
      return table.rows.every((row) => row[at] === null || typeof row[at] === 'number')
    }
    const check = (what: string, dataset: string, columns: string[], numbers: string[]) => {
      const table = tables.get(dataset)
      if (!table) return ctx.addIssue({ code: 'custom', message: `${what} uses ${dataset}, which is not in datasets.` })
      for (const column of columns)
        if (!table.columns.includes(column))
          ctx.addIssue({ code: 'custom', message: `${what} uses ${column}, which ${dataset} does not have.` })
      for (const column of numbers)
        if (table.columns.includes(column) && !numeric(table, column))
          ctx.addIssue({
            code: 'custom',
            message: `${what} adds up ${column}, but some of its values are not numbers.`,
          })
    }
    for (const figure of board.figures)
      check(
        `The figure "${figure.label}"`,
        figure.dataset,
        [figure.column],
        figure.aggregate === 'count' ? [] : [figure.column],
      )
    for (const chart of board.charts) {
      check(`The chart "${chart.title}"`, chart.dataset, [chart.x, ...chart.y], chart.y)
      if (chart.type === 'pie' && chart.y.length !== 1)
        ctx.addIssue({ code: 'custom', message: `The pie chart "${chart.title}" has exactly one y column.` })
    }
  })
export type DashboardSource = z.infer<typeof dashboardSource>

export const DESIGN_FRAMES_MAX = 12
export const designFrameSchema = z.object({
  name: z.string().trim().min(1).max(60).describe('What the frame shows, such as "Pricing (desktop)".'),
  width: z.number().int().min(240).max(2560).describe('The frame’s width in CSS pixels, such as 1440 or 390.'),
  height: z.number().int().min(200).max(6000),
  html: z.string().max(200_000).describe('The frame’s markup; it fills the frame and is clipped to it.'),
  css: z.string().max(100_000).optional().describe('Styles for this frame only; they cannot reach other frames.'),
})
/** The theme tokens a design system sets; every artifact drawn with it uses them instead of the app's own. */
export const DESIGN_TOKEN_COLORS = [
  'background',
  'foreground',
  'muted',
  'primary',
  'surface',
  'border',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'chart-6',
] as const
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Give colors as hex, such as #7652d4.')
export const designTokensSchema = z
  .object({
    colors: z.partialRecord(z.enum(DESIGN_TOKEN_COLORS), hex).default({}),
    fontSans: z
      .string()
      .max(200)
      .regex(/^[\w\s,'"-]+$/, 'Name fonts as a CSS font list, such as "Inter, sans-serif".')
      .optional(),
    radius: z.number().min(0).max(32).optional().describe('Corner radius in pixels.'),
    spacing: z.number().min(2).max(32).optional().describe('The base spacing unit in pixels, as --space.'),
    fonts: z
      .array(
        z.object({
          family: z
            .string()
            .max(60)
            .regex(/^[\w -]+$/, 'Name a font family with letters, digits, spaces and dashes.'),
          weight: z.number().int().min(100).max(900).optional(),
          style: z.enum(['normal', 'italic']).optional(),
          /** A WOFF2, WOFF, TTF or OTF file sent in files with encoding base64. */
          path: z.string().max(200).optional(),
          /** The font itself, filled in from path when the design is drawn. */
          data: z
            .string()
            .regex(/^data:font\/(woff2|woff|ttf|otf);base64,[A-Za-z0-9+/=]+$/)
            .optional(),
        }),
      )
      .max(4)
      .optional()
      .describe('The design system’s own fonts, each a file in files; name them in fontSans to use them.'),
  })
  .describe('Colors, type and corner radius that make this design a design system other artifacts can follow.')
export type DesignTokens = z.infer<typeof designTokensSchema>

/** The CSS that puts a design system's tokens in place of the theme's, for the frame every artifact is drawn in. */
export function designTokenCss(tokens: DesignTokens): string {
  const lines = [
    ...Object.entries(tokens.colors).map(([name, value]) => `--${name}:${value}`),
    ...(tokens.fontSans ? [`--font-sans:${tokens.fontSans}`] : []),
    ...(tokens.radius !== undefined ? [`--radius:${tokens.radius}px`] : []),
    ...(tokens.spacing !== undefined ? [`--space:${tokens.spacing}px`] : []),
  ]
  const faces = (tokens.fonts ?? [])
    .filter((font) => font.data)
    .map(
      (font) =>
        `@font-face{font-family:"${font.family}";src:url(${font.data});font-weight:${font.weight ?? 400};font-style:${font.style ?? 'normal'};font-display:swap}`,
    )
  return lines.length || faces.length ? `<style>${faces.join('')}:root{${lines.join(';')}}</style>` : ''
}

const designSource = z.object({
  kind: z.literal('design'),
  tokens: designTokensSchema.optional(),
  frames: z
    .array(designFrameSchema)
    .min(1, 'A design needs at least one frame in frames.')
    .max(DESIGN_FRAMES_MAX, `A design has at most ${DESIGN_FRAMES_MAX} frames. Split it into two designs.`),
})
export type DesignSource = z.infer<typeof designSource>

export const MOTION_SCENES_MAX = 20
export const MOTION_SECONDS_MAX = 120
export const motionSceneSchema = z.object({
  seconds: z.number().min(1).max(30).describe('How long the scene shows.'),
  html: z.string().max(100_000).describe('The scene, filling a 16:9 stage.'),
  css: z
    .string()
    .max(50_000)
    .optional()
    .describe('Styles for this scene only. Start its animations at animation-delay: var(--scene-start).'),
})
const motionSource = z
  .object({
    kind: z.literal('motion'),
    scenes: z
      .array(motionSceneSchema)
      .min(1, 'A motion needs at least one scene in scenes.')
      .max(MOTION_SCENES_MAX, `A motion has at most ${MOTION_SCENES_MAX} scenes.`),
  })
  .refine((motion) => motion.scenes.reduce((total, scene) => total + scene.seconds, 0) <= MOTION_SECONDS_MAX, {
    message: `A motion runs at most ${MOTION_SECONDS_MAX} seconds. Shorten its scenes or split it.`,
  })
export type MotionSource = z.infer<typeof motionSource>
export type DashboardAggregate = (typeof DASHBOARD_AGGREGATES)[number]

/** The source of an artifact that is not an App, checked per kind before anything is drawn. */
const artifactSourceSchema = z.discriminatedUnion('kind', [
  docSource,
  diagramSource,
  slidesSource,
  dashboardSource,
  designSource,
  motionSource,
])
export type ArtifactSource = z.infer<typeof artifactSourceSchema>

/** Reads a kind's source from tool input, with the first problem as a sentence the author can act on. */
export function parseArtifactSource(input: {
  kind: string
  source?: string
  format?: string
  slides?: unknown
  theme?: unknown
  datasets?: unknown
  figures?: unknown
  charts?: unknown
  refreshMinutes?: unknown
  frames?: unknown
  scenes?: unknown
  tokens?: unknown
}): ArtifactSource {
  const result = artifactSourceSchema.safeParse(input)
  if (result.success) return result.data
  const issue = result.error.issues[0]
  if (!issue) throw new Error('The source does not fit this kind.')
  const [list, index, ...field] = issue.path
  // A problem inside a slide names the slide and the field, so the author knows where to look.
  if (list === 'slides' && typeof index === 'number' && !/^Slide \d/.test(issue.message))
    throw new Error(`Slide ${index + 1}${field.length ? ` ${field.join('.')}` : ''}: ${issue.message}`)
  throw new Error(issue.message)
}
