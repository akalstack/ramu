import type { AgentEvent } from '../types'

type ToolResult = Extract<AgentEvent, { kind: 'tool-result' }>

/** A streamed result can contain output while its command is still running. */
export function toolIsRunning(result: ToolResult | undefined, activeTurn: boolean): boolean {
  return activeTurn && (!result || result.running === true)
}

export function toolVerb(verb: string, running: boolean): string {
  if (!running) return verb
  return (
    (
      {
        Ran: 'Running',
        Edited: 'Editing',
        Read: 'Reading',
        Wrote: 'Writing',
        Searched: 'Searching',
        Listed: 'Listing',
        Fetched: 'Fetching',
        Deleted: 'Deleting',
        Moved: 'Moving',
        Thought: 'Thinking',
        Used: 'Using',
        'Changed mode': 'Changing mode',
        'Searched the web': 'Searching the web',
      } as Record<string, string>
    )[verb] ?? verb
  )
}
