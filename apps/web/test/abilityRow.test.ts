import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AbilityCall } from '@ramu/shared/providers/abilities'
import { AbilityRow } from '../src/views/agent/components/AbilityRow'

const state = vi.hoisted(() => ({ buttons: [] as ComponentProps<'button'>[] }))
vi.mock('../src/i18n', () => ({ useLanguage: () => {}, t: (text: string) => text, formatLocale: () => 'en' }))
vi.mock('../src/workspace/HostProvider', () => ({ useHost: () => ({ invoke: vi.fn() }) }))
vi.mock('../src/chat/Notifications', () => ({ notifyError: vi.fn() }))
vi.mock('../src/composer/Attachments', () => ({ Attachments: () => null }))
vi.mock('@/components/desktop-button', () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ComponentProps<'button'> & { variant?: string; size?: string }) => {
    state.buttons.push(props)
    return createElement('button', props)
  },
}))

beforeEach(() => {
  state.buttons = []
})

const refused = (ability: AbilityCall['ability']): AbilityCall =>
  ({
    id: 'call',
    ability,
    tool: 'speak',
    args: {},
    status: 'refused',
    refusal: 'unavailable',
    summary: 'No signed-in provider here has it.',
    sent: { prompt: 'Hello', inputs: [] },
  }) as unknown as AbilityCall

const labels = () => state.buttons.map((button) => String(button.children))

it('keeps the way to add a media key after the agent has finished its turn', () => {
  renderToStaticMarkup(createElement(AbilityRow, { call: refused('speech'), sessionId: 'thread', live: false }))
  expect(labels()).toEqual(['Add a media key', 'Not now'])
})

it('opens the Media keys in Settings › Providers for speech, and Providers for an ability a provider makes', () => {
  const opened: unknown[] = []
  const listen = (event: Event) => opened.push((event as CustomEvent).detail)
  vi.stubGlobal('window', new EventTarget())
  window.addEventListener('ramu:settings', listen)
  renderToStaticMarkup(createElement(AbilityRow, { call: refused('speech'), sessionId: 'thread', live: true }))
  renderToStaticMarkup(
    createElement(AbilityRow, { call: refused('image_generation'), sessionId: 'thread', live: false }),
  )
  expect(labels()).toEqual(['Add a media key', 'Not now', 'Set up a provider', 'Not now'])
  state.buttons[0]!.onClick?.({} as never)
  state.buttons[2]!.onClick?.({} as never)
  vi.unstubAllGlobals()
  expect(opened).toEqual([{ section: 'providers', target: 'Media' }, { section: 'providers' }])
})
