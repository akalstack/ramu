import type { AgentProvider } from '@ramu/shared/types'
import type { ProviderAdapter } from '../adapter'
import { antigravityAdapter } from './antigravity'
import { claudeCodeAdapter } from './claude-code'
import { codexAdapter } from './codex'
import { cursorAdapter } from './cursor'
import { opencodeAdapter } from './opencode'

export const PROVIDER_ADAPTERS: Record<AgentProvider, ProviderAdapter> = {
  'claude-code': claudeCodeAdapter,
  codex: codexAdapter,
  opencode: opencodeAdapter,
  cursor: cursorAdapter,
  antigravity: antigravityAdapter,
}

export const providerAdapter = (id: AgentProvider): ProviderAdapter => PROVIDER_ADAPTERS[id]
