import { expect, it, vi } from 'vitest'
import { createInteractiveSharer } from '../src/interactiveShare'
import type { InteractiveDocument } from '../src/interactive'
const document: InteractiveDocument = {
  reference: {
    id: 'c',
    version: 1,
    sessionId: 's',
    title: 'Title',
    summary: '',
    digest: 'hash',
    createdAt: 1,
    checked: true,
  },
  html: '<p>Exact</p>',
  preview: null,
}
it('keeps a share in progress from overwriting its file and releases the lock after a rejected sheet', async () => {
  let rejectSheet!: (error: Error) => void
  const sheet = new Promise<void>((_resolve, reject) => {
    rejectSheet = reject
  })
  const write = vi.fn(() => 'file:///cache/export.html')
  const share = vi
    .fn()
    .mockImplementationOnce(() => sheet)
    .mockResolvedValue(undefined)
  const action = createInteractiveSharer({ available: async () => true, write, share })
  const first = action(document, null, true)
  await vi.waitFor(() => expect(share).toHaveBeenCalledTimes(1))
  await expect(action(document, null)).rejects.toThrow('Another share')
  expect(write).toHaveBeenCalledTimes(1)
  expect(write).toHaveBeenCalledWith(expect.stringContaining(`<body>${document.html}</body>`))
  rejectSheet(new Error('Share failed'))
  await expect(first).rejects.toThrow('Share failed')
  await expect(action(document, null)).resolves.toBeUndefined()
  expect(write).toHaveBeenCalledTimes(2)
})
it('does not write when sharing is unavailable and recovers from a failed file write', async () => {
  const available = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
  const write = vi
    .fn()
    .mockImplementationOnce(() => {
      throw new Error('Disk full')
    })
    .mockReturnValue('file:///cache/export.html')
  const share = vi.fn().mockResolvedValue(undefined)
  const action = createInteractiveSharer({ available, write, share })
  await expect(action(document, null)).rejects.toThrow('unavailable')
  expect(write).not.toHaveBeenCalled()
  await expect(action(document, null)).rejects.toThrow('Disk full')
  expect(share).not.toHaveBeenCalled()
  await expect(action(document, null)).resolves.toBeUndefined()
  expect(share).toHaveBeenCalledTimes(1)
})
