import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'

vi.mock('../src/ipc', () => ({ invokerFor: () => () => {}, ramu: {} }))
vi.mock('../src/i18n', () => ({ t: (text: string) => text }))
vi.mock('../src/workspace/computers', () => ({
  useComputers: () => ({
    current: 'local',
    computers: [
      { id: 'local', name: 'This host', local: true, status: 'offline' },
      { id: 'mini', name: 'Ahmads-mini-m4', status: 'connected' },
    ],
  }),
}))
const { HostProvider, useHostConnection } = await import('../src/workspace/HostProvider')

function Probe() {
  const { offline, name } = useHostConnection()
  return createElement('span', {}, `${name}:${offline ? 'offline' : 'online'}`)
}

it('reports the connection of the host a thread belongs to, not the host the window has selected', () => {
  const thread = (hostId: string) =>
    renderToStaticMarkup(createElement(HostProvider, { hostId, children: createElement(Probe) }))
  expect(thread('mini')).toBe('<span>Ahmads-mini-m4:online</span>')
  expect(thread('local')).toBe('<span>This host:offline</span>')
})
