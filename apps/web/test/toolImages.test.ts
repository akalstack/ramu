import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import type { ToolResult } from '../src/views/agent/types'
import type { AgentContent } from '@ramu/shared/types'
import { splitToolContent } from '../src/views/agent/lib/toolContent'

vi.mock('../src/i18n', () => ({ useLanguage() {}, t: (text: string) => text }))
vi.mock('../src/chat/AgentContentView', () => ({
  AgentContentView: ({ content }: { content: AgentContent[] }) =>
    createElement(
      'div',
      null,
      content.map((item, index) =>
        item.type === 'image' ? createElement('img', { key: index, alt: item.alt ?? item.uri }) : null,
      ),
    ),
}))
vi.mock('../src/components/ui/collapsible', () => ({
  Collapsible: ({ children }: { children: ReactNode }) => createElement('section', null, children),
  CollapsibleTrigger: () => null,
  CollapsibleContent: () => null,
}))
vi.mock('../src/views/agent/hooks/useScrollFade', () => ({ useScrollFade: () => ({ current: null }) }))
vi.mock('../src/views/agent/components/ToolIcon', () => ({ ToolIcon: () => null }))
vi.mock('../src/views/agent/components/ThinkingRow', () => ({ ThinkingRow: () => null }))
vi.mock('../src/views/agent/components/RamuToolBody', () => ({ RamuToolBody: () => null }))
import { ToolGroup } from '../src/views/agent/components/ToolGroup'

it('shows images from multiple calls even with the group and all tool details closed', () => {
  const html = renderToStaticMarkup(
    createElement(ToolGroup, {
      tools: [
        {
          kind: 'tool-use',
          name: 'Read',
          toolUseId: 'one',
          summary: 'first.png',
          content: [{ type: 'image', mimeType: 'image/png', uri: '/first.png' }],
        },
        { kind: 'tool-use', name: 'Read', toolUseId: 'two', summary: 'second.png' },
      ],
      results: new Map<string, ToolResult>([
        [
          'two',
          {
            kind: 'tool-result',
            toolUseId: 'two',
            isError: false,
            summary: 'hidden text',
            content: [{ type: 'image', mimeType: 'image/png', uri: '/second.png' }],
          },
        ],
      ]),
      cwd: '/workspace',
      active: false,
      taskId: 'thread',
    }),
  )
  expect(html).toContain('alt="/first.png"')
  expect(html).toContain('alt="/second.png"')
  expect(html).not.toContain('hidden text')
  expect(html.match(/<img/g)).toHaveLength(2)
})
it('keeps ordinary output in details and includes embedded image resources in visible results', () => {
  const text: AgentContent = { type: 'text', text: 'diagnostics' }
  const resource: AgentContent = {
    type: 'resource',
    uri: 'image://one',
    name: 'Screenshot',
    mimeType: 'image/png',
    blob: 'AA==',
  }
  expect(splitToolContent([text, resource])).toEqual({ details: [text], images: [resource] })
  expect(splitToolContent()).toEqual({ details: [], images: [] })
})
