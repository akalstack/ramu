import { expect, it } from 'vitest'
import {
  autoResumeChoiceOf,
  autoResumeItems,
  autoResumeOverride,
  autoResumeStateLabel,
  limitChoiceOf,
  limitChoiceOptions,
  limitChoicePatch,
  limitChoiceSwitches,
} from '../src/chat/limitPolicy'
import { limitTrayView } from '../src/chat/providerWait'

const prefs = (defaultAutoFallback: boolean, autoResume?: boolean) => ({
  defaultAutoFallback,
  fallback: autoResume === undefined ? {} : { autoResume },
})

it('maps the stored pair to the three options and the hidden fourth', () => {
  expect(limitChoiceOf(prefs(true, true))).toBe('switch')
  expect(limitChoiceOf(prefs(false, true))).toBe('wait')
  expect(limitChoiceOf(prefs(false, false))).toBe('stop')
  expect(limitChoiceOf(prefs(true, false))).toBe('switch-then-stop')
})

it('counts a missing auto-resume as on, so saved preferences need no migration', () => {
  expect(limitChoiceOf(prefs(true))).toBe('switch')
  expect(limitChoiceOf(prefs(false))).toBe('wait')
  expect(limitChoiceOf({ defaultAutoFallback: true })).toBe('switch')
})

it('writes both stored values and round-trips every option', () => {
  expect(limitChoicePatch('switch')).toEqual({ defaultAutoFallback: true, autoResume: true })
  expect(limitChoicePatch('wait')).toEqual({ defaultAutoFallback: false, autoResume: true })
  expect(limitChoicePatch('stop')).toEqual({ defaultAutoFallback: false, autoResume: false })
  for (const choice of ['switch', 'wait', 'stop', 'switch-then-stop'] as const) {
    const patch = limitChoicePatch(choice)
    expect(
      limitChoiceOf({ defaultAutoFallback: patch.defaultAutoFallback, fallback: { autoResume: patch.autoResume } }),
    ).toBe(choice)
  }
})

it('offers the fourth option only while it is the stored value, and only Switch enables the dependants', () => {
  expect(limitChoiceOptions('switch').map((option) => option.value)).toEqual(['switch', 'wait', 'stop'])
  expect(limitChoiceOptions('stop')).toHaveLength(3)
  expect(limitChoiceOptions('switch-then-stop').map((option) => option.value)).toEqual([
    'switch',
    'wait',
    'stop',
    'switch-then-stop',
  ])
  expect(['switch', 'switch-then-stop', 'wait', 'stop'].map((choice) => limitChoiceSwitches(choice as never))).toEqual([
    true,
    true,
    false,
    false,
  ])
})

it('lists the per-thread items with the default named, and the current one selected', () => {
  expect(autoResumeItems(true, 'default')).toEqual([
    { choice: 'default', label: 'Use default (on)', selected: true },
    { choice: 'on', label: 'On', selected: false },
    { choice: 'off', label: 'Off', selected: false },
  ])
  expect(autoResumeItems(false, 'off').map((item) => [item.label, item.selected])).toEqual([
    ['Use default (off)', false],
    ['On', false],
    ['Off', true],
  ])
})

it('reads and writes the thread override: unset follows the default, Use default clears it', () => {
  expect(autoResumeChoiceOf({})).toBe('default')
  expect(autoResumeChoiceOf({ autoResume: true })).toBe('on')
  expect(autoResumeChoiceOf({ autoResume: false })).toBe('off')
  expect(autoResumeOverride('default')).toBeNull()
  expect(autoResumeOverride('on')).toBe(true)
  expect(autoResumeOverride('off')).toBe(false)
})

it('labels the effective state with where it comes from', () => {
  expect(autoResumeStateLabel({ value: true, source: 'default' })).toBe('On (default)')
  expect(autoResumeStateLabel({ value: false, source: 'default' })).toBe('Off (default)')
  expect(autoResumeStateLabel({ value: true, source: 'thread' })).toBe('On')
  expect(autoResumeStateLabel({ value: false, source: 'thread' })).toBe('Off')
})

it('chooses the tray button: quiet Try anyway for a known reset, primary Try again or Resume otherwise', () => {
  const now = 1_000
  const future = { retryAt: 9_000, guessed: false }
  const guess = { retryAt: 9_000, guessed: true }
  const past = { retryAt: 500, guessed: false }
  expect(limitTrayView(future, true, now)).toEqual({
    case: 'auto-known',
    primary: false,
    action: 'try-anyway',
    resetAt: 9_000,
  })
  expect(limitTrayView(guess, true, now)).toEqual({ case: 'auto-unknown', primary: true, action: 'try-again' })
  expect(limitTrayView(future, false, now)).toEqual({
    case: 'off-known',
    primary: false,
    action: 'try-anyway',
    resetAt: 9_000,
  })
  expect(limitTrayView(guess, false, now)).toEqual({ case: 'off-unknown', primary: true, action: 'try-again' })
  expect(limitTrayView(past, false, now)).toEqual({ case: 'reset-off', primary: true, action: 'resume' })
  expect(limitTrayView(past, true, now).case).toBe('auto-unknown')
})
