import type { AgentToolDetails, AgentToolKind } from './types'

export const TOOL_KINDS: AgentToolKind[] = [
  'read',
  'edit',
  'delete',
  'move',
  'search',
  'execute',
  'think',
  'fetch',
  'switch_mode',
  'other',
]
export function toolKind(tool: AgentToolDetails & { name: string }): AgentToolKind {
  if (tool.toolKind) return tool.toolKind
  const name = tool.name.toLowerCase().replace(/[^a-z]/g, '')
  if (/^(bash|shell|execute|execcommand|runcommand|terminal|writestdin)$/.test(name)) return 'execute'
  if (/^(edit|multiedit|write|notebookedit|applypatch|patchedit|filechange)$/.test(name)) return 'edit'
  if (/^(read|readfile|viewimage|imageview|openfile)$/.test(name)) return 'read'
  if (/^(grep|glob|search|websearch|find|listfiles)$/.test(name)) return 'search'
  if (/^(webfetch|fetch|openpage|browse)$/.test(name)) return 'fetch'
  if (/^(think|thinking|reasoning|plan)$/.test(name)) return 'think'
  if (/^(delete|removefile)$/.test(name)) return 'delete'
  if (/^(move|rename)$/.test(name)) return 'move'
  if (name === 'switchmode') return 'switch_mode'
  return 'other'
}
export const KIND_VERB: Record<AgentToolKind, string> = {
  read: 'Read',
  edit: 'Edited',
  delete: 'Deleted',
  move: 'Moved',
  search: 'Searched',
  execute: 'Ran',
  think: 'Thought',
  fetch: 'Fetched',
  switch_mode: 'Changed mode',
  other: 'Used',
}
export const KIND_LABEL: Record<AgentToolKind, string> = {
  read: 'Read',
  edit: 'Edit',
  delete: 'Delete',
  move: 'Move',
  search: 'Search',
  execute: 'Shell',
  think: 'Thinking',
  fetch: 'Fetch',
  switch_mode: 'Mode',
  other: 'Tool',
}
