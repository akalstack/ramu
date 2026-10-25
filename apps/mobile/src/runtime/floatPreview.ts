/** What the chat last saw of a thread's computer: whether it had access and whether the agent was driving it. */
export type ComputerGlance = { present: boolean; agent: boolean }

/**
 * Whether to float the computer preview: when the thread gains a computer or the agent starts driving it. A session
 * already running when the chat opened, or the person's own control, never pops up.
 */
export function revealsComputer(previous: ComputerGlance | null, next: ComputerGlance): boolean {
  if (!previous || !next.present) return false
  return (!previous.present && next.present) || (!previous.agent && next.agent)
}
