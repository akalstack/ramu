import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ProviderWaitState } from '@ramu/shared/chat/providerWait'
import { limitTrayView } from '@ramu/shared/chat/providerWait'
import { GOAL_LABELS } from '../src/chat/goalLabels'

const state = vi.hoisted(() => ({ menus: [] as { label: string; items: any[]; disabled?: boolean }[] }))
vi.mock('../src/i18n', () => ({
  useLanguage: () => {},
  formatLocale: () => 'en-US',
  t: (text: string, values: Record<string, unknown> = {}) =>
    text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`)),
}))
vi.mock('../src/Menu', () => ({
  Menu: (props: { label: string; items: any[] }) => {
    state.menus.push(props)
    return createElement('span', { 'data-menu': props.label })
  },
}))
vi.mock('@/components/desktop-button', () => ({
  Button: ({ variant, size: _size, ...props }: ComponentProps<'button'> & { variant?: string; size?: string }) =>
    createElement('button', { 'data-variant': variant, ...props }),
}))

const { LimitTrayRow, ProviderWaitIcon } = await import('../src/models/ProviderWait')
const { limitPlaceholder, limitResume, limitTrayCopy, resumeTime } = await import('../src/models/limitCopy')
const { autoResumeControl, autoResumeEntries, autoResumeSection } = await import('../src/models/autoResumeMenu')

const NOW = new Date('2026-10-18T12:00:00').getTime()
const AT = new Date('2026-10-18T17:00:00').getTime()
const known: ProviderWaitState = { retryAt: AT, guessed: false, resetNotified: false }
const guessed: ProviderWaitState = { retryAt: AT, guessed: true, resetNotified: false }
const passed: ProviderWaitState = { retryAt: NOW - 1000, guessed: false, resetNotified: true }

const row = (wait: ProviderWaitState, fallback: { autoResume?: boolean }, settings: { autoResume?: boolean } = {}) =>
  renderToStaticMarkup(
    createElement(LimitTrayRow, {
      wait,
      now: NOW,
      autoResume: autoResumeControl(settings, fallback, () => {}),
      onTry: () => {},
    }),
  )
beforeEach(() => {
  state.menus = []
})

it('words every tray row from the plan table', () => {
  const at = resumeTime(AT)
  const copy = (wait: ProviderWaitState, on: boolean, source: 'thread' | 'default' = 'default') =>
    limitTrayCopy(limitTrayView(wait, on, NOW), source, false)
  expect(copy(known, true)).toEqual({ title: 'Limit reached', detail: `resumes automatically around ${at}` })
  expect(copy(guessed, true)).toEqual({
    title: 'Limit reached',
    detail: 'resuming automatically, checking every few minutes',
  })
  expect(copy(known, false, 'thread').detail).toBe(`resets around ${at} · auto-resume is off for this thread`)
  expect(copy(known, false, 'default').detail).toBe(`resets around ${at} · auto-resume is off in Settings`)
  expect(copy(guessed, false, 'thread').detail).toBe('reset time unknown · auto-resume is off for this thread')
  expect(copy(guessed, false, 'default').detail).toBe('reset time unknown · auto-resume is off in Settings')
  expect(copy(passed, false)).toEqual({ title: 'Limit has reset', detail: 'nothing ran on its own' })
})

it('reads "Still limited" with the new reset after a failed try, but not once the limit has reset', () => {
  const view = limitTrayView(known, true, NOW)
  expect(limitTrayCopy(view, 'default', true)).toEqual({
    title: 'Still limited',
    detail: `resets around ${resumeTime(AT)}`,
  })
  expect(limitTrayCopy(limitTrayView(passed, false, NOW), 'default', true).title).toBe('Limit has reset')
})

it('shows a quiet Try anyway for a known reset and a primary Try again or Resume otherwise', () => {
  const quiet = row(known, {})
  expect(quiet).toContain('Try anyway')
  expect(quiet).toContain('data-variant="ghost"')
  const again = row(guessed, {})
  expect(again).toContain('Try again')
  expect(again).toContain('data-variant="default"')
  const resume = row(passed, { autoResume: false })
  expect(resume).toContain('>Resume<')
  expect(resume).toContain('data-variant="default"')
  expect(resume).toContain('Limit has reset')
})

it('labels the Auto-resume control with the effective state and its source', () => {
  expect(row(known, {})).toContain('Auto-resume: On (default)')
  expect(row(known, { autoResume: false })).toContain('Auto-resume: Off (default)')
  expect(row(known, { autoResume: false }, { autoResume: true })).toContain('Auto-resume: On')
  expect(row(known, { autoResume: true }, { autoResume: false })).toContain('Auto-resume: Off')
  expect(row(known, { autoResume: true }, { autoResume: false })).not.toContain('(default)')
})

it('puts Use default, On and Off in the control, with the current one selected and the default named', () => {
  const entries = (settings: { autoResume?: boolean }, global: boolean) =>
    autoResumeEntries(autoResumeControl(settings, { autoResume: global }, () => {})).map((entry: any) => [
      entry.label,
      entry.selected,
    ])
  expect(entries({}, true)).toEqual([
    ['Use default (on)', true],
    ['On', false],
    ['Off', false],
  ])
  expect(entries({}, false)).toEqual([
    ['Use default (off)', true],
    ['On', false],
    ['Off', false],
  ])
  expect(entries({ autoResume: false }, true)).toEqual([
    ['Use default (on)', false],
    ['On', false],
    ['Off', true],
  ])
  expect(autoResumeSection(autoResumeControl({}, undefined, () => {}))[0]).toMatchObject({
    heading: 'Auto-resume at a usage limit',
  })
})

it('sets or clears the thread override from the menu items', () => {
  const set = vi.fn()
  const entries = autoResumeEntries(autoResumeControl({ autoResume: false }, { autoResume: true }, set)) as any[]
  for (const entry of entries) entry.onSelect()
  expect(set.mock.calls.map(([choice]) => choice)).toEqual(['default', 'on', 'off'])
})

it('follows the global value live for a thread with no override', () => {
  const settings = {}
  expect(autoResumeControl(settings, { autoResume: true }, () => {}).effective).toEqual({
    value: true,
    source: 'default',
  })
  expect(autoResumeControl(settings, { autoResume: false }, () => {}).effective).toEqual({
    value: false,
    source: 'default',
  })
  expect(autoResumeControl(settings, undefined, () => {}).effective.value).toBe(true)
})

it('changes the composer placeholder with auto-resume and the reset time', () => {
  const view = (wait: ProviderWaitState, on: boolean) => limitTrayView(wait, on, NOW)
  expect(limitPlaceholder(view(known, true), true)).toBe(
    `Message · sends when the limit resets (around ${resumeTime(AT)})`,
  )
  expect(limitPlaceholder(view(guessed, true), true)).toBe('Message · sends when the limit clears')
  expect(limitPlaceholder(view(known, false), false)).toBe('Message · queued until you resume')
  expect(limitPlaceholder(view(guessed, false), false)).toBe('Message · queued until you resume')
})

it('turns the empty-box play button into Try again only when the tray makes it primary', () => {
  expect(limitResume(null)).toEqual({ active: false })
  expect(limitResume(limitTrayView(known, true, NOW))).toEqual({ active: false })
  expect(limitResume(limitTrayView(guessed, true, NOW))).toMatchObject({ active: true, label: 'Try again' })
  expect(limitResume(limitTrayView(passed, false, NOW))).toMatchObject({ active: true, label: 'Resume' })
})

it('labels the sidebar icon "Limit reached" with the reset', () => {
  const html = renderToStaticMarkup(createElement(ProviderWaitIcon, { retryAt: AT }))
  expect(html).toContain(`Limit reached · resumes around ${resumeTime(AT)}`)
  expect(html).not.toContain('Waiting')
})

it('keeps "Limit reached" and "Goal paused" as separate labels', () => {
  expect(GOAL_LABELS.limit).toBe('Limit reached')
  expect(GOAL_LABELS.paused).toBe('Goal paused')
  expect(GOAL_LABELS.limit).not.toBe(GOAL_LABELS.paused)
  expect(Object.values(GOAL_LABELS)).not.toContain('Waiting for provider')
})

it('keeps limit information visible but disables retry and auto-resume changes for viewers', () => {
  const html = renderToStaticMarkup(
    createElement(LimitTrayRow, {
      wait: known,
      now: NOW,
      autoResume: autoResumeControl({}, undefined, vi.fn()),
      onTry: vi.fn(),
      readOnly: true,
    }),
  )
  expect(html).toContain('Limit reached')
  expect(html).toMatch(/<button[^>]*disabled=""/)
  expect(state.menus[0]?.disabled).toBe(true)
})
