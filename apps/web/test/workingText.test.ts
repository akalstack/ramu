import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { TOOL_MOTION } from '@ramu/shared/chat/presentation'
import { WorkingText } from '../src/views/agent/components/WorkingText'

const at = (now: number, label: string) => {
  vi.spyOn(performance, 'now').mockReturnValue(now)
  const html = renderToStaticMarkup(createElement(WorkingText, null, label))
  return /animation:([^;"]+)/.exec(html)?.[1]?.trim()
}

afterEach(() => vi.restoreAllMocks())

it('breathes on the clock’s phase with opacity alone, so a new label never restarts it and nothing repaints', () => {
  const short = at(500, 'Running ls')
  // Mounted a whole pass later with a much longer label: the same length, at the same point of its pass.
  const long = at(500 + TOOL_MOTION.sweepMs, `Running ${'pnpm test '.repeat(12)}`)
  expect(short).toBe(`working-breathe ${TOOL_MOTION.sweepMs}ms ease-in-out -500ms infinite`)
  expect(long).toBe(short)
})
