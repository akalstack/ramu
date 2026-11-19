import { expect, it, vi } from 'vitest'
import { createInteractiveSharer } from '../src/interactiveShare'
import type { ExportedFile } from '../src/interactiveExport'
const file: ExportedFile = { name: 'Title.md', content: '# Exact', mimeType: 'text/markdown' }
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
  const first = action(file)
  await vi.waitFor(() => expect(share).toHaveBeenCalledTimes(1))
  await expect(action(file)).rejects.toThrow('Another share')
  expect(write).toHaveBeenCalledTimes(1)
  expect(write).toHaveBeenCalledWith(file)
  expect(share).toHaveBeenCalledWith('file:///cache/export.html', { name: 'Title.md', mimeType: 'text/markdown' })
  rejectSheet(new Error('Share failed'))
  await expect(first).rejects.toThrow('Share failed')
  await expect(action(file)).resolves.toBeUndefined()
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
  await expect(action(file)).rejects.toThrow('unavailable')
  expect(write).not.toHaveBeenCalled()
  await expect(action(file)).rejects.toThrow('Disk full')
  expect(share).not.toHaveBeenCalled()
  await expect(action(file)).resolves.toBeUndefined()
  expect(share).toHaveBeenCalledTimes(1)
})
