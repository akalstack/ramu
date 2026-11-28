/** Chat entrances and status changes share one brief fade-and-rise; content never waits for motion. */
export const CHAT_MOTION = {
  durationMs: 180,
  rise: 4,
  easing: [0.22, 1, 0.36, 1] as const,
}

/**
 * A message you just sent rises from the composer into its place: it starts lower and a little smaller, grows from its
 * bottom-right corner and settles with a slight overshoot. The host's copy that replaces it mid-way finishes the rise.
 */
export const SENT_MOTION = {
  durationMs: 340,
  rise: 56,
  scale: 0.92,
  /** The share of the rise by which it is fully opaque. */
  opaqueAt: 0.3,
  easing: [0.2, 0.9, 0.3, 1.08] as const,
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

/** How a running tool label moves: one pulse every label shares, after a short wait. */
export const TOOL_MOTION = {
  /** One pulse of a working label, in and out. */
  sweepMs: 2200,
  /** A call that ends sooner than this never starts its working shimmer, so a quick command does not flash. */
  shimmerDelayMs: 600,
} as const
