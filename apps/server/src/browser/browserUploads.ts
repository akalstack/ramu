import { randomUUID } from 'node:crypto'
import { MAX_BROWSER_UPLOAD_BYTES, BROWSER_UPLOAD_CHUNK_BYTES } from '@ramu/shared/browserBridge'

const MAX_BROWSER_UPLOAD = MAX_BROWSER_UPLOAD_BYTES
const BROWSER_UPLOAD_CHUNK = BROWSER_UPLOAD_CHUNK_BYTES
export interface UploadOwner {
  hostId: string
  threadId: string
  runId: string
  tabId: string
  generation: number
}
interface Upload {
  owner: UploadOwner
  name: string
  size: number
  received: number
  chunks: Buffer[]
  timer: NodeJS.Timeout
}

/** Opaque, short-lived, single-use transfer handles. No uploaded file is written to the viewing device. */
export class BrowserUploads {
  private readonly uploads = new Map<string, Upload>()
  begin(owner: UploadOwner, name: string, size: number): string {
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      size > MAX_BROWSER_UPLOAD ||
      !name ||
      name.length > 255 ||
      // eslint-disable-next-line no-control-regex -- rejects control characters on purpose
      /[/\\\x00-\x1f\x7f]/.test(name)
    )
      throw new Error('Invalid browser upload file or size (maximum 8 MiB).')
    if (this.uploads.size >= 4) throw new Error('Too many browser uploads. Finish or cancel a transfer first.')
    const id = randomUUID()
    const timer = setTimeout(() => this.discard(id), 60_000)
    timer.unref()
    this.uploads.set(id, { owner: { ...owner }, name, size, received: 0, chunks: [], timer })
    return id
  }
  private owned(id: string, owner: UploadOwner): Upload {
    const upload = this.uploads.get(id)
    if (!upload) throw new Error('That upload expired or was already used. Start a new transfer.')
    if (
      ['hostId', 'threadId', 'runId', 'tabId'].some(
        (key) => upload.owner[key as keyof UploadOwner] !== owner[key as keyof UploadOwner],
      )
    )
      throw new Error('That upload belongs to another browser run or tab.')
    if (upload.owner.generation !== owner.generation) {
      this.discard(id)
      throw new Error('Browser control changed. Start a new transfer after taking a fresh snapshot.')
    }
    return upload
  }
  chunk(id: string, owner: UploadOwner, offset: number, data: string): number {
    const upload = this.owned(id, owner)
    if (
      offset !== upload.received ||
      typeof data !== 'string' ||
      data.length > 87384 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)
    )
      throw new Error('Invalid or repeated browser upload chunk. Do not replay a transfer.')
    const bytes = Buffer.from(data, 'base64')
    if (!bytes.length || bytes.length > BROWSER_UPLOAD_CHUNK || upload.received + bytes.length > upload.size)
      throw new Error('Browser upload exceeds its declared size.')
    upload.chunks.push(bytes)
    upload.received += bytes.length
    return upload.received
  }
  consume(id: string, owner: UploadOwner): { name: string; data: string } {
    const upload = this.owned(id, owner)
    if (upload.received !== upload.size) throw new Error('That browser upload is incomplete.')
    this.discard(id)
    return { name: upload.name, data: Buffer.concat(upload.chunks, upload.size).toString('base64') }
  }
  cancel(id: string, owner: UploadOwner): void {
    this.owned(id, owner)
    this.discard(id)
  }
  private discard(id: string): void {
    const upload = this.uploads.get(id)
    if (upload) clearTimeout(upload.timer)
    this.uploads.delete(id)
  }
  endRun(hostId: string, threadId: string, runId: string): void {
    for (const [id, upload] of this.uploads)
      if (upload.owner.hostId === hostId && upload.owner.threadId === threadId && upload.owner.runId === runId)
        this.discard(id)
  }
  closeTab(tabId: string): void {
    for (const [id, upload] of this.uploads) if (upload.owner.tabId === tabId) this.discard(id)
  }
  close(): void {
    for (const id of this.uploads.keys()) this.discard(id)
  }
}
