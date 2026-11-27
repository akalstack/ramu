import { useState } from 'react'
import { TOOL_MOTION } from '@ramu/shared/chat/presentation'

/**
 * A label still at work, breathing in and out as the phone's does. Opacity is drawn by the compositor, so a thread at
 * work no longer repaints its text every frame the way the old sweep across clipped text did, which kept the window,
 * its GPU process and the system's window server busy for as long as an agent ran. Every label shares one phase, set
 * by the clock, so a new label (the next command) or a re-render continues the breath instead of restarting it.
 */
export function WorkingText({ children }: { children: React.ReactNode }) {
  const [phase] = useState(() => -(performance.now() % TOOL_MOTION.sweepMs))
  return (
    <span
      // Never wider than its row: a long command's label is cut with an ellipsis here.
      className="inline-block max-w-full overflow-hidden text-ellipsis whitespace-nowrap align-bottom motion-reduce:animate-none!"
      style={{ animation: `working-breathe ${TOOL_MOTION.sweepMs}ms ease-in-out ${phase}ms infinite` }}
    >
      {children}
    </span>
  )
}
