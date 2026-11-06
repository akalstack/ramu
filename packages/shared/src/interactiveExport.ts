import { ARTIFACT_SOURCE_FILES } from './artifacts'
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
  content: string
  mimeType: string
}

export type KindExportFormat = 'markdown' | 'html' | 'svg' | 'mermaid'

const fileName = (title: string) =>
  title
    // eslint-disable-next-line no-control-regex -- control characters are not allowed in file names
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .trim()
    .slice(0, 80) || 'artifact'

/**
 * What a Doc or Diagram exports, made from the sources its version keeps: a Doc as Markdown and HTML, a Diagram as SVG
 * and, when written in Mermaid, its Mermaid source. An App exports through interactiveExport, so it has none here.
 */
export function kindExports(
  document: InteractiveDocument,
  theme?: Record<string, string>,
): { format: KindExportFormat; file: ExportedFile }[] {
  const source = (path: string) => document.files?.find((file) => file.path === path)?.content
  const name = fileName(document.reference.title)
  const formats: { format: KindExportFormat; file: ExportedFile }[] = []
  const add = (format: KindExportFormat, extension: string, mimeType: string, content: string | undefined) => {
    if (content !== undefined) formats.push({ format, file: { name: `${name}.${extension}`, content, mimeType } })
  }
  if (document.reference.kind === 'doc') {
    add('markdown', 'md', 'text/markdown', source(ARTIFACT_SOURCE_FILES.doc))
    add('html', 'html', 'text/html', interactiveExport(document, null, true, theme).html)
  } else if (document.reference.kind === 'diagram') {
    add('svg', 'svg', 'image/svg+xml', source(ARTIFACT_SOURCE_FILES.svg))
    add('mermaid', 'mmd', 'text/plain', source(ARTIFACT_SOURCE_FILES.mermaid))
  }
  return formats
}
