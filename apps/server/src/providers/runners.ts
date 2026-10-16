import { execFileSync } from 'node:child_process'
import { AGENT_PROVIDERS } from '@ramu/shared/providers/providers'
import type { AgentRunnerFactory, ProviderRunners } from '../agent/agentRunner'
import { createAcpRunner } from './acp'
import { createCodexRunner } from './codex'
import { createCursorRunner } from './cursor'
import { createOpenCodeRunner } from './opencode'
import { providerBinary, providerEnvironment } from './providerBinaries'

/** OpenCode 2 has the HTTP API the SDK runner uses; 1.x keeps its ACP mode. Read once per installed binary. */
const openCodeMajors = new Map<string, number>()
export function openCodeMajor(binary = providerBinary('opencode')): number {
  let major = openCodeMajors.get(binary)
  if (major === undefined) {
    try {
      const out = execFileSync(binary, ['--version'], {
        timeout: 5000,
        env: providerEnvironment('opencode'),
      }).toString()
      major = Number(/(\d+)\.\d+\.\d+/.exec(out)?.[1] ?? 2)
    } catch {
      major = 2
    }
    openCodeMajors.set(binary, major)
  }
  return major
}

const openCode: AgentRunnerFactory = (...args) =>
  (openCodeMajor() >= 2 ? createOpenCodeRunner : createAcpRunner)(...args)

/**
 * Chat runners for every provider that has one. Each uses the provider's own SDK or app protocol where one exists;
 * Antigravity has only ACP. Claude Code is absent on purpose: it runs on the Claude Agent SDK query loop.
 */
export const DEFAULT_RUNNERS: ProviderRunners = {
  codex: createCodexRunner,
  cursor: createCursorRunner,
  antigravity: createAcpRunner,
  opencode: openCode,
}

/** One runner for every provider except Claude Code, for simulated providers. */
export const sameRunnerForAll = (factory: AgentRunnerFactory): ProviderRunners =>
  Object.fromEntries(AGENT_PROVIDERS.filter((id) => id !== 'claude-code').map((id) => [id, factory]))
