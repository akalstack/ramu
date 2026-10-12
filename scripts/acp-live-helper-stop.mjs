// Opt-in live audit: one disposable Claude parent and native background helper.
// The host stops the helper through the exact SDK Query owned by Claude ACP.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

if (!process.argv[2] || !process.argv.includes('--live')) throw new Error('Usage: node scripts/acp-live-helper-stop.mjs <isolated install directory> --live')
const dir = resolve(process.argv[2], 'node_modules', '@agentclientprotocol', 'claude-agent-acp')
assert.equal(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).version, '0.89.1')
const { ClaudeAcpAgent } = await import(pathToFileURL(join(dir, 'dist', 'lib.js')).href)
const cwd = await mkdtemp(join(tmpdir(), 'ramu-acp-helper-stop-'))
const children = []
let parentId
let nativeTaskId
let stopAcknowledged = false
let childId
let terminalState
let parentText = ''
let backgrounded = false
let initialStopReason
let followupStopReason
const agent = new ClaudeAcpAgent({
  sessionUpdate: async ({ sessionId, update }) => {
    if (update.sessionUpdate === 'subagent_spawned') childId = update.subagentSessionId
    if (update.sessionUpdate === 'subagent_state_update') terminalState = update.state
    if (sessionId === parentId && update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') parentText += update.content.text
  },
  extNotification: async (method, payload) => {
    const message = payload.message
    if (method !== '_claude/sdkMessage' || message?.subtype !== 'task_started' || !message.subagent_type || nativeTaskId) return
    nativeTaskId = message.task_id
    backgrounded = message.is_backgrounded === true
    await agent.sessions[parentId].query.stopTask(nativeTaskId)
    stopAcknowledged = true
  },
  requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
}, { log() {}, error() {} })
const timeout = setTimeout(() => { for (const child of children) child.kill('SIGKILL') }, 60000)
try {
  await agent.initialize({ protocolVersion: 1, clientCapabilities: { subagents: {}, fs: { readTextFile: false, writeTextFile: false } } })
  const session = await agent.newSession({ cwd, mcpServers: [], _meta: { claudeCode: {
    emitRawSDKMessages: [{ type: 'system', subtype: 'task_started' }],
    options: {
      persistSession: false, settingSources: [], tools: ['Agent'], maxTurns: 3,
      permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true,
      hooks: { PreToolUse: [{ hooks: [async (input) => input.tool_name === 'Agent' || input.tool_name === 'Task' ? {} : { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Audit permits only the native helper call' } }] }] },
      spawnClaudeCodeProcess: (options) => {
        const child = spawn(options.command, options.args, { cwd: options.cwd, env: options.env, signal: options.signal, stdio: ['pipe', 'pipe', 'pipe'] })
        children.push(child)
        return child
      },
    },
  } } })
  parentId = session.sessionId
  const result = await agent.prompt({ sessionId: parentId, prompt: [{ type: 'text', text: 'Integration audit. Call Agent exactly once with subagent_type general-purpose, run_in_background=true, and prompt "Without tools, write a detailed 5000-word essay about arithmetic." The host will immediately stop that helper. Do not retry or wait using another tool. After the stop notification, reply exactly ACP_PARENT_ALIVE.' }] })
  initialStopReason = result.stopReason
  assert.ok(nativeTaskId, 'Native task start missing')
  assert.equal(stopAcknowledged, true, 'Native stop not acknowledged')
  assert.ok(childId, 'ACP child announcement missing')
  assert.equal(terminalState, 'cancelled', 'ACP child did not reach cancelled')
  assert.equal(result.stopReason, 'end_turn', 'Parent unexpectedly cancelled')
  // A background helper notification need not make the model echo a marker
  // in its first response. Explicitly prompt the SAME parent Query afterwards.
  parentText = ''
  const followup = await agent.prompt({ sessionId: parentId, prompt: [{ type: 'text', text: 'The helper stop test is complete. Do not call any tools. Reply exactly ACP_PARENT_ALIVE.' }] })
  followupStopReason = followup.stopReason
  assert.equal(followupStopReason, 'end_turn')
  assert.ok(parentText.includes('ACP_PARENT_ALIVE'), 'Parent did not continue')
  console.log(JSON.stringify({ test: 'live-claude-native-helper-stop', passed: true, stopAcknowledged, backgrounded, childAnnounced: true, childTerminalState: terminalState, parentContinued: true, parentStopReason: initialStopReason, followupStopReason, persistentSession: false, existingChatsLoaded: false }))
} catch (error) {
  console.log(JSON.stringify({ test: 'live-claude-native-helper-stop', passed: false, taskStarted: !!nativeTaskId, stopAcknowledged, backgrounded, childAnnounced: !!childId, childTerminalState: terminalState ?? null, parentMarker: parentText.includes('ACP_PARENT_ALIVE'), initialStopReason, followupStopReason, failedCheck: error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : undefined, category: error.code === 'ERR_ASSERTION' ? 'contract-failure' : 'runtime-failure' }))
  process.exitCode = 1
} finally {
  clearTimeout(timeout)
  await agent.dispose()
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    const exited = once(child, 'exit')
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000)
    child.kill('SIGTERM')
    await exited.catch(() => {})
    clearTimeout(timer)
  }
  await rm(cwd, { recursive: true, force: true })
}
