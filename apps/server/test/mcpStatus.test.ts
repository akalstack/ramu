import { expect, it, vi } from 'vitest'
import { mcpRequest, mcpServerDetails } from '../src/agent/mcpStatus'

it('exposes live state and tool counts without exposing configuration or tool data', () => {
  const wire = {
    name: 'pentools-atlassian',
    status: 'connected',
    tools: [{ name: 'secret-tool' }],
    config: { headers: { Authorization: 'Bearer secret' } },
  }
  expect(mcpServerDetails([wire])).toEqual([{ name: 'pentools-atlassian', status: 'connected', toolCount: 1 }])
})

it('keeps authentication and pending states distinct and removes URLs from connection errors', () => {
  expect(
    mcpServerDetails([
      { name: 'slow', status: 'pending' },
      { name: 'auth', status: 'needs-auth' },
      { name: 'failed', status: 'failed', error: 'Failed at https://user:password@example.com?token=secret' },
    ]),
  ).toEqual([
    { name: 'slow', status: 'pending' },
    { name: 'auth', status: 'needs-auth' },
    { name: 'failed', status: 'failed', error: 'Failed at [server URL]' },
  ])
})

it('bounds status requests without reporting a connecting server as failed', async () => {
  vi.useFakeTimers()
  try {
    const promise = mcpRequest(new Promise(() => {}))
    const check = expect(promise).rejects.toThrow('servers may still be connecting')
    await vi.advanceTimersByTimeAsync(15_000)
    await check
  } finally {
    vi.useRealTimers()
  }
})
