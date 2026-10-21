import { constants } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { AgentSessionInfo } from '@ramu/shared/types'
import { resolveInRoot } from '../workspace/files'
import { MAX_BROWSER_UPLOAD_BYTES } from '@ramu/shared/browserBridge'

/** Read one regular file from the run's actual checked-out scope, never an arbitrary agent-supplied absolute path. */
export async function readBrowserUpload(session: Pick<AgentSessionInfo, 'cwd' | 'additionalDirs'>, path: string, rootIndex = 0) {
  const roots = [session.cwd, ...session.additionalDirs]
  if (!Number.isInteger(rootIndex) || rootIndex < 0 || rootIndex >= roots.length)
    throw new Error('Unknown browser upload workspace root.')
  const root = await realpath(roots[rootIndex]!)
  const target = await resolveInRoot(root, path)
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const metadata = await handle.stat()
    if (!metadata.isFile() || metadata.size > MAX_BROWSER_UPLOAD_BYTES)
      throw new Error('Browser uploads require a regular workspace file no larger than 8 MiB.')
    if ((await resolveInRoot(root, path)) !== target)
      throw new Error('The upload file changed location. Review it before trying again.')
    const data = Buffer.alloc(metadata.size + 1)
    let read = 0
    while (read < data.length) {
      const result = await handle.read(data, read, data.length - read, read)
      if (!result.bytesRead) break
      read += result.bytesRead
    }
    const after = await handle.stat()
    const atPath = await stat(await resolveInRoot(root, path))
    if (
      read !== metadata.size ||
      after.size !== metadata.size ||
      after.mtimeMs !== metadata.mtimeMs ||
      after.ctimeMs !== metadata.ctimeMs ||
      atPath.ino !== metadata.ino ||
      atPath.dev !== metadata.dev ||
      (await realpath(root)) !== root
    )
      throw new Error('The upload file changed while it was read. Review it before trying again.')
    return { name: basename(target), data: data.subarray(0, read) }
  } finally {
    await handle.close()
  }
}
