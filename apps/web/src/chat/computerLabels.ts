import type { ComputerSessionSummary } from '@ramu/shared/api'

export function controllerLabel(session: ComputerSessionSummary): string {
  if (session.paused) return 'Control paused'
  if (session.controller.kind === 'human') return 'You are in control'
  if (session.controller.kind === 'agent') return 'Agent control'
  return 'Ready'
}
