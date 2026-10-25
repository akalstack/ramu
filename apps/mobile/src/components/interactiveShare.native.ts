import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { createInteractiveSharer } from '@ramu/shared/interactiveShare'
export const shareInteractive = createInteractiveSharer({
  available: () => Sharing.isAvailableAsync(),
  write: async (html) => {
    // A single replaceable export prevents accumulating one file for every shared revision.
    const file = new File(Paths.cache, 'ramu-interactive-export.html')
    await file.write(html)
    return file.uri
  },
  share: (uri, metadata) =>
    Sharing.shareAsync(uri, { mimeType: metadata.mimeType, UTI: 'public.html', dialogTitle: metadata.name }),
})
