import { useState } from 'react'
import { TOOL_MOTION } from '@ramu/shared/chat/presentation'

/**
 * A label still at work, as on the phone: the label in its own (muted) color, with a copy in the text color over it
 * that fades in and out, so it pulses lighter rather than dimming. Only that copy's opacity changes, which the
 * compositor draws without repainting the text. Every label shares one phase, set by the clock, so a new label (the
 * next command) or a re-render continues the pulse instead of restarting it.
 */
export function WorkingText({ children }: { children: React.ReactNode }) {
  const [phase] = useState(() => -(performance.now() % TOOL_MOTION.sweepMs))
  // Never wider than its row: a long command's label is cut with an ellipsis here.
  const line = 'block max-w-full overflow-hidden text-ellipsis whitespace-nowrap'
  return (
    <span className="relative inline-block max-w-full align-bottom">
      <span className={line}>{children}</span>
      <span
        aria-hidden="true"
        className={`${line} pointer-events-none absolute inset-0 text-foreground opacity-0 motion-reduce:hidden`}
        style={{ animation: `working-glow ${TOOL_MOTION.sweepMs}ms ease-in-out ${phase}ms infinite` }}
      >
        {children}
      </span>
    </span>
  )
}
