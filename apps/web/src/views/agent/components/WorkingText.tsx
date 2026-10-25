import { TOOL_MOTION } from '@ramu/shared/chat/presentation'
/** Keep the moving text highlight without a background shorthand resetting text clipping. */
export function WorkingText({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="shimmer bg-clip-text text-transparent motion-reduce:animate-none!"
      style={{
        backgroundImage: 'linear-gradient(90deg, var(--muted) 30%, var(--text) 50%, var(--muted) 70%)',
        backgroundSize: '200% 100%',
        backgroundRepeat: 'repeat-x',
        animation: `shimmer ${TOOL_MOTION.sweepMs}ms linear infinite`,
      }}
    >
      {children}
    </span>
  )
}
