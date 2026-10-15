import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
    if (!bytes.length || bytes.length > MAX_ATTACHMENT_BYTES)
      throw new Error('Each attachment must be nonempty and no larger than 10 MB.')
    const safeName =
      basename(name.replace(/\\/g, '/'))
        .replace(/[\x00-\x1f]/g, '_')
        .slice(0, 180) || 'attachment'
    const id = randomUUID()
    const dir = join(this.root, id)
    mkdirSync(dir)
    const path = join(dir, `content${extname(safeName)}`)
    const mimeType =
      imageTypes[extname(safeName).toLowerCase()] ??
      (extname(safeName).toLowerCase() === '.pdf' ? 'application/pdf' : 'application/octet-stream')
    const attachment: Attachment = { id, name: safeName, size: bytes.length, mimeType, path }
    writeFileSync(path, bytes)
    writeFileSync(join(dir, 'metadata.json'), JSON.stringify(attachment))
    return attachment
  }

  get(id: string): Attachment {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid attachment.')
    const value = JSON.parse(readFileSync(join(this.root, id, 'metadata.json'), 'utf8')) as Attachment
    // Derive the location from the store rather than a caller-supplied path.
    return { ...value, path: join(this.root, id, `content${extname(basename(value.name))}`) }
  }

  resolve(ids: string[] = []): Attachment[] {
    if (ids.length > MAX_ATTACHMENTS) throw new Error('Attach up to 10 files per message.')
    return [...new Set(ids)].map((id) => this.get(id))
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
