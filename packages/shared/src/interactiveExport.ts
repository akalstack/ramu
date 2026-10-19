import { interactiveHtml, readInteractiveState, type InteractiveDocument } from './interactive'
/** Raw export preserves exact saved source. Runnable export adds only the isolated runtime and declared scenario. */
export function interactiveExport(document: InteractiveDocument, state: unknown, raw = false) {
  const id = document.reference.id.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 80) || 'content'
  return {
    name: `interactive-${id}-v${document.reference.version}${raw ? '-source' : ''}.html`,
    html: raw ? document.html : interactiveHtml(document.html, 'export', readInteractiveState(state)),
    mimeType: 'text/html' as const,
  }
}
