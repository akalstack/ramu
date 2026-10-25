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
