/** A gently bouncing activity indicator that inherits the surrounding text color. */
export function LoadingDots() {
  return <span className="loading-dots inline-flex items-center justify-center gap-[3px] h-3 [&_i]:size-1 [&_i]:rounded-full [&_i]:bg-current [&_i]:opacity-60 [&_i]:[animation:loading-dot_1.6s_ease-in-out_infinite] [&_i:nth-child(2)]:[animation-delay:160ms] [&_i:nth-child(3)]:[animation-delay:320ms] motion-reduce:[&_i]:animate-none" aria-hidden="true"><i /><i /><i /></span>
}
