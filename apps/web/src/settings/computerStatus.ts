import type { RamuMethods } from '@ramu/shared/api'

type Status = ReturnType<RamuMethods['computer.status']>

export function runtimeHelp(status: Status | null): string {
  if (!status) return 'Checking…'
  if (!status.runtime.available)
    return status.runtime.detail ?? 'Computer use is not available on this host. It currently supports macOS.'
  return `Ready on ${status.runtime.computer.name}. Each thread still needs your approval before the agent can see or control the screen.`
}
