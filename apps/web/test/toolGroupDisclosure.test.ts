import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import type { ToolResult } from '../src/views/agent/types'
import type { ToolEntry } from '../src/views/agent/lib/toolThinking'
import { ToolGroup } from '../src/views/agent/components/ToolGroup'

vi.mock('../src/i18n', () => ({ useLanguage() {}, t: (text: string) => text }))
vi.mock('../src/chat/AgentContentView', () => ({ AgentContentView: () => null }))
vi.mock('../src/views/agent/components/RamuToolBody', () => ({ RamuToolBody: () => null }))
vi.mock('../src/views/agent/components/ThinkingRow', () => ({ ThinkingRow: () => null }))
vi.mock('../src/views/agent/components/ShadowPre', () => ({ ShadowPre: () => null }))

const tool = { kind: 'tool-use' as const, toolUseId: 'read', name: 'Read', summary: 'file.ts' }
const render = (entries: ToolEntry[]) =>
  renderToStaticMarkup(
    createElement(ToolGroup, {
      tools: [tool],
      entries,
      results: new Map(),
      cwd: '',
      active: true,
    }),
  )

it('starts a tool and thinking group collapsed while working', () => {
  const html = render([{ kind: 'thinking', text: 'Inspect the files' }, tool])
  expect(html).toContain('aria-expanded="false"')
  expect(html).not.toContain('data-tool-use-id="read"')
})

it('keeps a lone tool visible without a group disclosure', () => {
  expect(render([tool])).toContain('data-tool-use-id="read"')
})

it('keeps image results inside their collapsed tool group', () => {
  const image = { ...tool, toolUseId: 'image', name: 'view_image', summary: '{"path":"/tmp/screen.png"}' }
  const html = renderToStaticMarkup(
    createElement(ToolGroup, {
      tools: [tool, image],
      results: new Map<string, ToolResult>([
        [
          'image',
          {
            kind: 'tool-result',
            toolUseId: 'image',
            summary: '',
            isError: false,
            content: [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }],
          },
        ],
      ]),
      cwd: '',
      active: false,
    }),
  )
  expect(html).toContain('aria-expanded="false"')
  expect(html).not.toContain('tool-images')
})

it('labels a viewed image with its filename and view icon while leaving its preview closed', () => {
  const image = {
    ...tool,
    name: 'view_image',
    input: '{"path":"/tmp/screenshots/my-image.png"}',
    title: 'Read image output',
  }
  const html = renderToStaticMarkup(
    createElement(ToolGroup, { tools: [image], results: new Map(), cwd: '', active: false }),
  )
  expect(html).toContain('my-image.png')
  expect(html).toContain('lucide-eye')
  expect(html).not.toContain('Read image output')
  expect(html).not.toContain('tool-images')
})
