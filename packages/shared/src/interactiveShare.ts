import { interactiveExport } from './interactiveExport'
import type { InteractiveDocument, InteractiveState } from './interactive'
export interface InteractiveShareAdapter {
  available(): Promise<boolean>
  write(html: string): string | Promise<string>
  share(uri: string, metadata: { name: string; mimeType: string }): Promise<void>
}
/** Serialize access to a single cache file until the native share sheet closes; failures always release it. */
export function createInteractiveSharer(adapter: InteractiveShareAdapter) {
  let sharing = false
  return async (
    document: InteractiveDocument,
    state: InteractiveState | null,
    raw = false,
    theme?: Record<string, string>,
  ): Promise<void> => {
    if (sharing) throw new Error('Another share is open.')
    sharing = true
    try {
      if (!(await adapter.available())) throw new Error('Sharing is unavailable on this device.')
      const exported = interactiveExport(document, state, raw, theme)
      const uri = await adapter.write(exported.html)
      await adapter.share(uri, exported)
    } finally {
      sharing = false
    }
  }
}
