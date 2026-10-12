// Live helper replay in new audit sessions only. Claude's session is created
// directly through the SDK; Codex uses ACP over its native app-server.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { auditHost, textOf, reportFailure } from './acp-audit-host.mjs'
if (!process.argv[2] || !process.argv.includes('--live')) throw new Error('Usage: node scripts/acp-live-helper-recovery.mjs <isolated install directory> --live')
const runtime = resolve(process.argv[2])
function replayRows(events, rootId) {
  return events.filter((event) => event.sessionId !== rootId && event.update.sessionUpdate === 'agent_message_chunk' && event.update.content?.type === 'text').map((event) => ({ childId: event.sessionId, messageId: event.update.messageId, text: event.update.content.text }))
}
async function probe(provider) {
  const cwd = await mkdtemp(join(tmpdir(), 'ramu-acp-helper-history-'))
  const events = []
  let host
  let sdk
  let query
  let sessionId
  let stage = 'create-native-helper'
  const children = []
  const nativeChildIds = new Set()
  let deleted = false
  let childCleanup = 0
  const options = { persistSession: true, tools: ['Agent'], permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true }
  async function load() {
    events.length = 0
    host = await auditHost(provider, runtime, cwd, { sessionId, options, legacySubagents: provider === 'codex', onUpdate: async (event) => events.push(event) })
  }
  try {
    if (provider === 'claude') {
      sdk = await import(pathToFileURL(join(runtime, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'sdk.mjs')).href)
      query = sdk.query({ prompt: 'Audit: use Agent exactly once with subagent_type general-purpose, run_in_background=false, and prompt "Use no tools and reply exactly ACP_CHILD_HISTORY." After it completes, reply ACP_PARENT_HISTORY. No other tool calls.', options: { ...options, cwd, settingSources: [], maxTurns: 3, pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_EXECUTABLE, spawnClaudeCodeProcess: (spawnOptions) => {
        const child = spawn(spawnOptions.command, spawnOptions.args, { cwd: spawnOptions.cwd, env: spawnOptions.env, signal: spawnOptions.signal, stdio: ['pipe', 'pipe', 'pipe'] }); children.push(child); return child
      } } })
      for await (const message of query) {
        if (message.session_id) sessionId = message.session_id
        if (message.type === 'result') { assert.equal(message.subtype, 'success'); break }
      }
      await query.close()
      const ids = await sdk.listSubagents(sessionId, { dir: cwd })
      assert.equal(ids.length, 1, 'Native saved helper missing')
      const history = await sdk.getSubagentMessages(sessionId, ids[0], { dir: cwd })
      assert.ok(JSON.stringify(history).includes('ACP_CHILD_HISTORY'), 'Native helper transcript marker missing')
    } else {
      host = await auditHost(provider, runtime, cwd, { legacySubagents: true, onUpdate: async (event) => {
        events.push(event)
        if (event.update.sessionUpdate === 'subagent_spawned') nativeChildIds.add(event.update.subagentSessionId)
      } })
      sessionId = host.sessionId
      await host.mode('agent-full-access')
      await host.prompt('Integration audit explicitly authorizes one native helper. Invoke whichever native agent-spawning tool is available, exactly once, with message "Do not use any tools. Reply exactly ACP_CHILD_HISTORY." Wait for that helper to complete using its native waiting tool, then reply ACP_PARENT_HISTORY. Actually invoke the helper; do not simulate it. Do not use shell, files, network, or additional helpers.')
      assert.equal(nativeChildIds.size, 1, 'Live helper announcement missing')
      await host.close({ preserve: true }); host = undefined
    }
    stage = 'first-helper-replay'
    await load()
    const first = replayRows(events, sessionId)
    assert.ok(first.length > 0, 'ACP helper replay missing')
    assert.ok(first.map((row) => row.text).join('').includes('ACP_CHILD_HISTORY'), 'ACP helper transcript marker missing')
    assert.ok(first.every((row) => typeof row.messageId === 'string' && row.messageId.length > 0), 'Helper message IDs missing')
    const announcements = events.filter((event) => event.update.sessionUpdate === 'subagent_spawned').map((event) => event.update.subagentSessionId)
    assert.equal(new Set(announcements).size, 1)
    assert.ok(first.every((row) => announcements.includes(row.childId)), 'Helper text escaped child attribution')
    await host.close({ preserve: true }); host = undefined
    stage = 'second-helper-replay'
    await load()
    assert.deepEqual(replayRows(events, sessionId), first, 'Helper replay changed after restart')
    console.log(JSON.stringify({ test: `live-${provider}-native-helper-recovery`, passed: true, nativeTranscriptRead: provider === 'claude', helperTranscriptReplayed: true, childAttributionPreserved: true, repeatedBootStableChildAndMessageIds: true, legacyCapabilityUsed: provider === 'codex', existingUserChatsLoaded: false }))
  } catch (error) { reportFailure(`live-${provider}-native-helper-recovery`, error, { stage, toolCalls: events.filter((event) => event.update.sessionUpdate === 'tool_call').length, modelReportedUnavailable: host ? /unavailable|not available|don't have|do not have|cannot spawn/i.test(textOf(events, host.sessionId)) : undefined }) }
  finally {
    if (provider === 'codex' && host) {
      for (const id of nativeChildIds) { try { await host.request('session/delete', { sessionId: id }, 8000); childCleanup++ } catch {} }
      deleted = (await host.close()).deleted
    } else if (host) await host.close()
    if (query) await query.close()
    for (const child of children) {
      if (child.exitCode !== null || child.signalCode !== null) continue
      const exited = once(child, 'exit'); const timer = setTimeout(() => child.kill('SIGKILL'), 2000)
      child.kill('SIGTERM'); await exited.catch(() => {}); clearTimeout(timer)
    }
    if (sdk && sessionId) { try { await sdk.deleteSession(sessionId, { dir: cwd }); deleted = true } catch {} }
    console.log(JSON.stringify({ test: `${provider}-helper-recovery-owned-cleanup`, parentDeleted: deleted, nativeChildrenDeleted: provider === 'codex' ? childCleanup : undefined, nativeChildCount: provider === 'codex' ? nativeChildIds.size : undefined }))
    await rm(cwd, { recursive: true, force: true })
  }
}
const selected = process.argv.includes('--codex-only') ? ['codex'] : ['claude', 'codex']
for (const provider of selected) await probe(provider)
