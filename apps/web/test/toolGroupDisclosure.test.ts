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

it('headlines the latest live step and keeps a failure marker visible while details are collapsed', () => {
  const failed = { ...tool, toolUseId: 'failed', title: 'Check configuration' }
  const first = { ...tool, toolUseId: 'first', title: 'Read earlier file' }
  const latest = { ...tool, toolUseId: 'latest', title: 'Run focused checks' }
  const html = renderToStaticMarkup(
    createElement(ToolGroup, {
      tools: [failed, first, latest],
      cwd: '',
      active: true,
      results: new Map<string, ToolResult>([
        ['failed', { kind: 'tool-result', toolUseId: 'failed', summary: 'failed', isError: true }],
      ]),
    }),
  )
  expect(html).toContain('Run focused checks')
  expect(html).toContain('Failed')
  expect(html).not.toContain('Read earlier file')
  expect(html).toContain('aria-expanded="false"')
})

it('headlines a live group with its newest thought when the agent is thinking after a call', () => {
  const html = renderToStaticMarkup(
    createElement(ToolGroup, {
      tools: [tool],
      entries: [tool, { kind: 'thinking', text: 'First idea\n\nCheck the config next' }],
      results: new Map<string, ToolResult>([
        ['read', { kind: 'tool-result', toolUseId: 'read', summary: 'ok', isError: false }],
      ]),
      cwd: '',
      active: true,
      live: true,
    }),
  )
  expect(html).toContain('Check the config next')
  expect(html).not.toContain('Thinking')
  expect(html).toContain('lucide-brain')
})

it('keeps the live group thought in view after its call finishes, until the group settles', () => {
  const props = {
    tools: [tool],
    entries: [{ kind: 'thinking' as const, text: 'Read the config before editing' }, tool],
    results: new Map<string, ToolResult>([
      ['read', { kind: 'tool-result', toolUseId: 'read', summary: 'ok', isError: false }],
    ]),
    cwd: '',
    active: true,
  }
  // Between calls the group is still live, so the thought stays under the headline.
  expect(renderToStaticMarkup(createElement(ToolGroup, { ...props, live: true }))).toContain(
    'Read the config before editing',
  )
  // Settled, the group folds to its summary and the thought waits inside it.
  expect(renderToStaticMarkup(createElement(ToolGroup, { ...props, live: false }))).not.toContain(
    'Read the config before editing',
  )
})
