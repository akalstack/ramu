import type { ExportedFile } from './interactiveExport'
export interface InteractiveShareAdapter {
  available(): Promise<boolean>
  write(file: ExportedFile): string | Promise<string>
  share(uri: string, metadata: { name: string; mimeType: string }): Promise<void>
}
/** Serialize access to a single cache file until the native share sheet closes; failures always release it. */
export function createInteractiveSharer(adapter: InteractiveShareAdapter) {
  let sharing = false
  return async (file: ExportedFile): Promise<void> => {
    if (sharing) throw new Error('Another share is open.')
    sharing = true
    try {
      if (!(await adapter.available())) throw new Error('Sharing is unavailable on this device.')
      const uri = await adapter.write(file)
      await adapter.share(uri, { name: file.name, mimeType: file.mimeType })
    } finally {
      sharing = false
    }
  }
}
