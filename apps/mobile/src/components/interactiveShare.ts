import type { ExportedFile } from '@ramu/shared/interactiveExport'

export async function shareFile(file: ExportedFile) {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }))
  const link = globalThis.document.createElement('a')
  link.href = url
  link.download = file.name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
