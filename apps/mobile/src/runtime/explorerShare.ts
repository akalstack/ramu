import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'

/**
 * Hands the system share sheet a downloaded copy of a host file. The sheet receives this device's copy, never the
 * host path. A single replaceable cache file per name avoids accumulating one export per shared file.
 */
export async function shareDownloadedFile(name: string, content: string): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false
  const safe = name.replace(/[^\w.-]+/g, '_').slice(-120) || 'file'
  const file = new File(Paths.cache, `ramu-share-${safe}`)
  if (file.exists) file.delete()
  file.create()
  file.write(content)
  await Sharing.shareAsync(file.uri, { dialogTitle: name })
  return true
}
