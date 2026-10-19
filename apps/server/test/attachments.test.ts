import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { registerAgentHandlers } from '../src/ipc/handlers/agent'
import type { HandlerContext } from '../src/ipc/types'
import { AttachmentStore, attachmentPrompt, nativeBlocks, MAX_ATTACHMENT_BYTES } from '../src/attachments'

const roots: string[] = []
const setup = () => {
  const root = mkdtempSync(join(tmpdir(), 'ramu-attachments-'))
  roots.push(root)
  return { root, store: new AttachmentStore(root) }
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('thread attachments', () => {
  it('persists copies with safe names and resolves them after restarting', () => {
    const { store, root } = setup()
    const file = store.add('../../metadata.json', Buffer.from('original file contents'))
    expect(file.name).toBe('metadata.json')
    expect(readFileSync(file.path, 'utf8')).toBe('original file contents')
    expect(new AttachmentStore(root).resolve([file.id])).toEqual([file])
    expect(() => store.get('../outside')).toThrow('Invalid attachment')
  })
  it('checks retained references after restart and refuses missing or changed bytes before delivery', () => {
    const { store, root } = setup()
    const kept = store.add('kept.txt', Buffer.from('kept'))
    const missing = store.add('missing.bin', Buffer.from('missing'))
    const changed = store.add('changed.bin', Buffer.from('original'))
    rmSync(missing.path)
    writeFileSync(changed.path, 'different size')
    const restarted = new AttachmentStore(root)
    expect(restarted.status([kept.id, missing.id, changed.id, kept.id, '../outside'])).toEqual([
      { id: kept.id, available: true },
      { id: missing.id, available: false },
      { id: changed.id, available: false },
      { id: '../outside', available: false },
    ])
    expect(() => restarted.resolve([kept.id, missing.id])).toThrow()
    expect(() => restarted.resolve([changed.id])).toThrow('Attach it again')
    expect(() => restarted.status(Array(11).fill(kept.id))).toThrow('10 files')
    expect(readFileSync(kept.path, 'utf8')).toBe('kept')
  })
  it('exposes a bounded availability check through the existing validated attachment API', async () => {
    const { store } = setup()
    const file = store.add('retained.txt', Buffer.from('retained bytes'))
    const handler = registerAgentHandlers({ attachmentStore: store } as unknown as HandlerContext)[
      'attachments.status'
    ]!
    const args = handler.args.parse([[file.id]])
    expect(await handler.run(...args)).toEqual([{ id: file.id, available: true }])
    expect(() => handler.args.parse([Array(11).fill(file.id)])).toThrow()
    expect(() => handler.args.parse(['not an array'])).toThrow()
    expect(() => handler.args.parse([['x'.repeat(1000)]])).toThrow()
    rmSync(file.path)
    expect(await handler.run(...args)).toEqual([{ id: file.id, available: false }])
  })
  it('inlines readable files and references binary files instead of corrupting them', () => {
    const { store } = setup()
    const text = store.add('example.ts', Buffer.from('export const answer = 42'))
    const binary = store.add('example.bin', Buffer.from([0, 255, 0, 128]))
    const prompt = attachmentPrompt('review these', [text, binary])
    expect(prompt).toContain('export const answer = 42')
    expect(prompt).toContain(binary.path)
    expect(prompt).toContain('file-reading tools')
    expect(prompt).not.toContain('\ufffd')
  })
  it('supports image previews and attachment-only prompts', () => {
    const { store } = setup()
    const image = store.add('pasted-image.png', Buffer.from('image bytes'))
    expect(store.preview(image.id)).toBe(`data:image/png;base64,${Buffer.from('image bytes').toString('base64')}`)
    expect(attachmentPrompt('', [image])).toContain('inspect the attached files')
  })
  it('sends images and PDFs as native content blocks and leaves other files out', () => {
    const { store } = setup()
    const image = store.add('shot.png', Buffer.from('img')),
      pdf = store.add('spec.pdf', Buffer.from('%PDF-1.4')),
      text = store.add('a.txt', Buffer.from('hi'))
    const blocks = nativeBlocks([image, pdf, text])
    expect(blocks.map((b) => b.type)).toEqual(['image', 'document'])
    expect(blocks[1]).toMatchObject({
      title: 'spec.pdf',
      source: { media_type: 'application/pdf', data: Buffer.from('%PDF-1.4').toString('base64') },
    })
  })
  it('rejects empty, oversized, and excessive attachments', () => {
    const { store } = setup()
    expect(() => store.add('empty.txt', Buffer.alloc(0))).toThrow('10 MB')
    expect(() => store.add('big.txt', Buffer.alloc(MAX_ATTACHMENT_BYTES + 1))).toThrow('10 MB')
    expect(() => store.resolve(Array(11).fill('anything'))).toThrow('10 files')
  })
})
