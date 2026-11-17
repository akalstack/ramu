import type { CompatibilityPolicy, RuntimeKind } from '@ramu/shared/providers/compatibility'
import type { AgentProvider } from '@ramu/shared/types'

/**
 * Rules ship with the server and are added only with evidence (a reproduced protocol mismatch or a tested release),
 * alongside the adapter change that needs them. A release no rule covers reports Unverified; nothing here is a range
 * guessed to fill a matrix. Rules are exact releases until a wider range has been tested.
 */
export const COMPATIBILITY_POLICY: CompatibilityPolicy = {
  revision: 9,
  rules: [
    {
      id: 'claude-code-sdk-2.1.308',
      provider: 'claude-code',
      runtime: 'sdk',
      min: '2.1.308',
      below: '2.1.309',
      status: 'supported',
      evidence:
        'Claude Code 2.1.308 (the installed executable) driven by @anthropic-ai/claude-agent-sdk 0.3.295 on macOS, 2026-10-23: initializationResult (118 commands, 8 agents, 13 models), supportedCommands and getContextUsage answered, with no model call. The rule keys on the executable; a Ramu release that moves the SDK pin needs its own probe.',
    },
    {
      id: 'claude-code-sdk-2.1.316',
      provider: 'claude-code',
      runtime: 'sdk',
      min: '2.1.316',
      below: '2.1.317',
      status: 'supported',
      evidence:
        'Claude Code 2.1.316 (the installed executable) driven by @anthropic-ai/claude-agent-sdk 0.3.295 on macOS, 2026-11-02: initializationResult (120 commands, 8 agents, 13 models), supportedCommands and getContextUsage answered, with no model call.',
    },
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
      id: 'opencode-http-2.2.5',
      provider: 'opencode',
      runtime: 'http',
      min: '2.2.5',
      below: '2.2.6',
      status: 'supported',
      evidence:
        'opencode v2.2.5 on macOS, 2026-11-02: `opencode serve` printed its address, the event stream (via @opencode/client 2.0.30) delivered server.connected and mcp.list answered, with no model call and no session created.',
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
    {
      id: 'codex-app-server-0.165.0',
      provider: 'codex',
      runtime: 'app-server',
      min: '0.165.0',
      below: '0.165.1',
      status: 'supported',
      evidence:
        'codex-cli 0.165.0 (the copy Ramu installs, @openai/codex from npm) on macOS, 2026-11-04: `codex app-server --stdio` answered initialize, then model/list (3 models) and account/rateLimits/read, with no model call.',
    },
    {
      id: 'codex-app-server-0.166.0',
      provider: 'codex',
      runtime: 'app-server',
      min: '0.166.0',
      below: '0.166.1',
      status: 'supported',
      evidence:
        'codex-cli 0.166.0 on macOS, 2026-11-02: `codex app-server --stdio` answered initialize, then model/list (3 models) and account/rateLimits/read, with no model call.',
    },
    {
      id: 'codex-app-server-0.167.0',
      provider: 'codex',
      runtime: 'app-server',
      min: '0.167.0',
      below: '0.167.1',
      status: 'supported',
      evidence:
        'codex-cli 0.167.0 on macOS, 2026-11-08: `codex app-server` answered initialize, then model/list (3 models) and account/rateLimits/read, with no model call.',
    },
    {
      id: 'claude-code-sdk-2.1.319',
      provider: 'claude-code',
      runtime: 'sdk',
      min: '2.1.319',
      below: '2.1.320',
      status: 'supported',
      evidence:
        'Claude Code 2.1.319 (the installed executable) driven by @anthropic-ai/claude-agent-sdk 0.3.295 on macOS, 2026-11-08: initializationResult (58 commands and 6 agents with no setting sources loaded, 13 models), supportedCommands and getContextUsage answered, with no model call.',
    },
    {
      id: 'antigravity-acp-1.4.3',
      provider: 'antigravity',
      runtime: 'acp',
      min: '1.4.3',
      below: '1.4.4',
      status: 'supported',
      evidence:
        "Google's antigravity-acp 1.4.3 (agy_acp_server.par as Ramu downloads it) on macOS, 2026-11-08: ACP initialize answered protocol version 1 with agentInfo 1.4.3, loadSession, session list and resume, and its four sign-in methods, with no model call and no sign-in.",
    },
    {
      id: 'antigravity-acp-1.5.0',
      provider: 'antigravity',
      runtime: 'acp',
      min: '1.5.0',
      below: '1.5.1',
      status: 'supported',
      evidence:
        "Google's antigravity-acp 1.5.0 (agy_acp_server.par as Ramu downloads it) on macOS, 2026-11-17: ACP initialize answered protocol version 1 with agentInfo 1.5.0, loadSession, session list and resume, HTTP and SSE MCP, and its four sign-in methods, with no model call and no sign-in.",
    },
    {
      id: 'cursor-acp-2026.11.05',
      provider: 'cursor',
      runtime: 'acp',
      // Cursor numbers releases by date; builds of one day cannot be ordered apart, so the rule spans that day.
      min: '2026.11.05-86047df',
      below: '2026.11.06-0',
      status: 'supported',
      evidence:
        'Cursor Agent 2026.11.05-86047df (from cursor.com/install, the script Ramu runs) on macOS, 2026-11-09: `cursor-agent acp` answered ACP initialize with protocol version 1, loadSession, session list, image prompts and its Cursor Login method, with no model call and no sign-in.',
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
