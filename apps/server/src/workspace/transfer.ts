// Copying files and folders between hosts. The app reads chunks from one host's server and writes them to another's,
// so neither host needs to reach the other. Chunks are gzipped when that makes them meaningfully smaller.
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, open, readdir, readlink, realpath, rm, symlink } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, sep } from 'node:path'
import { promisify } from 'node:util'
import { gunzip, gzip } from 'node:zlib'
import type { TransferChunk, TransferEntry, TransferManifest } from '@ramu/shared/types'
import { importEntries, resolveInRoot } from './files'

const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)

/** Raw bytes per chunk: small enough for one request once base64-encoded, large enough to keep round trips few. */
export const TRANSFER_CHUNK_BYTES = 4 * 1024 * 1024
export const MAX_TRANSFER_ENTRIES = 50_000
export const MAX_TRANSFER_BYTES = 20 * 1024 * 1024 * 1024
/** A transfer nobody wrote to for this long is abandoned and its staged files are removed. */
const IDLE_MS = 60 * 60 * 1000
const MAX_OPEN_TRANSFERS = 16

/** Formats that are already compressed: gzipping them costs time and saves nothing. */
const COMPRESSED = new Set(
  '.7z .aac .apk .avif .br .bz2 .dmg .docx .epub .flac .gif .gz .heic .ipa .jar .jpeg .jpg .m4a .m4v .mkv .mov .mp3 .mp4 .ogg .opus .pdf .png .pptx .rar .tgz .wasm .webm .webp .whl .woff .woff2 .xlsx .xz .zip .zst'.split(
    ' ',
  ),
)

function inside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/** Every file, folder and link under the chosen items, without following links or entering `.git`. */
export async function transferManifest(roots: string[]): Promise<TransferManifest> {
  const entries: TransferEntry[] = []
  let bytes = 0
  const add = (entry: TransferEntry) => {
    if (entries.length >= MAX_TRANSFER_ENTRIES)
      throw new Error(`Copy at most ${MAX_TRANSFER_ENTRIES.toLocaleString('en')} files and folders at once.`)
    bytes += entry.size
    if (bytes > MAX_TRANSFER_BYTES) throw new Error('Copy at most 20 GB between hosts at once.')
    entries.push(entry)
  }
  const visit = async (root: number, absolute: string, path: string): Promise<void> => {
    const info = await lstat(absolute)
    const mode = info.mode & 0o777
    if (info.isSymbolicLink()) add({ root, path, kind: 'link', size: 0, mode, target: await readlink(absolute) })
    else if (info.isFile()) add({ root, path, kind: 'file', size: info.size, mode })
    else if (info.isDirectory()) {
      add({ root, path, kind: 'dir', size: 0, mode })
      for (const name of (await readdir(absolute)).sort())
        if (name !== '.git') await visit(root, join(absolute, name), `${path}/${name}`)
    }
  }
  for (const [index, absolute] of roots.entries()) {
    if (!isAbsolute(absolute)) throw new Error('Expected an absolute path.')
    await visit(index, absolute, basename(absolute))
  }
  return { entries, bytes }
}

/**
 * One chunk of a file named by the manifest of `root`. The path must stay inside that item, even through links in
 * its folders, so a caller cannot read anything it was not offered.
 */
export async function readTransferChunk(root: string, path: string, offset: number): Promise<TransferChunk> {
  const segments = path.split('/')
  if (segments[0] !== basename(root) || segments.some((segment) => !segment || segment === '..' || segment === '.git'))
    throw new Error('That file is not part of this copy.')
  const absolute = join(dirname(root), ...segments)
  if (!inside(root, absolute) || !inside(await realpath(root), await realpath(absolute)))
    throw new Error('That file is not part of this copy.')
  if (!(await lstat(absolute)).isFile()) throw new Error('Only files are read in chunks.')
  const handle = await open(absolute, 'r')
  try {
    const buffer = Buffer.alloc(TRANSFER_CHUNK_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, TRANSFER_CHUNK_BYTES, offset)
    const raw = buffer.subarray(0, bytesRead)
    if (raw.length >= 1024 && !COMPRESSED.has(extname(absolute).toLowerCase())) {
      const packed = await gzipAsync(raw, { level: 6 })
      if (packed.length < raw.length * 0.9) return { data: packed.toString('base64'), gzip: true, bytes: raw.length }
    }
    return { data: raw.toString('base64'), gzip: false, bytes: raw.length }
  } finally {
    await handle.close()
  }
}

/** What arrives in one write: a folder, a link, or a chunk of a file appended at `offset`. */
export type TransferWrite = Pick<TransferEntry, 'root' | 'path' | 'kind' | 'mode' | 'target'> & {
  offset: number
  data: string
  gzip: boolean
}

type Inbox = { staging: string; bytes: number; touched: number }

/** Files arriving from another host, staged in a temporary folder until the copy is complete. */
export class TransferInbox {
  private open = new Map<string, Inbox>()
  constructor(private readonly now: () => number = Date.now) {}

  async begin(): Promise<string> {
    await this.sweep()
    if (this.open.size >= MAX_OPEN_TRANSFERS) throw new Error('Too many copies are running. Wait for one to finish.')
    const id = randomUUID()
    this.open.set(id, {
      staging: await realpath(await mkdtemp(join(tmpdir(), 'ramu-transfer-'))),
      bytes: 0,
      touched: this.now(),
    })
    return id
  }

  async write(id: string, write: TransferWrite): Promise<void> {
    const inbox = this.inbox(id)
    const absolute = await resolveInRoot(inbox.staging, `${write.root}/${write.path}`)
    if (dirname(absolute) === inbox.staging) throw new Error('That file is not part of this copy.')
    await mkdir(dirname(absolute), { recursive: true })
    if (write.kind === 'dir') await mkdir(absolute, { recursive: true, mode: write.mode | 0o700 })
    else if (write.kind === 'link') {
      if (!write.target) throw new Error('A link needs a target.')
      await symlink(write.target, absolute)
    } else {
      const packed = Buffer.from(write.data, 'base64')
      const bytes = write.gzip ? await gunzipAsync(packed, { maxOutputLength: TRANSFER_CHUNK_BYTES }) : packed
      if (bytes.length > TRANSFER_CHUNK_BYTES) throw new Error('A chunk is larger than allowed.')
      inbox.bytes += bytes.length
      if (inbox.bytes > MAX_TRANSFER_BYTES) throw new Error('Copy at most 20 GB between hosts at once.')
      // Chunks arrive in order; a gap or overlap means a retry went wrong, and the copy must not silently corrupt.
      const handle = await open(absolute, write.offset === 0 ? 'w' : 'r+', write.mode | 0o600)
      try {
        if (write.offset !== (await handle.stat()).size) throw new Error('A chunk arrived out of order. Copy again.')
        await handle.write(bytes, 0, bytes.length, write.offset)
        // Owner keeps write access so later chunks can append; executable and group bits carry over.
        if (write.offset === 0) await handle.chmod(write.mode | 0o600)
      } finally {
        await handle.close()
      }
    }
    inbox.touched = this.now()
  }

  /** Moves the staged items into `dir` of `root` under free names, and returns where they landed. */
  async finish(id: string, root: string, dir: string): Promise<string[]> {
    const inbox = this.inbox(id)
    try {
      const staged: string[] = []
      const roots = (await readdir(inbox.staging)).map(Number).sort((a, b) => a - b)
      for (const index of roots) {
        const folder = join(inbox.staging, String(index))
        for (const name of await readdir(folder)) staged.push(join(folder, name))
      }
      if (!staged.length) throw new Error('Nothing arrived to copy.')
      return await importEntries(root, dir, staged, { move: true })
    } finally {
      await this.cancel(id)
    }
  }

  async cancel(id: string): Promise<void> {
    const inbox = this.open.get(id)
    this.open.delete(id)
    if (inbox) await rm(inbox.staging, { recursive: true, force: true })
  }

  private inbox(id: string): Inbox {
    const inbox = this.open.get(id)
    if (!inbox) throw new Error('This copy expired. Copy again.')
    return inbox
  }

  private async sweep(): Promise<void> {
    for (const [id, inbox] of this.open) if (this.now() - inbox.touched > IDLE_MS) await this.cancel(id)
  }
}

/** This host's Downloads folder, where items copied off a project land when no project is chosen. */
export async function downloadsFolder(): Promise<string> {
  const folder = join(homedir(), 'Downloads')
  await mkdir(folder, { recursive: true })
  return realpath(folder)
}
