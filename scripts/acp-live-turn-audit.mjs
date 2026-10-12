// Opt-in live diagnostic. Uses the existing provider login and a small amount
// of inference in new disposable sessions. Never loads an existing user chat.
// Claude exposes only Agent, which a host hook denies before a child can start.
// Codex receives a text-only instruction; all permission requests are cancelled.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

if (!process.argv[2] || !process.argv.includes('--live')) throw new Error('Usage: node scripts/acp-live-turn-audit.mjs <isolated npm install directory> --live')
const runtime = resolve(process.argv[2])
async function kill(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  const timer = setTimeout(() => child.kill('SIGKILL'), 2000)
  child.kill('SIGTERM')
  await exited.catch(() => {})
  clearTimeout(timer)
}

async function claude() {
  const dir = join(runtime, 'node_modules', '@agentclientprotocol', 'claude-agent-acp')
  assert.equal(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).version, '0.89.1')
  const { ClaudeAcpAgent } = await import(pathToFileURL(join(dir, 'dist', 'lib.js')).href)
  const cwd = await mkdtemp(join(tmpdir(), 'ramu-acp-live-claude-'))
  const children = []
  const kinds = new Map()
  let intercepted = 0
  let spawnedChildren = 0
  let text = ''
  const agent = new ClaudeAcpAgent({
    sessionUpdate: async ({ update }) => {
      kinds.set(update.sessionUpdate, (kinds.get(update.sessionUpdate) ?? 0) + 1)
      if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') text += update.content.text
      if (update.sessionUpdate === 'subagent_spawned') spawnedChildren++
    },
    extNotification: async () => {},
    requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
    createElicitation: async () => ({ action: 'cancel' }),
  }, { log() {}, error() {} })
  const timeout = setTimeout(() => { for (const child of children) child.kill('SIGKILL') }, 60000)
  try {
    await agent.initialize({ protocolVersion: 1, clientCapabilities: { subagents: {}, fs: { readTextFile: false, writeTextFile: false } } })
    const session = await agent.newSession({ cwd, mcpServers: [], _meta: { claudeCode: { options: {
      persistSession: false, settingSources: [], tools: ['Agent'], maxTurns: 3,
      hooks: { PreToolUse: [{ matcher: 'Agent|Task', hooks: [async () => {
        intercepted++
        return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'Audit routing rejected the native helper. Do not retry; reply ACP_AUDIT_DONE.' } }
      }] }] },
      spawnClaudeCodeProcess: (options) => {
        const child = spawn(options.command, options.args, { cwd: options.cwd, env: options.env, signal: options.signal, stdio: ['pipe', 'pipe', 'pipe'] })
        children.push(child)
        return child
      },
    } } } })
    const result = await agent.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: 'This is an integration audit in a disposable session. Call the Agent tool exactly once with subagent_type general-purpose and prompt "Reply ACP_AUDIT_CHILD". Our routing hook will deny it. After that denial, do not retry or call another tool; reply exactly ACP_AUDIT_DONE.' }] })
    assert.ok(intercepted > 0, 'Model did not exercise the routing hook')
    assert.equal(spawnedChildren, 0, 'Denied helper must not be announced as spawned')
    assert.ok(text.includes('ACP_AUDIT_DONE'), 'Missing final marker')
    assert.equal(result.stopReason, 'end_turn')
    console.log(JSON.stringify({ test: 'live-claude-routing', passed: true, hookInterceptions: intercepted, nativeChildSpawned: false, streamedFinalMarker: true, stopReason: result.stopReason, updateKinds: Object.fromEntries(kinds), existingChatsLoaded: false, persistentSession: false }))
  } finally {
    clearTimeout(timeout)
    await agent.dispose()
    await Promise.all(children.map(kill))
    await rm(cwd, { recursive: true, force: true })
  }
}

async function codex() {
  const dir = join(runtime, 'node_modules', '@agentclientprotocol', 'codex-acp')
  const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  assert.equal(manifest.version, '2.2.2')
  const cwd = await mkdtemp(join(tmpdir(), 'ramu-acp-live-codex-'))
  const child = spawn(process.execPath, [join(dir, Object.values(manifest.bin)[0])], { cwd, stdio: ['pipe', 'pipe', 'ignore'], env: process.env })
  const pending = new Map()
  const kinds = new Map()
  let nextId = 0
  let text = ''
  let sessionId
  let permissions = 0
  let toolCalls = 0
  const lines = createInterface({ input: child.stdout })
  child.stdin.on('error', () => {})
  const request = (method, params) => new Promise((resolveRequest, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Audit RPC timed out')) }, 60000)
    pending.set(id, { resolve: resolveRequest, reject, timer })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
  lines.on('line', (line) => {
    let message
    try { message = JSON.parse(line) } catch { return }
    const entry = pending.get(message.id)
    if (entry && !message.method) {
      pending.delete(message.id)
      clearTimeout(entry.timer)
      if (message.error) entry.reject(new Error('Audit RPC rejected'))
      else entry.resolve(message.result)
    } else if (message.id !== undefined && message.method) {
      permissions++
      const response = message.method === 'session/request_permission' ? { result: { outcome: { outcome: 'cancelled' } } } : { error: { code: -32601, message: 'Audit interactions disabled' } }
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, ...response }) + '\n')
    } else if (message.method === 'session/update') {
      const update = message.params.update
      kinds.set(update.sessionUpdate, (kinds.get(update.sessionUpdate) ?? 0) + 1)
      if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') text += update.content.text
      if (update.sessionUpdate === 'tool_call') toolCalls++
    }
  })
  const onExit = () => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Audit adapter exited')) }; pending.clear() }
  child.on('error', onExit)
  child.on('exit', onExit)
  try {
    await request('initialize', { protocolVersion: 1, clientInfo: { name: 'ramu-live-acp-audit', version: '0.0.1' }, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } })
    const session = await request('session/new', { cwd, mcpServers: [] })
    sessionId = session.sessionId
    await request('session/set_config_option', { sessionId, configId: 'mode', value: 'read-only' })
    const result = await request('session/prompt', { sessionId, prompt: [{ type: 'text', text: 'Integration audit: do not call tools, commands, MCP, or helpers. Reply exactly ACP_AUDIT_DONE.' }] })
    assert.ok(text.includes('ACP_AUDIT_DONE'), 'Missing final marker')
    assert.equal(result.stopReason, 'end_turn')
    assert.equal(toolCalls, 0)
    assert.equal(permissions, 0)
    console.log(JSON.stringify({ test: 'live-codex-streaming', passed: true, streamedFinalMarker: true, toolCalls, permissions, stopReason: result.stopReason, updateKinds: Object.fromEntries(kinds), existingChatsLoaded: false }))
  } finally {
    let deleted = false
    if (sessionId) {
      try { await request('session/close', { sessionId }); await request('session/delete', { sessionId }); deleted = true } catch {}
      console.log(JSON.stringify({ test: 'live-codex-owned-session-cleanup', deleted }))
    }
    await kill(child)
    lines.close()
    await rm(cwd, { recursive: true, force: true })
  }
}

for (const [name, run] of [['claude', claude], ['codex', codex]]) {
  try { await run() } catch {
    console.log(JSON.stringify({ test: `live-${name}`, passed: false, category: 'runtime-or-contract-failure' }))
    process.exitCode = 1
  }
}
