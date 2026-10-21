import type { CompatibilityPolicy, RuntimeKind } from '@ramu/shared/providers/compatibility'
import type { AgentProvider } from '@ramu/shared/types'

/**
 * Rules ship with the server and are added only with evidence (a reproduced protocol mismatch or a tested range),
 * alongside the adapter change that needs them. Codex has none yet, so every Codex runtime reports Unverified.
 */
export const COMPATIBILITY_POLICY: CompatibilityPolicy = { revision: 1, rules: [] }

/** The runtime kind Ramu launches for each provider with an audited policy; others are not evaluated yet. */
export const COMPATIBILITY_RUNTIME: Partial<Record<AgentProvider, RuntimeKind>> = { codex: 'app-server' }
