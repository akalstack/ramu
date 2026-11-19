/** Keep work that needs attention visible, then a bounded recent history. Filters can still reveal every thread. */
export function recentThreads<T extends { status: string }>(threads: readonly T[], historyLimit: number) {
  const active = (thread: T) => ['needs-input', 'failed', 'running'].includes(thread.status)
  const attention = threads.filter(active)
  const history = threads.filter((thread) => !active(thread))
  return { threads: [...attention, ...history.slice(0, historyLimit)], more: history.length > historyLimit }
}
