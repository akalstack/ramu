import { interactiveExport } from '@ramu/shared/interactiveExport'
import type { InteractiveDocument, InteractiveState } from '@ramu/shared/interactive'
export async function shareInteractive(
  document: InteractiveDocument,
  state: InteractiveState | null,
  raw = false,
  theme?: Record<string, string>,
) {
  const exported = interactiveExport(document, state, raw, theme)
  const url = URL.createObjectURL(new Blob([exported.html], { type: exported.mimeType }))
  const link = globalThis.document.createElement('a')
  link.href = url
  link.download = exported.name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
