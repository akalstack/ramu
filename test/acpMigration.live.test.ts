// Opt-in inference in disposable workspaces. Never resumes a user's existing chat.
import { expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { claudeAcpQuery } from '../src/main/claudeAcpQuery'
import { providerBinary } from '../src/main/providerBinaries'
import { acpHostedRunner } from '../src/main/acpNativeHost'
import { createCodexRunner } from '../src/main/codex'
import { createAcpRunner } from '../src/main/acp'
import { DEFAULT_AGENT_SETTINGS, type AgentEvent } from '../src/shared/types'

const enabled = process.env.RAMU_ACP_MIGRATION_LIVE === '1'
it.skipIf(!enabled)('Claude completes a tool-free, nonpersistent turn through the ACP host', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ramu-acp-claude-live-'))
  const client = claudeAcpQuery(query)({ prompt: (async function* () { yield { type: 'user' as const, parent_tool_use_id: null, message: { role: 'user' as const, content: 'Reply exactly RAMU_ACP_OK. Do not use tools.' } } })(), options: { cwd, tools: [], persistSession: false, settingSources: [], maxTurns: 1, permissionMode: 'default', pathToClaudeCodeExecutable: providerBinary('claude-code'), canUseTool: async () => ({ behavior: 'deny', message: 'Tool-free ACP verification' }) } })
  let text = '', completed = false
  try {
    for await (const message of client) {
      if (message.type === 'assistant') for (const block of message.message.content) if (block.type === 'text') text += block.text
      if (message.type === 'result') { expect(message.is_error).toBe(false); completed = true }
    }
    expect(text).toContain('RAMU_ACP_OK'); expect(completed).toBe(true)
  } finally { client.close(); rmSync(cwd, { recursive: true, force: true }) }
}, 90_000)
for (const [provider, factory] of [['codex', createCodexRunner], ['opencode', createAcpRunner]] as const) {
  it.skipIf(!enabled)(`${provider} completes background analysis through the ACP host`, async () => {
    const cwd = mkdtempSync(join(tmpdir(), `ramu-acp-${provider}-live-`)), events: AgentEvent[] = []
    let finish!: () => void
    const done = new Promise<void>((resolve) => { finish = resolve })
    const runner = (provider === 'opencode' ? factory : acpHostedRunner(factory))({ cwd, additionalDirs: [], covers: [] }, { ...DEFAULT_AGENT_SETTINGS, provider, accountId: 'default', access: 'edits' }, (event) => { events.push(event); if (event.kind === 'result' || event.kind === 'error') finish() }, true)
    const timer = setTimeout(finish, 70_000)
    try {
      await runner.start('Reply exactly RAMU_ACP_OK. Do not use tools.', null)
      await done
      expect(events.some((event) => event.kind === 'result' && !event.isError), JSON.stringify(events.filter((event) => event.kind === 'error' || event.kind === 'result'))).toBe(true)
      expect(events.filter((event) => event.kind === 'text').at(-1)).toMatchObject({ text: expect.stringContaining('RAMU_ACP_OK') })
      expect(events.some((event) => event.kind === 'permission-request')).toBe(false)
    } finally { clearTimeout(timer); await runner.stop(); rmSync(cwd, { recursive: true, force: true }) }
  }, 90_000)
}
