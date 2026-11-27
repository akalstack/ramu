import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attachmentsOf, keepAttachment } from '../src/runtime/attachmentPreviews.ts'

test('a file uploaded from this phone is known by its id, so a message on its way can show it', () => {
  const photo = { id: 'a1', name: 'photo.jpg', mimeType: 'image/jpeg', size: 10 }
  keepAttachment(photo)
  // Only files uploaded here are known; an unknown id is left out rather than drawn as a blank tile.
  assert.deepEqual(attachmentsOf(['a1', 'gone']), [photo])
  assert.deepEqual(attachmentsOf(undefined), [])
})
