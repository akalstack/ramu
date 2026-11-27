import { expect, it } from 'vitest'
import { sweepDuration, TOOL_MOTION } from '../src/chat/presentation'

it('keeps short labels at the base pace and slows the completion highlight across long ones', () => {
  expect(sweepDuration(0, TOOL_MOTION.finishMs, TOOL_MOTION.finishPxPerSecond)).toBe(TOOL_MOTION.finishMs)
  // A 720px command crosses at the same 360px/s as a short label, so it takes 2s instead of streaking past.
  expect(sweepDuration(720, TOOL_MOTION.finishMs, TOOL_MOTION.finishPxPerSecond)).toBe(2000)
})
