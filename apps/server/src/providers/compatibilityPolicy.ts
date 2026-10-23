import type { CompatibilityPolicy, RuntimeKind } from '@ramu/shared/providers/compatibility'
import type { AgentProvider } from '@ramu/shared/types'

/**
 * Rules ship with the server and are added only with evidence (a reproduced protocol mismatch or a tested release),
 * alongside the adapter change that needs them. A release no rule covers reports Unverified; nothing here is a range
 * guessed to fill a matrix. Rules are exact releases until a wider range has been tested.
 */
export const COMPATIBILITY_POLICY: CompatibilityPolicy = {
  revision: 2,
  rules: [
    {
      id: 'codex-app-server-0.163.0',
      provider: 'codex',
      runtime: 'app-server',
      min: '0.163.0',
      below: '0.163.1',
      status: 'supported',
      evidence:
        'codex-cli 0.163.0 on macOS, 2026-10-23: `codex app-server --stdio` answered initialize, then model/list (7 models) and account/rateLimits/read, with no model call. A reproduced mismatch on an older release is still to be recorded.',
    },
  ],
}

/** The runtime kind Ramu launches for each provider with an audited policy; others are not evaluated yet. */
export const COMPATIBILITY_RUNTIME: Partial<Record<AgentProvider, RuntimeKind>> = { codex: 'app-server' }
