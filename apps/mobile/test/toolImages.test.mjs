import { test } from 'node:test'
import assert from 'node:assert/strict'
import { transcript } from '../src/runtime/transcript.ts'

const tool = (rows) => rows.find((item) => item.kind === 'tool')

test('a tool row carries the images its call returned, as the desktop shows them when the row is opened', () => {
  const rows = transcript([
    { kind: 'tool-use', toolUseId: 's1', name: 'mcp__ramu__browser_screenshot', summary: '', input: '{}' },
    {
      kind: 'tool-result',
      toolUseId: 's1',
      isError: false,
      summary: 'Screenshot',
      content: [
        { type: 'text', text: 'Screenshot' },
        { type: 'image', mimeType: 'image/png', data: 'AAAA' },
        { type: 'image', mimeType: 'image/png', uri: 'https://example.com/a.png', alt: 'Page' },
        { type: 'resource', uri: 'file:///b.webp', name: 'b.webp', mimeType: 'image/webp', blob: 'BBBB' },
      ],
    },
  ])
  assert.deepEqual(tool(rows).images, [
    { uri: 'data:image/png;base64,AAAA' },
    { uri: 'https://example.com/a.png', alt: 'Page' },
    { uri: 'data:image/webp;base64,BBBB', alt: 'b.webp' },
  ])
})

test('reading an image file shows that file from the host; a call with no image carries none', () => {
  const rows = transcript([
    {
      kind: 'tool-use',
      toolUseId: 'r1',
      name: 'Read',
      summary: '/repo/shot.png',
      input: '{"file_path":"/repo/shot.png"}',
    },
    { kind: 'tool-result', toolUseId: 'r1', isError: false, summary: '' },
    { kind: 'tool-use', toolUseId: 'b1', name: 'Bash', summary: 'ls', input: '{"command":"ls"}' },
    { kind: 'tool-result', toolUseId: 'b1', isError: false, summary: 'a\nb' },
  ])
  const [read, bash] = rows
    .filter((item) => item.kind === 'tool' || item.kind === 'tools')
    .flatMap((item) => (item.kind === 'tools' ? item.items : [item]))
  assert.deepEqual(read.images, [{ uri: '/repo/shot.png', alt: 'shot.png' }])
  assert.equal(bash.images, undefined)
})
