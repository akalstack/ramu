import type { CompatibilityPolicy, RuntimeKind } from '@ramu/shared/providers/compatibility'
import type { AgentProvider } from '@ramu/shared/types'

/**
 * Rules ship with the server and are added only with evidence (a reproduced protocol mismatch or a tested release),
 * alongside the adapter change that needs them. A release no rule covers reports Unverified; nothing here is a range
 * guessed to fill a matrix. Rules are exact releases until a wider range has been tested.
 */
export const COMPATIBILITY_POLICY: CompatibilityPolicy = {
  revision: 4,
  rules: [
    {
      id: 'opencode-http-2.1.3',
      provider: 'opencode',
      runtime: 'http',
      min: '2.1.3',
      below: '2.1.4',
      status: 'supported',
      evidence:
        'opencode v2.1.3 on macOS, 2026-10-23: `opencode serve` printed its address, the event stream (via @opencode/client 2.0.30) delivered server.connected and mcp.list answered, with no model call and no session created.',
    },
    {
      id: 'codex-app-server-0.150.0',
      provider: 'codex',
      runtime: 'app-server',
      min: '0.150.0',
      below: '0.150.1',
      status: 'supported',
      evidence:
        'codex-cli 0.150.0 (darwin-arm64 from npm) on macOS, 2026-10-23: `codex app-server --stdio` answered initialize, then model/list (3 models) and account/rateLimits/read, with no model call.',
    },
    {
      id: 'codex-app-server-0.162.1',
      provider: 'codex',
      runtime: 'app-server',
      min: '0.162.1',
      below: '0.162.2',
      status: 'supported',
      evidence:
        'codex-cli 0.162.1 (darwin-arm64 from npm) on macOS, 2026-10-23: `codex app-server --stdio` answered initialize, then model/list (7 models) and account/rateLimits/read, with no model call.',
    },
    {
      id: 'codex-app-server-0.163.0',
      provider: 'codex',
      runtime: 'app-server',
      min: '0.163.0',
      below: '0.163.1',
      status: 'supported',
      evidence:
        'codex-cli 0.163.0 on macOS, 2026-10-23: `codex app-server --stdio` answered initialize, then model/list (7 models) and account/rateLimits/read, with no model call. 0.120.0 and 0.100.0 could not be probed: macOS killed their binaries on this machine (exit 137), which says nothing about the protocol.',
    },
  ],
}

/** The runtime kind Ramu launches for each provider with an audited policy; others are not evaluated yet. */
/**
 * OpenCode 2 runs over its HTTP API; OpenCode 1 runs over ACP and has no rule, so it reports Unverified here until its
 * own ACP handshake is probed.
 */
export const COMPATIBILITY_RUNTIME: Partial<Record<AgentProvider, RuntimeKind>> = {
  codex: 'app-server',
  opencode: 'http',
}
