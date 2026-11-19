import { expect, it, vi } from 'vitest'

vi.mock('../src/editor/monaco', () => ({ monaco: {} }))
vi.mock('../src/editor/MarkdownEditor', () => ({ MarkdownEditor: () => null }))

it('edits a doc as rich text unless it has footnotes or raw HTML, which only Markdown keeps', async () => {
  const { richTextFits } = await import('../src/pages/DocRichEditor')
  expect(
    richTextFits('## Goals\n\n- [ ] Ship sync\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```mermaid\nflowchart LR\n```\n'),
  ).toBe(true)
  expect(richTextFits('Ship it.[^1]\n\n[^1]: On Friday.')).toBe(false)
  expect(richTextFits('Intro\n\n<details><summary>More</summary>x</details>')).toBe(false)
  expect(richTextFits('Use a < b and a <br> inline.')).toBe(true)
})
