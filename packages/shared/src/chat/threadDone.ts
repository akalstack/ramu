/** What marking a thread done stops: running work the person confirms before it ends. */
export interface ThreadDoneImpact {
  /** Background commands still running, which includes any dev server they run. */
  commands: number
  /** Helper agents still working. */
  helpers: number
  /** The thread is using a computer. */
  computer: boolean
  /** Browser tabs the thread has open. */
  browserTabs: number
  /** Servers the thread's work left running outside its background commands, such as one started with `nohup`. */
  servers?: number
}

/** Whether marking the thread done would stop anything, so it is worth asking first. */
export const doneStopsWork = (impact: ThreadDoneImpact): boolean =>
  impact.commands > 0 || impact.helpers > 0 || impact.computer || impact.browserTabs > 0 || (impact.servers ?? 0) > 0

/** Several threads' impacts as one, for marking a selection done. */
export const combinedImpact = (impacts: ThreadDoneImpact[]): ThreadDoneImpact => ({
  commands: impacts.reduce((sum, impact) => sum + impact.commands, 0),
  helpers: impacts.reduce((sum, impact) => sum + impact.helpers, 0),
  computer: impacts.some((impact) => impact.computer),
  browserTabs: impacts.reduce((sum, impact) => sum + impact.browserTabs, 0),
  servers: impacts.reduce((sum, impact) => sum + (impact.servers ?? 0), 0),
})
