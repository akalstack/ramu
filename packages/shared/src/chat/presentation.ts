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

/** Tool labels share a left-to-right sweep; only the decorative completion highlight waits. */
export const TOOL_MOTION = {
  sweepMs: 2200,
  /** The pause between passes, while the highlight is off the end of the text. */
  restMs: 700,
  /** How long a finished tool stays finished before its label lights up; the next tool starting meanwhile cancels it. */
  settleMs: 300,
  finishMs: 650,
  /** A row this new does not light up: it has only just appeared, as when its group opens. */
  quietMs: 500,
  fadeAt: 0.8,
} as const
