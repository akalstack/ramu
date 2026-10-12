import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const desktop = vi.hoisted(() => ({
  items: [] as { label?: string; enabled?: boolean; click?: () => void }[],
  closed: (() => {}) as () => void,
  readText: vi.fn(), writeText: vi.fn(), write: vi.fn(), save: vi.fn(), message: vi.fn(), reveal: vi.fn(),
}))
vi.mock('electron', () => ({
  clipboard: { readText: desktop.readText, writeText: desktop.writeText, write: desktop.write },
  ClipboardItem: class { constructor(public data: Record<string, unknown>) {} },
  dialog: { showSaveDialog: desktop.save, showMessageBox: desktop.message },
  shell: { showItemInFolder: desktop.reveal },
  nativeImage: { createFromPath: () => ({ isEmpty: () => false, toPNG: () => Buffer.from('decoded png') }) },
  Menu: { buildFromTemplate: (items: typeof desktop.items) => { desktop.items = items; return { popup: ({ callback }: { callback: () => void }) => { desktop.closed = callback } } } },
}))
import { terminalMenu } from '../src/main/terminalMenu'
import { editorMenu } from '../src/main/editorMenu'
import { attachmentActions } from '../src/main/attachmentActions'
import { AttachmentStore } from '../src/main/attachments'

let root: string
const window = {} as BrowserWindow
beforeEach(() => {
  vi.clearAllMocks()
  desktop.write.mockResolvedValue(undefined); desktop.writeText.mockResolvedValue(undefined)
  root = mkdtempSync(join(tmpdir(), 'ramu-desktop-menu-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

it('offers review comments and copy in read-only editors without edit actions', async () => {
  const result = editorMenu(window, { selection: 'selected code', editable: false, comment: true }, { x: 10, y: 10 })
  expect(desktop.items.map((item) => item.label)).not.toContain('Paste')
  expect(desktop.items.map((item) => item.label)).not.toContain('Cut')
  desktop.items.find((item) => item.label === 'Add review comment')!.click!()
  expect(await result).toBe('comment')
})

it('waits for native clipboard cut before editing the Monaco buffer', async () => {
  let finish!: () => void
  desktop.writeText.mockReturnValue(new Promise<void>((resolve) => { finish = resolve }))
  const result = editorMenu(window, { selection: 'selected code', editable: true, comment: false }, { x: 10, y: 10 })
  desktop.items.find((item) => item.label === 'Cut')!.click!()
  desktop.closed()
  expect(desktop.writeText).toHaveBeenCalledWith('selected code')
  finish()
  expect(await result).toBe('cut')
})

it('returns native editor paste after menu dismissal without truncating it', async () => {
  desktop.readText.mockResolvedValue('pasted code')
  const result = editorMenu(window, { selection: '', editable: true, comment: false }, { x: 10, y: 10 })
  desktop.items.find((item) => item.label === 'Paste')!.click!()
  desktop.closed()
  expect(await result).toEqual({ paste: 'pasted code' })
})

it('returns terminal paste after the native menu closes, without losing the async clipboard read', async () => {
  let finish!: (text: string) => void
  desktop.readText.mockReturnValue(new Promise<string>((resolve) => { finish = resolve }))
  const result = terminalMenu(window, '', { x: 10, y: 10 })
  desktop.items.find((item) => item.label === 'Paste')!.click!()
  desktop.closed()
  finish('echo hello\n')
  expect(await result).toEqual({ paste: 'echo hello\n' })
})

it('copies the terminal selection rather than the hidden textarea, and dismisses without action', async () => {
  const result = terminalMenu(window, 'selected terminal output', { x: 10, y: 10 })
  desktop.items.find((item) => item.label === 'Copy')!.click!()
  desktop.closed()
  expect(await result).toBeNull()
  expect(desktop.writeText).toHaveBeenCalledWith('selected terminal output')
})

it('exports an attachment copy and leaves its history copy intact, including save cancellation', async () => {
  const store = new AttachmentStore(join(root, 'attachments'))
  const file = store.add('notes.txt', Buffer.from('original notes'))
  const actions = attachmentActions(window, store), destination = join(root, 'exported.txt')
  desktop.save.mockResolvedValue({ canceled: false, filePath: destination })
  expect(await actions.save(file.id)).toBe(true)
  expect(readFileSync(destination, 'utf8')).toBe('original notes')
  expect(readFileSync(file.path, 'utf8')).toBe('original notes')
  desktop.save.mockResolvedValue({ canceled: true })
  expect(await actions.save(file.id)).toBe(false)
  expect(readFileSync(file.path, 'utf8')).toBe('original notes')
})

it('copies image pixels to the clipboard and returns the attachment removal choice', async () => {
  const store = new AttachmentStore(join(root, 'attachments'))
  const file = store.add('image.png', Buffer.from('stored image'))
  const actions = attachmentActions(window, store)
  await actions.copy(file.id)
  const item = desktop.write.mock.calls[0]![0][0] as { data: Record<string, Blob> }
  expect(item.data['image/png']!.type).toBe('image/png')
  expect(await item.data['image/png']!.text()).toBe('decoded png')
  const choice = actions.menu(file.id, true, { x: 10, y: 10 })
  desktop.items.find((item) => item.label === 'Remove attachment')!.click!()
  desktop.closed()
  expect(await choice).toBe('remove')
  expect(store.get(file.id)).toEqual(file)
})
