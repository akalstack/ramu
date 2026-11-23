import { expect, it } from 'vitest'
import { sweepDuration, TOOL_MOTION } from '../src/chat/presentation'

it('keeps short labels at the base pace and slows the highlight across long ones', () => {
  expect(sweepDuration(120, TOOL_MOTION.sweepMs, TOOL_MOTION.sweepPxPerSecond)).toBe(TOOL_MOTION.sweepMs)
  // A 700px command crosses at the same 140px/s as a short label, so it takes 5s instead of streaking past in 2.2s.
  expect(sweepDuration(700, TOOL_MOTION.sweepMs, TOOL_MOTION.sweepPxPerSecond)).toBe(5000)
  expect(sweepDuration(0, TOOL_MOTION.finishMs, TOOL_MOTION.finishPxPerSecond)).toBe(TOOL_MOTION.finishMs)
})
