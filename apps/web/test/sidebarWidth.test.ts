import { expect, it } from 'vitest'
import { parseSidebarWidth } from '../src/workspace/panelLayout'
import { SIDEBAR_WIDTH_RANGE } from '@ramu/shared/types'

it('accepts only stored widths inside the sidebar range', () => {
  expect(parseSidebarWidth(String(SIDEBAR_WIDTH_RANGE[0]))).toBe(SIDEBAR_WIDTH_RANGE[0])
  expect(parseSidebarWidth(String(SIDEBAR_WIDTH_RANGE[1]))).toBe(SIDEBAR_WIDTH_RANGE[1])
  for (const raw of [null, '', 'wide', '1.5', String(SIDEBAR_WIDTH_RANGE[0] - 1), String(SIDEBAR_WIDTH_RANGE[1] + 1)])
    expect(parseSidebarWidth(raw), String(raw)).toBeNull()
})
