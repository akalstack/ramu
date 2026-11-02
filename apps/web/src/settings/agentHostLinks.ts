import type { AgentHostSummary, Computer } from '@ramu/shared/types'

export const sameAddress = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '')

/** Connected hosts agents could use. An SSH address is a tunnel that only this window can reach. */
export const agentReachable = (computers: Computer[]) =>
  computers.filter((computer) => !computer.local && !computer.ssh && !!computer.url && computer.status === 'connected')

/** Whether agents already use every one of `computers`. False with none, so the switch never reads on for nothing. */
export const agentsOnEverywhere = (computers: Computer[], hosts: AgentHostSummary[]) =>
  computers.length > 0 &&
  computers.every((computer) => hosts.some((host) => sameAddress(host.address, computer.url ?? '')))

/** Agent hosts with no row in the host list, such as one added with `ramu hosts add`, so they stay visible. */
export const unlistedAgentHosts = (hosts: AgentHostSummary[], computers: Computer[]) =>
  hosts.filter((host) => !computers.some((computer) => computer.url && sameAddress(computer.url, host.address)))
