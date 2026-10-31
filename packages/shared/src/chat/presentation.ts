/** Chat entrances and status changes share one brief fade-and-rise; content never waits for motion. */
export const CHAT_MOTION = {
  durationMs: 180,
  rise: 4,
  easing: [0.22, 1, 0.36, 1] as const,
}

/** Used by desktop CSS and native animation adapters; keep platform widgets outside shared. */
export const chatMotionVariables = {
  '--chat-enter-duration': `${CHAT_MOTION.durationMs}ms`,
  '--chat-enter-rise': `${CHAT_MOTION.rise}px`,
  '--chat-enter-ease': `cubic-bezier(${CHAT_MOTION.easing.join(', ')})`,
}

/** Desktop reference links are the visual reference for native inline chips too. */
export const REFERENCE_APPEARANCE = {
  maxWidth: 360,
  gap: 4,
  fontWeight: '400' as const,
}

/** Tool labels share a left-to-right sweep; only the decorative completion highlight waits. */
export const TOOL_MOTION = {
  sweepMs: 2200,
  settleMs: 120,
  finishMs: 360,
  fadeAt: 0.8,
} as const
