import { AGENT_PROVIDERS } from '@ramu/shared/providers/providers'
import type { AgentRunnerFactory, ProviderRunners } from '../agent/agentRunner'
import { createAcpRunner } from './acp'
import { createCodexRunner } from './codex'
import { createCursorRunner } from './cursor'
import { createOpenCodeRunner } from './opencode'

/**
 * Chat runners for every provider that has one. Each uses the provider's own SDK, HTTP API or app protocol where one
 * exists; Antigravity has only ACP. Claude Code is absent on purpose: it runs on the Claude Agent SDK query loop.
 */
export const DEFAULT_RUNNERS: ProviderRunners = {
  codex: createCodexRunner,
  cursor: createCursorRunner,
  antigravity: createAcpRunner,
  opencode: createOpenCodeRunner,
}

/** One runner for every provider except Claude Code, for simulated providers. */
export const sameRunnerForAll = (factory: AgentRunnerFactory): ProviderRunners =>
  Object.fromEntries(AGENT_PROVIDERS.filter((id) => id !== 'claude-code').map((id) => [id, factory]))
