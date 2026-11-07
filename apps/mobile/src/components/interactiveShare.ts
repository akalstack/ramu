import type { ExportedFile } from '@ramu/shared/interactiveExport'

export async function shareFile(file: ExportedFile) {
  const content =
    file.encoding === 'base64' ? Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0)) : file.content
  const url = URL.createObjectURL(new Blob([content], { type: file.mimeType }))
  const link = globalThis.document.createElement('a')
  link.href = url
  link.download = file.name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
