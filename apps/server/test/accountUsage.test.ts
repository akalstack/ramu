import { expect, it, vi } from 'vitest'
import type { UsageReading } from '@ramu/shared/types'
import { AccountUsage } from '../src/accountUsage'

const reading = (usedPercent: number): UsageReading => ({ provider: 'codex', window: 'five_hour', usedPercent, status: 'ok', updatedAt: 1 })
const config = { codex: { binary: '', rotateAccounts: true, accounts: [{ id: 'work', name: 'Work' }] }, cursor: { binary: '', accounts: [{ id: 'x', name: 'X' }] } }

it('reads each login once per interval, tags non-default logins, and skips providers without rotation', async () => {
  const update = vi.fn(), read = vi.fn(async () => [reading(40)]), other = vi.fn(async () => [reading(1)])
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
  const read = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([reading(10)])
  const usage = new AccountUsage(vi.fn(), () => ({ codex: { binary: '', rotateAccounts: true } }), { codex: read })
  await usage.refresh(undefined, 1_000_000)
  await usage.refresh(undefined, 1_000_001)
  expect(read).toHaveBeenCalledTimes(2)
})
