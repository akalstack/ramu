import { createReadStream } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AttachmentStore } from './attachments'

/** Where a player fetches a streamed attachment: `/attachments/stream/<token>`. */
export const ATTACHMENT_STREAM_PATH = '/attachments/stream/'

/**
 * Serves a video or audio attachment to a player by its stream token, with byte ranges so the player can seek. Answers
 * only this path; returns false for any other request so the server goes on to its usual handling.
 */
export function serveAttachmentStream(
  req: IncomingMessage,
  res: ServerResponse,
  store: Pick<AttachmentStore, 'streamed'>,
): boolean {
  const path = (req.url ?? '').split('?')[0] ?? ''
  if (!path.startsWith(ATTACHMENT_STREAM_PATH) || (req.method !== 'GET' && req.method !== 'HEAD')) return false
  const file = store.streamed(path.slice(ATTACHMENT_STREAM_PATH.length))
  if (!file) {
    res.writeHead(404, { 'Cache-Control': 'no-store' }).end()
    return true
  }
  const size = file.size
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
  let start = 0
  let end = size - 1
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1])
      if (range[2]) end = Math.min(Number(range[2]), size - 1)
    } else start = Math.max(0, size - Number(range[2]))
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end()
      return true
    }
  }
  const partial = !!range && (start !== 0 || end !== size - 1 || !!range[1] || !!range[2])
  res.writeHead(partial ? 206 : 200, {
    'Content-Type': file.mimeType,
    'Content-Length': String(end - start + 1),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=1800',
    ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
  })
  if (req.method === 'HEAD') res.end()
  else createReadStream(file.path, { start, end }).pipe(res)
  return true
}
