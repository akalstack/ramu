import { expect, it, vi } from 'vitest'
import type { UsageReading } from '@ramu/shared/types'
import { AccountUsage } from '../src/providers/accountUsage'

const reading = (usedPercent: number): UsageReading => ({
  provider: 'codex',
  window: 'five_hour',
  usedPercent,
  status: 'ok',
  updatedAt: 1,
})
const config = {
  codex: { binary: '', accounts: [{ id: 'work', name: 'Work' }] },
  cursor: { binary: '' },
}

it('reads each login once per interval, tags non-default logins, and skips providers with a single account', async () => {
  const update = vi.fn(),
    read = vi.fn(async () => [reading(40)]),
    other = vi.fn(async () => [reading(1)])
  const usage = new AccountUsage(update, () => config, { codex: read, cursor: other })
  await usage.refresh(undefined, 1_000_000)
  expect(read).toHaveBeenCalledTimes(2)
  expect(other).not.toHaveBeenCalled()
  expect(update).toHaveBeenCalledWith([expect.not.objectContaining({ accountId: expect.anything() })])
  expect(update).toHaveBeenCalledWith([expect.objectContaining({ accountId: 'work', usedPercent: 40 })])
  await usage.refresh('codex', 1_000_000 + 60_000)
  expect(read).toHaveBeenCalledTimes(2)
  await usage.refresh('codex', 1_000_000 + 6 * 60_000)
  expect(read).toHaveBeenCalledTimes(4)
})

it('retries a failed read on the next refresh', async () => {
  const read = vi
    .fn()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue([reading(10)])
  const usage = new AccountUsage(vi.fn(), () => ({ codex: { binary: '', accounts: [{ id: 'work', name: 'Work' }] } }), {
    codex: read,
  })
  await usage.refresh(undefined, 1_000_000)
  await usage.refresh(undefined, 1_000_001)
  // The default login failed and is retried; the working login is still inside its interval.
  expect(read).toHaveBeenCalledTimes(3)
})

it('reads a single login for standalone providers, whose own reading only arrives while they run', async () => {
  const update = vi.fn(),
    read = vi.fn(async () => [reading(30)]),
    other = vi.fn(async () => [reading(1)])
  const usage = new AccountUsage(
    update,
    () => ({ codex: { binary: '' }, cursor: { binary: '' } }),
    { codex: read, cursor: other },
    ['codex'],
  )
  await usage.refresh(undefined, 1_000_000)
  expect(read).toHaveBeenCalledTimes(1)
  expect(other).not.toHaveBeenCalled()
  expect(update).toHaveBeenCalledWith([expect.not.objectContaining({ accountId: expect.anything() })])
})

it('reads and tags the only enabled Antigravity account without reading the default login', async () => {
  const update = vi.fn()
  const read = vi.fn(async () => [{ ...reading(40), provider: 'antigravity' as const }])
  const usage = new AccountUsage(
    update,
    () => ({
      antigravity: {
        binary: '',
        accountId: 'work',
        defaultAccountEnabled: false,
        accounts: [{ id: 'work', name: 'Work' }],
      },
    }),
    { antigravity: read },
    ['antigravity'],
  )
  await usage.refresh(undefined, 1_000_000)
  expect(read).toHaveBeenCalledExactlyOnceWith('work')
  expect(update).toHaveBeenCalledWith([expect.objectContaining({ provider: 'antigravity', accountId: 'work' })])
  await usage.refresh(undefined, 1_000_001)
  expect(read).toHaveBeenCalledTimes(1)
})

it('reads every login again at once after the logins, keys or enabled providers change', async () => {
  const read = vi.fn(async () => [reading(20)])
  const usage = new AccountUsage(vi.fn(), () => config, { codex: read }, ['codex'])
  await usage.refresh(undefined, 1_000_000)
  expect(read).toHaveBeenCalledTimes(2)
  usage.forgetAll()
  await usage.refresh(undefined, 1_000_001)
  expect(read).toHaveBeenCalledTimes(4)
})
