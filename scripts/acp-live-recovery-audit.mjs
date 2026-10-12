// Opt-in live verification of direct-native -> ACP recovery using only new audit chats.
// Prints booleans/counts, never transcript content, credentials, or session IDs.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'

if (!process.argv[2] || !process.argv.includes('--live')) throw new Error('Usage: node scripts/acp-live-recovery-audit.mjs <isolated install directory> --live')
const runtime = resolve(process.argv[2])
let stage = 'setup'
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  const timer = setTimeout(() => child.kill('SIGKILL'), 2000)
  child.kill('SIGTERM')
  await exited.catch(() => {})
  clearTimeout(timer)
}
function spawnSdk(children) {
  return (options) => {
    const child = spawn(options.command, options.args, { cwd: options.cwd, env: options.env, signal: options.signal, stdio: ['pipe', 'pipe', 'pipe'] })
    children.push(child)
    return child
  }
}
function messageRows(updates) {
  return updates.filter((u) => ['user_message_chunk', 'agent_message_chunk'].includes(u.sessionUpdate) && u.content?.type === 'text').map((u) => ({ kind: u.sessionUpdate, id: u.messageId, text: u.content.text }))
}
function assistantText(updates) {
  return messageRows(updates).filter((row) => row.kind === 'agent_message_chunk').map((row) => row.text).join('')
}
function stableReplay(first, second) {
  assert.ok(first.length >= 2, 'Replay must contain user and assistant')
  assert.ok(first.every((row) => typeof row.id === 'string' && row.id.length > 0), 'Replay IDs missing')
  assert.deepEqual(second, first, 'Replay changed after restart')
}

async function claude() {
  const cwd = await mkdtemp(join(tmpdir(), 'ramu-native-acp-recovery-'))
  const sdk = await import(pathToFileURL(join(runtime, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'sdk.mjs')).href)
  const dir = join(runtime, 'node_modules', '@agentclientprotocol', 'claude-agent-acp')
  assert.equal(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).version, '0.89.1')
  const { ClaudeAcpAgent } = await import(pathToFileURL(join(dir, 'dist', 'lib.js')).href)
  const children = []
  let sessionId
  let nativeQuery
  let agent
  let replay
  let output = []
  let deleted = false
  const token = `ACP_RECOVERY_${randomUUID().replaceAll('-', '')}`
  const options = { cwd, tools: [], settingSources: [], maxTurns: 1, permissionMode: 'default', canUseTool: async () => ({ behavior: 'deny', message: 'Tool-free audit' }), spawnClaudeCodeProcess: spawnSdk(children), pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_EXECUTABLE }
  const timeout = setTimeout(() => { for (const child of children) child.kill('SIGKILL') }, 90000)
  async function host() {
    output = []
    agent = new ClaudeAcpAgent({ sessionUpdate: async ({ update }) => output.push(update), extNotification: async () => {}, requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }) }, { log() {}, error() {} })
    await agent.initialize({ protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, subagents: {} } })
    await agent.loadSession({ sessionId, cwd, mcpServers: [], _meta: { claudeCode: { options: { ...options, cwd: undefined } } } })
  }
  try {
    nativeQuery = sdk.query({ prompt: `Remember this audit token: ${token}. Reply exactly ${token}. Do not use tools.`, options })
    for await (const message of nativeQuery) {
      if (message.session_id) sessionId = message.session_id
      if (message.type === 'result') { assert.equal(message.subtype, 'success'); break }
    }
    await nativeQuery.close()
    assert.ok(sessionId)
    stage = 'claude-first-load'
    await host()
    replay = messageRows(output)
    assert.ok(replay.some((row) => row.kind === 'agent_message_chunk' && row.text.includes(token)))
    await agent.dispose()
    stage = 'claude-second-load'
    await host()
    stableReplay(replay, messageRows(output))
    output = []
    stage = 'claude-continuation'
    const result = await agent.prompt({ sessionId, prompt: [{ type: 'text', text: 'Reply only with the audit token I gave earlier. No tools.' }] })
    assert.equal(result.stopReason, 'end_turn')
    assert.ok(assistantText(output).includes(token), 'Continuation did not remember audit token')
    await agent.dispose()
    stage = 'claude-third-load'
    await host()
    const finalReplay = messageRows(output)
    assert.ok(finalReplay.length > replay.length)
    assert.deepEqual(finalReplay.slice(0, replay.length), replay)
    console.log(JSON.stringify({ test: 'live-claude-native-to-acp-recovery', passed: true, directNativeSessionLoaded: true, replayRows: replay.length, repeatedBootStableIds: true, continuedWithRememberedContext: true, earlierRowsStableAfterContinuation: true, existingUserChatsLoaded: false }))
  } finally {
    clearTimeout(timeout)
    if (agent) await agent.dispose()
    if (nativeQuery) await nativeQuery.close()
    await Promise.all(children.map(stop))
    if (sessionId) { try { await sdk.deleteSession(sessionId, { dir: cwd }); deleted = true } catch {} }
    console.log(JSON.stringify({ test: 'claude-recovery-owned-session-cleanup', deleted }))
    await rm(cwd, { recursive: true, force: true })
  }
}

function rpcProcess(command, args, cwd, onNotification = () => {}) {
  const child = spawn(command, args, { cwd, env: process.env, stdio: ['pipe', 'pipe', 'ignore'] })
  const pending = new Map()
  let nextId = 0
  child.stdin.on('error', () => {})
  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    let frame
    try { frame = JSON.parse(line) } catch { return }
    const entry = pending.get(frame.id)
    if (entry && !frame.method) {
      pending.delete(frame.id); clearTimeout(entry.timer)
      if (frame.error) entry.reject(new Error('Audit RPC rejected'))
      else entry.resolve(frame.result)
    } else if (frame.id !== undefined) {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: frame.id, error: { code: -32601, message: 'Audit interactions disabled' } }) + '\n')
    } else onNotification(frame)
  })
  const rejectAll = () => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Audit process exited')) }; pending.clear() }
  child.on('error', rejectAll); child.on('exit', rejectAll)
  return {
    request: (method, params) => new Promise((resolveRequest, reject) => {
      const id = ++nextId
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Audit RPC timed out')) }, 60000)
      pending.set(id, { resolve: resolveRequest, reject, timer })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    }),
    close: async () => { await stop(child); lines.close() },
  }
}

async function codex() {
  const cwd = await mkdtemp(join(tmpdir(), 'ramu-codex-acp-recovery-'))
  const dir = join(runtime, 'node_modules', '@agentclientprotocol', 'codex-acp')
  const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  assert.equal(manifest.version, '2.2.2')
  const token = `ACP_RECOVERY_${randomUUID().replaceAll('-', '')}`
  let sessionId
  let processRpc
  let output = []
  let deleted = false
  async function host() {
    output = []
    processRpc = rpcProcess(process.execPath, [join(dir, Object.values(manifest.bin)[0])], cwd, (frame) => { if (frame.method === 'session/update') output.push(frame.params.update) })
    await processRpc.request('initialize', { protocolVersion: 1, clientInfo: { name: 'ramu-recovery-audit', version: '0.0.1' }, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, subagents: {} } })
    await processRpc.request('session/load', { sessionId, cwd, mcpServers: [] })
    await processRpc.request('session/set_config_option', { sessionId, configId: 'mode', value: 'read-only' })
  }
  try {
    let completed
    const completion = new Promise((resolveCompleted) => { completed = resolveCompleted })
    processRpc = rpcProcess(process.env.CODEX_PATH || 'codex', ['app-server', '--stdio'], cwd, (frame) => { if (frame.method === 'turn/completed') completed(frame.params) })
    await processRpc.request('initialize', { clientInfo: { name: 'ramu-native-recovery-audit', version: '0.0.1' }, capabilities: { experimentalApi: true } })
    const started = await processRpc.request('thread/start', { cwd, approvalPolicy: 'never', sandbox: 'read-only' })
    sessionId = started.thread.id
    await processRpc.request('turn/start', { threadId: sessionId, approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly' }, input: [{ type: 'text', text: `Remember this audit token: ${token}. Reply exactly ${token}. Do not use tools.`, text_elements: [] }] })
    const timer = setTimeout(() => completed(null), 60000)
    const done = await completion
    clearTimeout(timer)
    assert.equal(done?.turn.status, 'completed')
    await processRpc.close()
    stage = 'codex-first-load'
    await host()
    const replay = messageRows(output)
    assert.ok(replay.some((row) => row.kind === 'agent_message_chunk' && row.text.includes(token)))
    await processRpc.request('session/close', { sessionId }); await processRpc.close()
    stage = 'codex-second-load'
    await host()
    stableReplay(replay, messageRows(output))
    output = []
    stage = 'codex-continuation'
    const result = await processRpc.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'Reply only with the audit token I gave earlier. No tools.' }] })
    assert.equal(result.stopReason, 'end_turn')
    assert.ok(assistantText(output).includes(token), 'Continuation did not remember audit token')
    await processRpc.request('session/close', { sessionId }); await processRpc.close()
    stage = 'codex-third-load'
    await host()
    const finalReplay = messageRows(output)
    assert.ok(finalReplay.length > replay.length)
    assert.deepEqual(finalReplay.slice(0, replay.length), replay)
    console.log(JSON.stringify({ test: 'live-codex-native-to-acp-recovery', passed: true, directNativeSessionLoaded: true, replayRows: replay.length, repeatedBootStableIds: true, continuedWithRememberedContext: true, earlierRowsStableAfterContinuation: true, existingUserChatsLoaded: false }))
  } finally {
    if (processRpc) {
      if (sessionId) { try { await processRpc.request('session/close', { sessionId }); await processRpc.request('session/delete', { sessionId }); deleted = true } catch {} }
      await processRpc.close()
    }
    console.log(JSON.stringify({ test: 'codex-recovery-owned-session-cleanup', deleted }))
    await rm(cwd, { recursive: true, force: true })
  }
}

for (const [name, run] of [['claude', claude], ['codex', codex]]) {
  try { await run() } catch (error) {
    console.log(JSON.stringify({ test: `live-${name}-recovery`, passed: false, stage, failedCheck: error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : undefined, category: error.code === 'ERR_ASSERTION' ? 'contract-failure' : 'runtime-failure' }))
    process.exitCode = 1
  }
}
