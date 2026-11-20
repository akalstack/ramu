import type { CompatibilityPolicy, RuntimeKind } from '@ramu/shared/providers/compatibility'
import type { AgentProvider } from '@ramu/shared/types'

/**
 * Rules ship with the server and are added only with evidence (a reproduced protocol mismatch or a tested release),
 * alongside the adapter change that needs them. A working rule covers one release line: from the oldest tested release
 * to the next major version, with `tested` naming the newest release probed in it. A new major, or a release older than
 * anything probed, reports Unverified until it is probed; nothing here is a range guessed to fill a matrix. Probing a
 * newer release in the same line moves `tested` and adds its evidence; probing a new major adds a rule.
 */
export const COMPATIBILITY_POLICY: CompatibilityPolicy = {
  revision: 11,
  rules: [
    {
      id: 'claude-code-sdk-2',
      provider: 'claude-code',
      runtime: 'sdk',
      min: '2.1.308',
      below: '3.0.0',
      tested: '2.1.319',
      status: 'supported',
      evidence:
        'Claude Code 2.1.308 (2026-10-23), 2.1.316 (2026-11-02) and 2.1.319 (2026-11-08), each the installed executable driven by @anthropic-ai/claude-agent-sdk 0.3.295 on macOS: initializationResult, supportedCommands and getContextUsage answered, with no model call. The rule keys on the executable; a Ramu release that moves the SDK pin needs its own probe.',
    },
    {
      id: 'opencode-http-1',
      provider: 'opencode',
      runtime: 'http',
      below: '2.0.0',
      status: 'incompatible',
      recommend: '2.2.5',
      evidence:
        'opencode 1.19.6 on macOS, `opencode serve` driven by @opencode/client: the server printed its address and the event stream connected, but the first prompt failed with `Missing key at ["prompt"]`, because OpenCode 1 serves a different HTTP API. `opencode upgrade --major` is its own way to OpenCode 2.',
    },
    {
      id: 'opencode-http-2',
      provider: 'opencode',
      runtime: 'http',
      min: '2.1.3',
      below: '3.0.0',
      tested: '2.2.5',
      status: 'supported',
      evidence:
        'opencode v2.1.3 (2026-10-23) and v2.2.5 (2026-11-02) on macOS: `opencode serve` printed its address, the event stream (via @opencode/client 2.0.30) delivered server.connected and mcp.list answered, with no model call and no session created.',
    },
    {
      id: 'codex-app-server-0',
      provider: 'codex',
      runtime: 'app-server',
      min: '0.150.0',
      below: '1.0.0',
      tested: '0.167.0',
      status: 'supported',
      evidence:
        'codex-cli 0.150.0 and 0.162.1 (darwin-arm64 from npm, 2026-10-23), 0.163.0 (2026-10-23), 0.165.0 (the copy Ramu installs, 2026-11-04), 0.166.0 (2026-11-02) and 0.167.0 (2026-11-08) on macOS: `codex app-server` answered initialize, then model/list and account/rateLimits/read, with no model call. 0.120.0 and 0.100.0 could not be probed: macOS killed their binaries on this machine.',
    },
    {
      id: 'antigravity-acp-1',
      provider: 'antigravity',
      runtime: 'acp',
      min: '1.4.3',
      below: '2.0.0',
      tested: '1.5.0',
      status: 'supported',
      evidence:
        "Google's antigravity-acp 1.4.3 (2026-11-08) and 1.5.0 (2026-11-17), agy_acp_server.par as Ramu downloads it, on macOS: ACP initialize answered protocol version 1 with its agentInfo version, loadSession, session list and resume, and its four sign-in methods; 1.5.0 also listed HTTP and SSE MCP. No model call and no sign-in.",
    },
    {
      id: 'cursor-acp',
      provider: 'cursor',
      runtime: 'acp',
      // Cursor numbers releases by date, so there is no major line to end at; ACP's protocol version is negotiated.
      min: '2026.11.05-86047df',
      tested: '2026.11.13-eacade1',
      status: 'supported',
      evidence:
        'Cursor Agent 2026.11.05-86047df (from cursor.com/install, the script Ramu runs) on macOS, 2026-11-09: `cursor-agent acp` answered ACP initialize with protocol version 1, loadSession, session list, image prompts and its Cursor Login method, with no model call and no sign-in. 2026.11.13-eacade1, 2026-11-17: the same, and HTTP and SSE MCP.',
    },
  ],
}

/** The runtime kind Ramu launches for each provider with an audited policy; others are not evaluated yet. */
export const COMPATIBILITY_RUNTIME: Partial<Record<AgentProvider, RuntimeKind>> = {
  codex: 'app-server',
  opencode: 'http',
  'claude-code': 'sdk',
  antigravity: 'acp',
  cursor: 'acp',
}
