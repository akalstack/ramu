// Editing a doc in rich text changes only what the person changed: the rest keeps the Markdown as the agent wrote it.
import { expect, it, vi } from 'vitest'

vi.mock('../src/editor/monaco', () => ({ monaco: {} }))
vi.mock('../src/workspace/HostProvider', () => ({ useHost: () => ({}) }))

it('puts a rich-text edit onto the Markdown as written, leaving untouched lines alone', async () => {
  const { richTextMarkdown } = await import('../src/editor/MarkdownEditor')
  const { keepWritten } = await import('../src/pages/DocRichEditor')
  const raw =
    '* Ship sync\n* Fix login\n\nSee [the plan][1].\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nOpen in May.\n\n[1]: https://example.dev\n'
  const rich = richTextMarkdown(raw)
  // The editor spells several lines its own way before anything is typed.
  expect(rich).not.toBe(raw)
  const edited = rich.replace('Open in May.', 'Open in June.')
  expect(keepWritten({ raw, rich }, edited)).toBe(raw.replace('Open in May.', 'Open in June.'))
  // Nothing typed: nothing changes.
  expect(keepWritten({ raw, rich }, rich)).toBe(raw)
})
