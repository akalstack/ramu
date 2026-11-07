import { ARTIFACT_SOURCE_FILES, type ArtifactKind } from './artifacts'
import {
  interactiveCsp,
  interactiveHtml,
  interactiveStyles,
  readInteractiveState,
  type InteractiveDocument,
} from './interactive'
/**
 * Runnable export adds the isolated runtime and declared scenario. Source export adds no script or scenario, only the
 * theme tokens and base styles the saved source is written against, so it looks the same when opened on its own.
 * `theme` is the palette the reader was viewing; without it the defaults follow the system appearance.
 */
export function interactiveExport(
  document: InteractiveDocument,
  state: unknown,
  raw = false,
  theme?: Record<string, string>,
) {
  const id = document.reference.id.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 80) || 'content'
  return {
    name: `interactive-${id}-v${document.reference.version}${raw ? '-source' : ''}.html`,
    html: raw
      ? `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${interactiveCsp(document.reference.network)}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${document.reference.title.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</title><style data-ramu-theme>${interactiveStyles(theme)}</style></head><body>${document.html}</body></html>`
      : interactiveHtml(document.html, 'export', readInteractiveState(state), theme, document.reference.network),
    mimeType: 'text/html' as const,
  }
}

/** A file an artifact exports, ready to download or hand to the share sheet. */
export interface ExportedFile {
  name: string
  /** Text, or the bytes as base64 when encoding says so. */
  content: string
  mimeType: string
  encoding?: 'base64'
}

/** Files the host makes in its headless browser or with a writer library, kept with the version they were made from. */
export const HOST_EXPORT_FORMATS = ['pdf', 'pptx', 'png', 'docx'] as const
export type HostExportFormat = (typeof HOST_EXPORT_FORMATS)[number]

/**
 * What the host can make for a kind: every kind prints to PDF, a deck also writes PowerPoint and slide images, a doc
 * a Word file and a diagram a PNG.
 */
export function hostExportFormats(kind: ArtifactKind): HostExportFormat[] {
  return kind === 'slides'
    ? ['pptx', 'pdf', 'png']
    : kind === 'doc'
      ? ['docx', 'pdf']
      : kind === 'diagram' || kind === 'dashboard'
        ? ['png', 'pdf']
        : ['pdf']
}

/** How many slides a deck version has, read from the slide list it keeps; 0 for every other kind. */
export function slideCount(document: InteractiveDocument): number {
  if (document.reference.kind !== 'slides') return 0
  const source = document.files?.find((file) => file.path === ARTIFACT_SOURCE_FILES.slides)?.content
  try {
    const deck = source ? (JSON.parse(source) as { slides?: unknown }) : null
    return Array.isArray(deck?.slides) ? deck.slides.length : 0
  } catch {
    return 0
  }
}

export type KindExportFormat = 'markdown' | 'html' | 'svg' | 'mermaid' | 'csv'

/** A title as a file name that every platform accepts. */
export const exportFileName = (title: string) =>
  title
    // eslint-disable-next-line no-control-regex -- control characters are not allowed in file names
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .trim()
    .slice(0, 80) || 'artifact'

/**
 * What a Doc, Diagram or deck exports on the device, made from the sources its version keeps: a Doc as Markdown and
 * HTML, a deck as HTML, a Diagram as SVG and, when written in Mermaid, its Mermaid source. An App exports through
 * interactiveExport, and the files only the host can make come from hostExportFormats.
 */
export function kindExports(
  document: InteractiveDocument,
  theme?: Record<string, string>,
): { format: KindExportFormat; file: ExportedFile }[] {
  const source = (path: string) => document.files?.find((file) => file.path === path)?.content
  const name = exportFileName(document.reference.title)
  const formats: { format: KindExportFormat; file: ExportedFile }[] = []
  const add = (format: KindExportFormat, extension: string, mimeType: string, content: string | undefined) => {
    if (content !== undefined) formats.push({ format, file: { name: `${name}.${extension}`, content, mimeType } })
  }
  if (document.reference.kind === 'doc') {
    add('markdown', 'md', 'text/markdown', source(ARTIFACT_SOURCE_FILES.doc))
    add('html', 'html', 'text/html', interactiveExport(document, null, true, theme).html)
  } else if (document.reference.kind === 'slides') {
    add('html', 'html', 'text/html', interactiveExport(document, null, true, theme).html)
  } else if (document.reference.kind === 'diagram') {
    add('svg', 'svg', 'image/svg+xml', source(ARTIFACT_SOURCE_FILES.svg))
    add('mermaid', 'mmd', 'text/plain', source(ARTIFACT_SOURCE_FILES.mermaid))
  } else if (document.reference.kind === 'dashboard') {
    const board = source(ARTIFACT_SOURCE_FILES.dashboard)
    add('csv', 'csv', 'text/csv', board === undefined ? undefined : dashboardCsv(board))
  }
  return formats
}

/** One CSV cell: quoted when it must be, and never read as a formula by a spreadsheet. */
const csvCell = (value: unknown) => {
  if (value === null || value === undefined) return ''
  let text = String(value)
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * A dashboard's tables as CSV, from the source its version keeps. One table is plain CSV; several follow one another,
 * each after a line with its id and separated by an empty line.
 */
export function dashboardCsv(source: string): string {
  const { datasets } = JSON.parse(source) as { datasets: { id: string; columns: string[]; rows: unknown[][] }[] }
  const table = (data: (typeof datasets)[number]) =>
    [data.columns, ...data.rows].map((row) => row.map(csvCell).join(',')).join('\n')
  return datasets.length === 1
    ? `${table(datasets[0]!)}\n`
    : `${datasets.map((data) => `${csvCell(data.id)}\n${table(data)}`).join('\n\n')}\n`
}
