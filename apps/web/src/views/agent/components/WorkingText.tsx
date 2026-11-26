import { useState } from 'react'
import { TOOL_MOTION } from '@ramu/shared/chat/presentation'

/**
 * The moving highlight over a label still at work, as Codex and T3 Code draw it: one pass of a fixed length, placed by
 * the clock rather than started when the label mounts. A new label (the next command), a resize or a re-render keeps
 * the highlight where it was instead of restarting it from the left edge, which is what made it flash. The background
 * is set longhand so no shorthand resets the text clipping.
 */
export function WorkingText({ children }: { children: React.ReactNode }) {
  // Every label shares one phase: a pass that began before this one mounted is already this far along.
  const [phase] = useState(() => -(performance.now() % TOOL_MOTION.sweepMs))
  return (
    <span
      // Never wider than its row: a long command's label is cut with an ellipsis here, so the highlight crosses what
      // shows rather than text far past the edge.
      className="shimmer inline-block max-w-full overflow-hidden text-ellipsis whitespace-nowrap align-bottom bg-clip-text text-transparent motion-reduce:animate-none!"
      style={{
        backgroundImage: 'linear-gradient(90deg, var(--muted) 30%, var(--text) 50%, var(--muted) 70%)',
        backgroundSize: '200% 100%',
        backgroundRepeat: 'repeat-x',
        animation: `shimmer ${TOOL_MOTION.sweepMs}ms linear ${phase}ms infinite`,
      }}
    >
      {children}
    </span>
  )
}
