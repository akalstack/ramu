import type { TaskUiState, TerminalGroup, ViewDescriptor } from './types'

export function terminalGroups(state: TaskUiState): TerminalGroup[] {
  const ids = state.views.filter((view) => view.kind === 'terminal').map((view) => view.id)
  const saved =
    state.terminalGroups ??
    (state.terminalLayout && state.terminalLayout !== 'tabs' && ids.length
      ? [{ id: ids[0]!, terminalIds: ids, layout: state.terminalLayout }]
      : [])
  const seen = new Set<string>(),
    groups: TerminalGroup[] = []
  for (const group of saved) {
    const members = group.terminalIds.filter((id) => {
      if (!ids.includes(id) || seen.has(id)) return false
      seen.add(id)
      return true
    })
    if (members.length) groups.push({ ...group, terminalIds: members })
  }
  for (const id of ids) if (!seen.has(id)) groups.push({ id, terminalIds: [id], layout: 'horizontal' })
  return groups
}

export function splitTerminal(state: TaskUiState, layout: TerminalGroup['layout'], newId: string): TaskUiState {
  const views = state.views.filter((view) => view.kind === 'terminal')
  const source = views.find((view) => view.id === state.activeTerminalId) ?? views.at(-1)
  const groups = terminalGroups(state)
  const group = groups.find((entry) => entry.terminalIds.includes(source?.id ?? ''))
  const next: ViewDescriptor = { kind: 'terminal', id: newId, repoId: source?.repoId }
  return {
    ...state,
    views: [...state.views, next],
    activeTerminalId: newId,
    terminalOpen: true,
    terminalGroups: group
      ? groups.map((entry) =>
          entry.id === group.id ? { ...entry, layout, terminalIds: [...entry.terminalIds, newId] } : entry,
        )
      : [...groups, { id: newId, terminalIds: [newId], layout }],
  }
}

export function unsplitTerminal(state: TaskUiState, terminalId: string): TaskUiState {
  const groups = terminalGroups(state)
  const group = groups.find((entry) => entry.terminalIds.includes(terminalId))
  if (!group || group.terminalIds.length < 2) return state
  const remaining = group.terminalIds.filter((id) => id !== terminalId)
  return {
    ...state,
    activeTerminalId: terminalId,
    terminalGroups: groups.flatMap((entry) =>
      entry.id === group.id
        ? [
            { ...entry, id: remaining[0]!, terminalIds: remaining },
            { id: terminalId, terminalIds: [terminalId], layout: entry.layout },
          ]
        : [entry],
    ),
  }
}

export function terminalFocusAfterClose(state: TaskUiState, closed: Set<string>): string | null | undefined {
  if (!closed.has(state.activeTerminalId ?? '')) return state.activeTerminalId
  const groups = terminalGroups(state)
  const current = groups.find((group) => group.terminalIds.includes(state.activeTerminalId ?? ''))
  return (
    current?.terminalIds.find((id) => !closed.has(id)) ??
    groups.flatMap((group) => group.terminalIds).findLast((id) => !closed.has(id)) ??
    null
  )
}
