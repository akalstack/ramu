import type { AgentHostSummary, Computer } from '@ramu/shared/types'

export const sameAddress = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '')

/** Agent hosts with no row in the host list, such as one added with `ramu hosts add`, so they stay visible. */
export const unlistedAgentHosts = (hosts: AgentHostSummary[], computers: Computer[]) =>
  hosts.filter((host) => !computers.some((computer) => computer.url && sameAddress(computer.url, host.address)))
