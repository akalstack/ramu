import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages'
import type { Attachment } from '@ramu/shared/types'

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const MAX_ATTACHMENTS = 10
const imageTypes: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** Audio a music or sound ability saves, by extension, so it can fill a motion's audio file. */
const audioTypes: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
}

/** Video a video ability saves, by extension. */
const videoTypes: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  // What an iPhone records, and its sibling.
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
}

/** 3D models a model ability saves, which may be larger than other attachments. */
const modelTypes: Record<string, string> = {
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
}
export const MAX_MODEL_BYTES = 100 * 1024 * 1024
/** A phone video runs far past an image's limit; it arrives in parts (see `beginUpload`). */
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024
const isLarge = (name: string) => !!modelTypes[extname(name).toLowerCase()] || !!videoTypes[extname(name).toLowerCase()]
/** The most bytes a file of this name may have: videos and 3D models more than other files. */
export const attachmentLimit = (name: string) => (isLarge(name) ? MAX_MODEL_BYTES : MAX_ATTACHMENT_BYTES)
const limitFor = attachmentLimit
/** How long a part upload waits for its next part before it is dropped. */
const UPLOAD_IDLE_MS = 30 * 60_000
const MAX_UPLOADS = 8

export const isPdf = (file: Pick<Attachment, 'mimeType'>) => file.mimeType === 'application/pdf'

/** Base64 content blocks for attachments Claude reads natively: images and PDFs (as documents). */
export function nativeBlocks(attachments: Attachment[]): ContentBlockParam[] {
  return attachments.flatMap((file): ContentBlockParam[] => {
    if (file.mimeType.startsWith('image/'))
      return [
        {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: file.mimeType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
            data: readFileSync(file.path).toString('base64'),
          },
        },
      ]
    if (isPdf(file))
      return [
        {
          type: 'document' as const,
          title: file.name,
          source: {
            type: 'base64' as const,
            media_type: 'application/pdf' as const,
            data: readFileSync(file.path).toString('base64'),
          },
        },
      ]
    return []
  })
}

/** Files are copied into the app profile so queues and history never depend on originals. */
export class AttachmentStore {
  constructor(private readonly root: string) {
    mkdirSync(root, { recursive: true })
  }

  add(name: string, bytes: Buffer): Attachment {
    if (!bytes.length || bytes.length > limitFor(name))
      throw new Error(
        modelTypes[extname(name).toLowerCase()]
          ? 'A 3D model must be nonempty and no larger than 100 MB.'
          : videoTypes[extname(name).toLowerCase()]
            ? 'A video must be nonempty and no larger than 100 MB.'
            : 'Each attachment must be nonempty and no larger than 10 MB.',
      )
    const safeName =
      basename(name.replace(/\\/g, '/'))
        // eslint-disable-next-line no-control-regex -- strips control characters on purpose
        .replace(/[\x00-\x1f]/g, '_')
        .slice(0, 180) || 'attachment'
    const id = randomUUID()
    const dir = join(this.root, id)
    mkdirSync(dir)
    const path = join(dir, `content${extname(safeName)}`)
    const mimeType =
      imageTypes[extname(safeName).toLowerCase()] ??
      audioTypes[extname(safeName).toLowerCase()] ??
      videoTypes[extname(safeName).toLowerCase()] ??
      modelTypes[extname(safeName).toLowerCase()] ??
      (extname(safeName).toLowerCase() === '.pdf' ? 'application/pdf' : 'application/octet-stream')
    const attachment: Attachment = { id, name: safeName, size: bytes.length, mimeType, path }
    writeFileSync(path, bytes)
    writeFileSync(join(dir, 'metadata.json'), JSON.stringify(attachment))
    return attachment
  }

  /** Uploads arriving in parts, by token: a video from a phone is too large for one request. */
  private readonly uploads = new Map<
    string,
    { name: string; size: number; path: string; received: number; parts: number; at: number }
  >()

  /**
   * Starts an upload of `size` bytes that arrives in parts, in order. The bytes collect in the store's own folder and
   * become an attachment only once all of them have arrived, so a dropped upload leaves nothing behind but its staging.
   */
  beginUpload(name: string, size: number): string {
    if (!Number.isSafeInteger(size) || size <= 0 || size > limitFor(name))
      throw new Error(
        isLarge(name)
          ? 'A video or 3D model must be no larger than 100 MB.'
          : 'Each attachment must be nonempty and no larger than 10 MB.',
      )
    const now = Date.now()
    for (const [token, upload] of this.uploads)
      if (now - upload.at > UPLOAD_IDLE_MS) this.dropUpload(token, upload.path)
    if (this.uploads.size >= MAX_UPLOADS) throw new Error('Too many uploads at once. Wait for one to finish.')
    const token = randomUUID()
    const dir = join(this.root, '.uploads')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, token)
    writeFileSync(path, '')
    this.uploads.set(token, { name, size, path, received: 0, parts: 0, at: now })
    return token
  }

  /** Adds the next part of an upload. Parts arrive in order and never past the size the upload began with. */
  appendUpload(token: string, index: number, bytes: Buffer): void {
    const upload = this.uploads.get(token)
    if (!upload) throw new Error('This upload is no longer waiting. Attach the file again.')
    if (index !== upload.parts) throw new Error('Upload parts must arrive in order.')
    if (!bytes.length || upload.received + bytes.length > upload.size)
      throw new Error('This part does not fit the upload.')
    appendFileSync(upload.path, bytes)
    upload.received += bytes.length
    upload.parts++
    upload.at = Date.now()
  }

  /** Turns a complete upload into an attachment. */
  finishUpload(token: string): Attachment {
    const upload = this.uploads.get(token)
    if (!upload) throw new Error('This upload is no longer waiting. Attach the file again.')
    if (upload.received !== upload.size) throw new Error('The upload is missing parts. Attach the file again.')
    const bytes = readFileSync(upload.path)
    this.dropUpload(token, upload.path)
    return this.add(upload.name, bytes)
  }

  private dropUpload(token: string, path: string): void {
    this.uploads.delete(token)
    rmSync(path, { force: true })
  }

  get(id: string): Attachment {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid attachment.')
    try {
      const value = JSON.parse(readFileSync(join(this.root, id, 'metadata.json'), 'utf8')) as Attachment
      if (
        value.id !== id ||
        typeof value.name !== 'string' ||
        !value.name ||
        typeof value.mimeType !== 'string' ||
        !Number.isSafeInteger(value.size) ||
        value.size <= 0 ||
        value.size > limitFor(value.name)
      )
        throw new Error('Invalid attachment metadata.')
      // Derive the location from the store rather than a caller-supplied path.
      const path = join(this.root, id, `content${extname(basename(value.name))}`)
      const info = statSync(path)
      if (!info.isFile() || info.size !== value.size) throw new Error('Attachment bytes changed.')
      return { ...value, path }
    } catch (error) {
      throw new Error('This attachment is unavailable or changed. Attach it again or remove it.', { cause: error })
    }
  }

  /** Validate references without returning file bytes or trusting a device's stored path. */
  status(ids: string[]): { id: string; available: boolean }[] {
    if (ids.length > MAX_ATTACHMENTS) throw new Error('Attach up to 10 files per message.')
    return [...new Set(ids)].map((id) => {
      try {
        this.get(id)
        return { id, available: true }
      } catch {
        return { id, available: false }
      }
    })
  }

  resolve(ids: string[] = []): Attachment[] {
    if (ids.length > MAX_ATTACHMENTS) throw new Error('Attach up to 10 files per message.')
    return [...new Set(ids)].map((id) => this.get(id))
  }

  /** A 3D model attachment's bytes, for the viewer; refused for any other file. */
  model(id: string): Buffer {
    const attachment = this.get(id)
    if (!attachment.mimeType.startsWith('model/')) throw new Error(`${attachment.name} is not a 3D model.`)
    return readFileSync(attachment.path)
  }

  /** Readable text of a non-image attachment (up to 400 KB), or null for binary files. */
  text(id: string): string | null {
    const attachment = this.get(id)
    if (attachment.mimeType.startsWith('image/')) return null
    const bytes = readFileSync(attachment.path)
    const decoded = bytes.subarray(0, 400 * 1024).toString('utf8')
    return decoded.includes('\u0000') || decoded.includes('\ufffd') ? null : decoded
  }

  preview(id: string): string | null {
    const attachment = this.get(id)
    return attachment.mimeType.startsWith('image/')
      ? `data:${attachment.mimeType};base64,${readFileSync(attachment.path).toString('base64')}`
      : null
  }
}

export function attachmentPrompt(text: string, attachments: Attachment[] = []): string {
  const files = attachments
    .filter((file) => !file.mimeType.startsWith('image/'))
    .map((file) => {
      const bytes = readFileSync(file.path)
      // Inline readable text; binary files are available by their saved path to provider tools.
      const decoded = bytes.toString('utf8')
      const readable = bytes.length <= 1024 * 1024 && !decoded.includes('\u0000') && !decoded.includes('\ufffd')
      return `Attachment ${JSON.stringify(file.name)} (${file.size} bytes), saved at ${JSON.stringify(file.path)}${readable ? `:\n<attachment-content>\n${decoded}\n</attachment-content>` : '. Use your file-reading tools to inspect it if needed.'}`
    })
  return [text || 'Please inspect the attached files.', ...files].join('\n\n')
}
