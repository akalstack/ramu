import { QueryClient } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { providerStatusQuery } from '../src/settings/providerStatusQuery'

it('reuses status on reopen, isolates hosts and configuration, and refreshes after expiration or explicit actions', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const status = vi.fn().mockResolvedValue([])
  const now = Date.now()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
  const config = { codex: { binary: '/bin/codex' } }
  const query = () => providerStatusQuery('local', config, status)
  try {
    await client.fetchQuery(query())
    await client.fetchQuery(query())
    expect(status).toHaveBeenCalledOnce()
    await client.fetchQuery(providerStatusQuery('remote', config, status))
    await client.fetchQuery(providerStatusQuery('local', { codex: { binary: '/custom/codex' } }, status))
    expect(status).toHaveBeenCalledTimes(3)
    clock.mockReturnValue(now + 60_001)
    await client.fetchQuery(query())
    expect(status).toHaveBeenCalledTimes(4)
    await client.fetchQuery(providerStatusQuery('local', config, status, false, true))
    expect(status).toHaveBeenLastCalledWith(config, false, true)
    await client.fetchQuery(providerStatusQuery('local', config, status, true))
    expect(status).toHaveBeenLastCalledWith(config, true, false)
    expect(status).toHaveBeenCalledTimes(6)
  } finally {
    clock.mockRestore()
    client.clear()
  }
})
