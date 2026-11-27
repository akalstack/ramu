import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { AttachmentStore, attachmentLimit } from '../src/attachments'

const store = () => new AttachmentStore(mkdtempSync(join(tmpdir(), 'ramu-uploads-')))

it('takes a phone video in parts, in order, and keeps it as a video once every byte has arrived', () => {
  const files = store()
  const bytes = Buffer.from('a video recorded on a phone')
  const token = files.beginUpload('IMG_0001.MOV', bytes.length)
  files.appendUpload(token, 0, bytes.subarray(0, 10))
  // Parts out of order, or past the size begun with, are refused.
  expect(() => files.appendUpload(token, 2, bytes.subarray(10))).toThrow('in order')
  expect(() => files.appendUpload(token, 1, Buffer.alloc(bytes.length))).toThrow('does not fit')
  expect(() => files.finishUpload(token)).toThrow('missing parts')
  files.appendUpload(token, 1, bytes.subarray(10))
  const video = files.finishUpload(token)
  expect(video).toMatchObject({ name: 'IMG_0001.MOV', mimeType: 'video/quicktime', size: bytes.length })
  expect(files.get(video.id).size).toBe(bytes.length)
  // A finished upload is gone; its token no longer takes parts.
  expect(() => files.appendUpload(token, 2, bytes)).toThrow('no longer waiting')
})

it('allows a video or 3D model up to 100 MB and any other file up to 10 MB', () => {
  expect(attachmentLimit('clip.mp4')).toBe(100 * 1024 * 1024)
  expect(attachmentLimit('clip.m4v')).toBe(100 * 1024 * 1024)
  expect(attachmentLimit('notes.txt')).toBe(10 * 1024 * 1024)
  const files = store()
  expect(() => files.beginUpload('notes.txt', 11 * 1024 * 1024)).toThrow('10 MB')
  expect(() => files.beginUpload('clip.mov', 101 * 1024 * 1024)).toThrow('100 MB')
})
