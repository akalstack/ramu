import type { AgentHostSummary, Computer } from '@ramu/shared/types'

const sameAddress = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '')

/**
 * Paired hosts agents could also use, so the address need not be typed. An SSH host's address is a local tunnel that
 * only this window can reach, so it is left out.
 */
export function agentHostChoices(computers: Computer[], added: AgentHostSummary[]) {
  return computers.filter(
    (computer): computer is Computer & { url: string } =>
      !computer.local &&
      !computer.ssh &&
      !!computer.url &&
      !added.some((host) => sameAddress(host.address, computer.url!)),
  )
}
