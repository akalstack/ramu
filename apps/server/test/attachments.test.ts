import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AttachmentStore, attachmentPrompt, nativeBlocks, MAX_ATTACHMENT_BYTES } from '../src/attachments'

const roots: string[] = []
const setup = () => { const root = mkdtempSync(join(tmpdir(), 'ramu-attachments-')); roots.push(root); return { root, store: new AttachmentStore(root) } }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('chat attachments', () => {
  it('persists copies with safe names and resolves them after restarting', () => {
    const { store, root } = setup()
    const file = store.add('../../metadata.json', Buffer.from('original file contents'))
    expect(file.name).toBe('metadata.json')
    expect(readFileSync(file.path, 'utf8')).toBe('original file contents')
    expect(new AttachmentStore(root).resolve([file.id])).toEqual([file])
    expect(() => store.get('../outside')).toThrow('Invalid attachment')
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
    const image = store.add('shot.png', Buffer.from('img')), pdf = store.add('spec.pdf', Buffer.from('%PDF-1.4')), text = store.add('a.txt', Buffer.from('hi'))
    const blocks = nativeBlocks([image, pdf, text])
    expect(blocks.map((b) => b.type)).toEqual(['image', 'document'])
    expect(blocks[1]).toMatchObject({ title: 'spec.pdf', source: { media_type: 'application/pdf', data: Buffer.from('%PDF-1.4').toString('base64') } })
  })
  it('rejects empty, oversized, and excessive attachments', () => {
    const { store } = setup()
    expect(() => store.add('empty.txt', Buffer.alloc(0))).toThrow('10 MB')
    expect(() => store.add('big.txt', Buffer.alloc(MAX_ATTACHMENT_BYTES + 1))).toThrow('10 MB')
    expect(() => store.resolve(Array(11).fill('anything'))).toThrow('10 files')
  })
})
