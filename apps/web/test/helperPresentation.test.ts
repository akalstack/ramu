import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { AgentTaskCard } from '../src/views/agent/components/AgentTaskCard'
const connection = vi.hoisted(() => ({ offline: false }))
vi.mock('../src/i18n', () => ({
  useLanguage() {},
  t: (value: string, args?: Record<string, string>) => value.replace('{0}', args?.['0'] ?? ''),
}))
vi.mock('../src/workspace/HostProvider', () => ({ useHostConnection: () => connection }))
vi.mock('../src/views/agent/hooks/useElapsed', () => ({ useElapsed: () => null }))
vi.mock('../src/models/ModelSets', () => ({ modelDisplayName: (name: string) => name }))
vi.mock('../src/chat/AgentControls', () => ({ providerName: (name: string) => name }))
it('offers a capable independently running helper Stop when its parent is idle', () => {
  connection.offline = false
  const html = renderToStaticMarkup(
    createElement(AgentTaskCard, {
      task: { agentId: 'a', name: 'A', status: 'running', background: true, canStop: true },
      live: false,
      onOpen() {},
      onStop() {},
    }),
  )
  expect(html).toContain('Working')
  expect(html).toContain('Stop agent A')
  expect(html).not.toContain('Stopped')
})
it('marks disconnected helper state last-known and removes actions', () => {
  connection.offline = true
  const html = renderToStaticMarkup(
    createElement(AgentTaskCard, {
      task: { agentId: 'a', name: 'A', status: 'running', canStop: true },
      live: true,
      onOpen() {},
      onStop() {},
    }),
  )
  expect(html).toContain('Last known')
  expect(html).not.toContain('Stop agent A')
})

it('keeps helper details available without offering Stop to a viewer', () => {
  connection.offline = false
  const html = renderToStaticMarkup(
    createElement(AgentTaskCard, {
      task: { agentId: 'a', name: 'A', status: 'running', canStop: true },
      live: true,
      readOnly: true,
      onOpen() {},
      onStop() {},
    }),
  )
  expect(html).toContain('Open agent A')
  expect(html).not.toContain('Stop agent A')
})
