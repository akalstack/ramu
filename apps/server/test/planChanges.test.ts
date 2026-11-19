import type { UsageReading } from '@ramu/shared/types'
import { expect, it, vi } from 'vitest'
import { planName } from '@ramu/shared/providers/providers'
import { acpPlan, observeAcpPlan, onAcpPlanChange } from '../src/providers/acp'
import { UsageService } from '../src/providers/usage'

const reading = (window: UsageReading['window'], plan: string, scope?: string): UsageReading => ({
  provider: 'claude-code',
  window,
  ...(scope ? { scope } : {}),
  usedPercent: 10,
  status: 'ok',
  plan,
  updatedAt: Date.now(),
})

it('starts a login over when its plan changes, so windows only the old plan had stop showing', () => {
  const usage = new UsageService(
    () => [reading('five_hour', 'max'), reading('weekly', 'max'), reading('weekly', 'max', 'Opus')],
    () => {},
    () => {},
  )
  usage.update([reading('five_hour', 'pro'), reading('weekly', 'pro')])
  expect(usage.list().map((r) => [r.window, r.scope ?? '', r.plan])).toEqual([
    ['five_hour', '', 'pro'],
    ['weekly', '', 'pro'],
  ])
  // Same plan: readings merge as before.
  usage.update([reading('weekly', 'pro', 'Sonnet')])
  expect(usage.list()).toHaveLength(3)
})

it("notes Antigravity's tier from a session and tells listeners when it changes", () => {
  const changed = vi.fn()
  const off = onAcpPlanChange(changed)
  const session = (name: string) => ({
    _meta: { antigravity: { tier: { name, id: 'tier', upgradeUri: 'https://antigravity.google/g1-upgrade' } } },
  })
  observeAcpPlan('antigravity', 'plan-test', session('Antigravity Starter Quota'))
  expect(acpPlan('antigravity', 'plan-test')).toEqual({
    plan: 'Antigravity Starter Quota',
    upgradeUrl: 'https://antigravity.google/g1-upgrade',
  })
  expect(changed).not.toHaveBeenCalled()
  observeAcpPlan('antigravity', 'plan-test', session('Antigravity Pro'))
  expect(changed).toHaveBeenCalledWith('antigravity', 'plan-test')
  // A link that is not https is never offered.
  observeAcpPlan('antigravity', 'plan-test', {
    _meta: { antigravity: { tier: { name: 'Antigravity Pro', upgradeUri: 'javascript:alert(1)' } } },
  })
  expect(acpPlan('antigravity', 'plan-test')?.upgradeUrl).toBeUndefined()
  off()
})

it('reads plans as people say them', () => {
  expect(planName('pro')).toBe('Pro')
  expect(planName('max_20x')).toBe('Max 20x')
  expect(planName('Antigravity Starter Quota')).toBe('Antigravity Starter Quota')
})
