import { QueryClient } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import type { ProviderStatus } from '@ramu/shared/providers/providers'
import { NO_STATUSES, applyStatuses, changedProviders, providerStatusQuery } from '../src/settings/providerStatusQuery'

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

const status = (provider: ProviderStatus['provider'], version: string) => ({ provider, version }) as ProviderStatus

it('keeps every provider it did not ask about while one is checked again', () => {
  const first = applyStatuses(NO_STATUSES, [status('codex', '1'), status('claude-code', '1')], 1)
  const next = applyStatuses(first, [status('codex', '2')], 2)
  expect(next.statuses).toEqual([status('codex', '2'), status('claude-code', '1')])
})

it('never lets an older answer overwrite a newer one, per provider', () => {
  const fresh = applyStatuses(NO_STATUSES, [status('codex', 'new')], 3)
  // A full check started earlier (stamp 2) lands later: it fills in Claude but leaves the newer Codex result.
  const late = applyStatuses(fresh, [status('codex', 'old'), status('claude-code', '1')], 2)
  expect(late.statuses).toEqual([status('codex', 'new'), status('claude-code', '1')])
  expect(applyStatuses(late, [status('codex', 'older')], 1)).toBe(late)
})

it('names only the providers an edit changed', () => {
  const before = { codex: { binary: '', accounts: [{ id: 'a' }] }, 'claude-code': { binary: '' } }
  expect(changedProviders(before, { ...before })).toEqual([])
  expect(changedProviders(before, { ...before, codex: { binary: '', accounts: [{ id: 'a' }, { id: 'b' }] } })).toEqual([
    'codex',
  ])
})
