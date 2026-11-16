import type { TransferEntry, TransferSource, TransferTarget } from '@ramu/shared/types'
import { invokeOn, invokeUncachedOn } from '../../ipc'

export type TransferProgress = { files: number; totalFiles: number; bytes: number; totalBytes: number }

/** Files written at once: enough to hide round trips on many small files without flooding either host. */
const PARALLEL_FILES = 4

/**
 * Copies items from one host to another through this app: the source host lists and reads them in chunks (gzipped
 * when that helps), the target host stages them and places everything at once, so a cancelled or failed copy leaves
 * nothing behind. Chunk calls skip the read cache so a long copy does not refresh the explorer on every write.
 */
export async function copyBetweenHosts({
  from,
  source,
  to,
  target,
  signal,
  onProgress,
}: {
  from: string
  source: TransferSource
  to: string
  target: TransferTarget
  signal?: AbortSignal
  onProgress?: (progress: TransferProgress) => void
}): Promise<string[]> {
  const { entries, bytes: totalBytes } = await invokeUncachedOn(from, 'files.transfer.manifest', source)
  const files = entries.filter((entry) => entry.kind === 'file')
  const progress: TransferProgress = { files: 0, totalFiles: files.length, bytes: 0, totalBytes }
  onProgress?.({ ...progress })
  const { id } = await invokeUncachedOn(to, 'files.transfer.begin')
  const write = (entry: TransferEntry, offset: number, data: string, gzip: boolean) =>
    invokeUncachedOn(to, 'files.transfer.write', id, {
      root: entry.root,
      path: entry.path,
      kind: entry.kind,
      mode: entry.mode,
      ...(entry.target ? { target: entry.target } : {}),
      offset,
      data,
      gzip,
    })
  const stopped = () => {
    if (signal?.aborted) throw new DOMException('The copy was cancelled.', 'AbortError')
  }
  try {
    // Folders and links first, in listing order, so every folder exists before its files arrive.
    for (const entry of entries) {
      stopped()
      if (entry.kind !== 'file') await write(entry, 0, '', false)
    }
    let next = 0
    const worker = async () => {
      for (let entry = files[next++]; entry; entry = files[next++]) {
        let offset = 0
        do {
          stopped()
          const chunk = await invokeUncachedOn(from, 'files.transfer.read', source, entry.root, entry.path, offset)
          await write(entry, offset, chunk.data, chunk.gzip)
          offset += chunk.bytes
          progress.bytes += chunk.bytes
          onProgress?.({ ...progress })
          // A file that shrank while copying ends early rather than looping on empty chunks.
          if (!chunk.bytes) break
        } while (offset < entry.size)
        progress.files++
        onProgress?.({ ...progress })
      }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL_FILES, files.length) }, worker))
    stopped()
    return await invokeOn(to, 'files.transfer.finish', id, target)
  } catch (reason) {
    await invokeUncachedOn(to, 'files.transfer.cancel', id).catch(() => {})
    throw reason
  }
}

/** "4.2 MB", in the reader's number format. */
export function formatSize(bytes: number): string {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const
  let value = bytes,
    unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return new Intl.NumberFormat(undefined, {
    style: 'unit',
    unit: units[unit],
    unitDisplay: 'short',
    maximumFractionDigits: unit ? 1 : 0,
  }).format(value)
}
