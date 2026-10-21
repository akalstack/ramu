import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
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
