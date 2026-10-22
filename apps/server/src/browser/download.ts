import { constants } from 'node:fs'
import { open, realpath, unlink, lstat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import type { AgentSessionInfo } from '@ramu/shared/types'
import { BROWSER_UPLOAD_CHUNK_BYTES } from '@ramu/shared/browserBridge'
import { resolveInRoot } from '../workspace/files'

const chunk = z.object({
  offset: z.number().int().nonnegative(),
  size: z
    .number()
    .int()
    .min(0)
    .max(32 * 1024 * 1024),
  data: z
    .string()
    .max(87384)
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
})
/** Creates one new file in an existing authorized workspace directory; never overwrites an existing path. */
export async function saveBrowserDownload(
  session: Pick<AgentSessionInfo, 'cwd' | 'additionalDirs'>,
  path: string,
  rootIndex: number,
  read: (offset: number) => Promise<unknown>,
  active: () => void,
) {
  const roots = [session.cwd, ...session.additionalDirs]
  if (!Number.isInteger(rootIndex) || rootIndex < 0 || rootIndex >= roots.length)
    throw new Error('Unknown workspace root.')
  const root = await realpath(roots[rootIndex]!)
  const target = await resolveInRoot(root, path)
  const parent = await realpath(dirname(target))
  // Resolve existing parents before creating anything. No implicit folders or website-provided paths.
  if ((await resolveInRoot(root, path)) !== target || parent !== dirname(target))
    throw new Error('Download destination changed.')
  active()
  const handle = await open(
    target,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  )
  const created = await handle.stat()
  let complete = false
  try {
    let offset = 0
    let size: number | undefined
    do {
      active()
      const received = chunk.parse(await read(offset))
      const bytes = Buffer.from(received.data, 'base64')
      size ??= received.size
      if (
        received.offset !== offset ||
        received.size !== size ||
        bytes.length > BROWSER_UPLOAD_CHUNK_BYTES ||
        offset + bytes.length > size ||
        (!bytes.length && offset < size)
      )
        throw new Error('Invalid browser download transfer.')
      let written = 0
      while (written < bytes.length) {
        const result = await handle.write(bytes, written, bytes.length - written, offset + written)
        if (!result.bytesWritten) throw new Error('Could not save the browser download.')
        written += result.bytesWritten
      }
      offset += bytes.length
    } while (offset < size)
    active()
    const atPath = await lstat(target)
    if (
      (await resolveInRoot(root, path)) !== target ||
      (await realpath(root)) !== root ||
      atPath.ino !== created.ino ||
      atPath.dev !== created.dev
    )
      throw new Error('Download destination changed.')
    await handle.sync()
    complete = true
    return { path, workspaceRoot: rootIndex, bytes: offset }
  } finally {
    await handle.close()
    if (!complete) {
      // Do not delete somebody else's replacement if this destination changed during the transfer.
      const current = await lstat(target).catch(() => null)
      if (current?.ino === created.ino && current.dev === created.dev) await unlink(target).catch(() => {})
    }
  }
}
