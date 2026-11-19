import { expect, it, vi } from 'vitest'
vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '8.8.8.8', family: 4 }] }))
import { registerBrowserActivityHandlers } from '../src/ipc/handlers/browserActivity'
import type { HandlerContext } from '../src/ipc/types'
import { deviceMayInvoke } from '../src/remote/access'

const tab = {
  id: '11111111-1111-4111-8111-111111111111',
  hostId: 'desktop',
  threadId: 'thread',
  runId: 'run',
  profileId: 'default',
  url: 'https://example.com',
  title: 'Example',
  controller: 'agent',
  generation: 1,
  inputReady: false,
  paused: false,
  crashed: false,
}
it('returns bounded metadata only for the requested existing task through the owning broker', async () => {
  const calls: unknown[] = []
  const handlers = registerBrowserActivityHandlers({
    workspace: {
      getTask: (id: string) => {
        if (id !== 'thread') throw Error('Unknown thread')
        return { id }
      },
    },
    agents: { list: () => [{ id: 'run' }] },
    browser: {
      status: () => ({ available: true }),
      request: async (...args: unknown[]) => {
        calls.push(args)
        return [tab, { ...tab, threadId: 'another' }]
      },
    },
  } as unknown as HandlerContext)
  expect(await handlers['browser.activity']!.run('thread')).toEqual({
    available: true,
    tabs: [tab],
    externalURLs: ['https://example.com'],
  })
  expect(calls).toEqual([['thread', 'run', { kind: 'list' }]])
  await expect(handlers['browser.activity']!.run('missing')).rejects.toThrow('Unknown thread')
})
it('reports unavailable without opening a runtime and gives paired viewers no implicit browser access', async () => {
  const handlers = registerBrowserActivityHandlers({
    workspace: { getTask() {} },
    agents: { list: () => [] },
  } as unknown as HandlerContext)
  expect(await handlers['browser.activity']!.run('thread')).toEqual({ available: false, tabs: [] })
  expect(deviceMayInvoke({ role: 'viewer' } as never, 'browser.activity')).toBe(false)
})
