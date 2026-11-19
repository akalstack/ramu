import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import type { DictationState } from '@ramu/shared/voice/dictation'

vi.mock('../src/ipc', () => ({ copyText: vi.fn() }))
vi.mock('../src/i18n', () => ({ t: (value: string) => value }))
import { DictationStatus, MicButton } from '../src/voice/DictationControls'

const target = { draftKey: 'draft', revision: 1, selection: { start: 0, end: 0 } }
const render = (state: DictationState) =>
  renderToStaticMarkup(
    createElement(DictationStatus, {
      state,
      level: 0.5,
      onStop() {},
      onCancel() {},
      onInsert() {},
      onDismiss() {},
    }),
  )

it('names both icon actions of a running take with their keys', () => {
  const html = render({ phase: 'recording', target, startedAt: Date.now() })
  expect(html).toContain('title="Cancel recording (Esc)"')
  expect(html).toContain('title="Stop and transcribe (Enter)"')
  expect(html).toContain('aria-label="Stop and transcribe"')
})

it('announces the phase without putting the ticking clock in the live region', () => {
  const html = render({ phase: 'recording', target, startedAt: Date.now() })
  expect(html).toMatch(/<span role="status" aria-live="polite">Recording<\/span>/)
  expect(html).toMatch(/<span aria-hidden="true" class="[^"]*tabular-nums">0:00/)
})

it('offers Transcribe and Discard at the limit, with no moving meter', () => {
  const html = render({ phase: 'limit', target, startedAt: 0 })
  expect(html).toContain('Recording limit reached')
  expect(html).toContain('title="Transcribe (Enter)"')
  expect(html).toContain('title="Discard (Esc)"')
  expect(html).not.toContain('transition-[height]')
})

it('keeps the microphone glyph while active so it cannot read as the turn Stop', () => {
  const html = renderToStaticMarkup(
    createElement(MicButton, { active: true, title: 'Stop and transcribe', onClick() {} }),
  )
  expect(html).toContain('lucide-mic')
  expect(html).toContain('aria-pressed="true"')
})
