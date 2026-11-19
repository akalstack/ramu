import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import type { AgentProvider, Task } from '@ramu/shared/types'
import { AgentStack } from '../src/sidebar/projects/AgentStack'

vi.mock('../src/models/ProviderIcon', () => ({
  ProviderIcon: ({ provider }: { provider: string }) => createElement('i', { 'data-provider': provider }),
}))

const render = (providers: AgentProvider[]) =>
  renderToStaticMarkup(createElement(AgentStack, { task: { providers } as Task }))
const shown = (html: string) => [...html.matchAll(/data-provider="([^"]+)"/g)].map((match) => match[1])

it('stacks earlier agents behind the leading one, which comes last so it paints on top uncovered', () => {
  const html = render(['claude-code', 'codex'])
  expect(shown(html)).toEqual(['claude-code', 'codex'])
  const [covered, leader] = html.split('<i ')
  expect(covered).toContain('mask-image')
  expect(leader).not.toContain('mask-image')
  expect(html).toContain('aria-label="Claude, Codex"')
  expect(html).not.toContain('+')
})

it('shows the latest three agents and counts the rest, while the label and tooltip name every agent', () => {
  const html = render(['opencode', 'cursor', 'claude-code', 'antigravity', 'codex'])
  expect(shown(html)).toEqual(['claude-code', 'antigravity', 'codex'])
  expect(html).toContain('>+2<')
  const label = html.match(/aria-label="([^"]*)"/)![1]!
  expect(label.split(', ')).toHaveLength(5)
  expect(html).toContain(`title="${label}"`)
})

it('shows nothing for a host that does not report agents', () => {
  expect(render([])).toBe('')
})
