import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import type { ChatGoal } from '@ramu/shared/types'
import {
  GOAL_LABELS,
  goalLabel,
  GOAL_NOTE_LABELS,
  VERIFY_LIMIT,
  checkOutcomeCopy,
  verifyDraft,
} from '../src/chat/goalLabels'
import { goalChanges } from '@ramu/shared/chat/goalHistory'

vi.mock('../src/i18n', () => ({
  useLanguage: () => {},
  formatLocale: () => 'en-US',
  t: (text: string, values: Record<string, unknown> = {}) =>
    text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`)),
}))
vi.mock('../src/settings/AppSettings', () => ({ useAppSettings: () => ({ preferences: { goals: { maxTurns: 10 } } }) }))
vi.mock('@/components/desktop-button', () => ({
  Button: ({ variant, size: _size, ...props }: ComponentProps<'button'> & { variant?: string; size?: string }) =>
    createElement('button', { 'data-variant': variant, ...props }),
}))

const { GoalFacts, GoalVerifyEditor } = await import('../src/chat/GoalBar')

const goal = (patch: Partial<ChatGoal> = {}): ChatGoal => ({
  id: 'g1',
  objective: 'Login works',
  status: 'active',
  turns: 1,
  reason: '',
  updatedAt: 1,
  ...patch,
})
const failed = {
  command: 'pnpm test',
  ok: false,
  code: 1,
  at: 5,
  output: 'Command exited with code 1.\nFAIL login.test.ts\nexpected 200, got 500',
}

it('shows a failed verification with its command, exit and the end of its output', () => {
  const html = renderToStaticMarkup(createElement(GoalFacts, { goal: goal({ verify: 'pnpm test', check: failed }) }))
  expect(html).toContain('Verification failed')
  expect(html).toContain('Exit code 1')
  expect(html).toContain('pnpm test')
  expect(html).toContain('expected 200, got 500')
  expect(html).not.toContain('Command exited with code')
})

it('shows completion evidence, and nothing for a goal that has none', () => {
  const html = renderToStaticMarkup(
    createElement(GoalFacts, {
      goal: goal({
        status: 'completed',
        check: { ...failed, ok: true, code: 0, output: '' },
        evidence: {
          checks: [
            { name: 'pnpm test', passed: true },
            { name: 'lint', passed: false },
          ],
          changedFiles: Array.from({ length: 10 }, (_, i) => `src/f${i}.ts`),
        },
      }),
    }),
  )
  expect(html).toContain('Verified')
  expect(html).toContain('✓ pnpm test')
  expect(html).toContain('✗ lint')
  expect(html).toContain('src/f7.ts')
  expect(html).not.toContain('src/f8.ts')
  expect(html).toContain('+2 more')
  expect(renderToStaticMarkup(createElement(GoalFacts, { goal: goal() }))).toBe('')
})

it('labels the new turning points apart from a usage limit and a pause', () => {
  expect(GOAL_NOTE_LABELS.stalled).toBe('No progress')
  expect(GOAL_NOTE_LABELS['verify-failed']).toBe('Verification failed')
  expect(GOAL_NOTE_LABELS.paused).toBe('Goal paused')
  expect(GOAL_LABELS.limit).toBe('Limit reached')
  expect(GOAL_LABELS.paused).toBe('Goal paused')
  const types = goalChanges([
    { kind: 'goal', goal: goal() },
    { kind: 'goal', goal: goal({ status: 'waiting-provider' }) },
  ])
  expect([...types.values()].map((change) => change.type)).toEqual(['set'])
  // The merged status: a limit hold and a user pause share `paused`, and still read differently (old hosts say waiting-provider).
  expect(goalLabel(goal({ status: 'paused', pausedBy: 'provider-limit' }))).toBe('Limit reached')
  expect(goalLabel(goal({ status: 'waiting-provider' }))).toBe('Limit reached')
  expect(goalLabel(goal({ status: 'paused', pausedBy: 'user' }))).toBe('Goal paused')
  expect(goalLabel(goal({ status: 'paused' }))).toBe('Goal paused')
  const merged = goalChanges([
    { kind: 'goal', goal: goal() },
    { kind: 'goal', goal: goal({ status: 'paused', pausedBy: 'provider-limit' }) },
    { kind: 'goal', goal: goal({ status: 'paused', pausedBy: 'user' }) },
  ])
  expect([...merged.values()].map((change) => change.type)).toEqual(['set', 'paused'])
  expect(checkOutcomeCopy({ kind: 'exit', code: 2 })).toEqual(['Exit code {0}', { '0': 2 }])
  expect(checkOutcomeCopy({ kind: 'timed-out' })).toEqual(['Timed out'])
})

it('reads the verification field: blank and off remove, an unchanged value saves nothing', () => {
  expect(verifyDraft(' pnpm test ', undefined)).toEqual({ command: 'pnpm test', changed: true, tooLong: false })
  expect(verifyDraft('pnpm test', 'pnpm test').changed).toBe(false)
  expect(verifyDraft('', 'pnpm test')).toEqual({ command: null, changed: true, tooLong: false })
  expect(verifyDraft('OFF', 'pnpm test').command).toBeNull()
  expect(verifyDraft('', undefined).changed).toBe(false)
  expect(verifyDraft('x'.repeat(VERIFY_LIMIT + 1), undefined).tooLong).toBe(true)
})

it('offers Save for a command, Remove for a blank field over a command, and no save while unchanged', () => {
  const html = (current?: string) =>
    renderToStaticMarkup(createElement(GoalVerifyEditor, { current, onSave: () => {}, onClose: () => {} }))
  expect(html()).toContain('Save')
  expect(html()).toContain('disabled')
  expect(html('pnpm test')).toContain('value="pnpm test"')
  expect(html()).toContain('Only you can set it')
})
