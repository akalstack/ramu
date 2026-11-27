import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { AttachmentStore } from '../src/attachments'
import { ATTACHMENT_STREAM_PATH, serveAttachmentStream } from '../src/attachmentStream'

const servers: ReturnType<typeof createServer>[] = []
afterEach(() => servers.splice(0).forEach((server) => server.close()))

async function serve(store: AttachmentStore) {
  const server = createServer((req, res) => {
    if (!serveAttachmentStream(req, res, store)) res.writeHead(418).end()
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

it('streams a video attachment by its single-file address, with ranges so a player can seek', async () => {
  const store = new AttachmentStore(mkdtempSync(join(tmpdir(), 'ramu-stream-')))
  const video = store.add('clip.mp4', Buffer.from('0123456789'))
  const base = await serve(store)
  const address = `${base}${ATTACHMENT_STREAM_PATH}${store.streamToken(video.id)}`
  const whole = await fetch(address)
  expect(whole.status).toBe(200)
  expect(whole.headers.get('content-type')).toBe('video/mp4')
  expect(await whole.text()).toBe('0123456789')
  const part = await fetch(address, { headers: { Range: 'bytes=2-4' } })
  expect(part.status).toBe(206)
  expect(part.headers.get('content-range')).toBe('bytes 2-4/10')
  expect(await part.text()).toBe('234')
  expect((await fetch(address, { headers: { Range: 'bytes=-3' } })).headers.get('content-range')).toBe('bytes 7-9/10')
  expect((await fetch(address, { headers: { Range: 'bytes=20-' } })).status).toBe(416)
  // Any other address, or a token that was never issued, is not a file.
  expect((await fetch(`${base}${ATTACHMENT_STREAM_PATH}not-a-token`)).status).toBe(404)
  expect((await fetch(`${base}/other`)).status).toBe(418)
})

it('streams only video and audio', () => {
  const store = new AttachmentStore(mkdtempSync(join(tmpdir(), 'ramu-stream-')))
  const notes = store.add('notes.txt', Buffer.from('hello'))
  expect(() => store.streamToken(notes.id)).toThrow('not a video or audio file')
})
