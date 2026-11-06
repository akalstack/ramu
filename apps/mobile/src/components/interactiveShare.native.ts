import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { createInteractiveSharer } from '@ramu/shared/interactiveShare'

/** Uniform type identifiers iOS uses to offer the right apps for each export. */
const UTI: Record<string, string> = {
  'text/html': 'public.html',
  'text/markdown': 'net.daringfireball.markdown',
  'image/svg+xml': 'public.svg-image',
}

export const shareFile = createInteractiveSharer({
  available: () => Sharing.isAvailableAsync(),
  write: async (exported) => {
    // One replaceable file per format prevents accumulating a file for every shared revision.
    const extension = exported.name.slice(exported.name.lastIndexOf('.') + 1).replace(/[^a-z]/gi, '') || 'txt'
    const file = new File(Paths.cache, `ramu-export.${extension}`)
    await file.write(exported.content)
    return file.uri
  },
  share: (uri, metadata) =>
    Sharing.shareAsync(uri, {
      mimeType: metadata.mimeType,
      UTI: UTI[metadata.mimeType] ?? 'public.plain-text',
      dialogTitle: metadata.name,
    }),
})
