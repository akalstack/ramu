// Protocol audit without inference: no prompts, login, tools, or changes to existing sessions.
// Install adapters in a separate directory, then pass that directory as argv[2].
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { once } from 'node:events'

const runtimeDir = process.argv[2]
if (!runtimeDir) throw new Error('Usage: node scripts/acp-compatibility-smoke.mjs <isolated npm install directory>')
const cwd = await mkdtemp(join(tmpdir(), 'ramu-acp-probe-'))
const results = []

async function probe(name, negotiated) {
  const packageDir = resolve(runtimeDir, 'node_modules', '@agentclientprotocol', name)
  const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
  const child = spawn(process.execPath, [join(packageDir, Object.values(manifest.bin)[0])], {
    cwd, stdio: ['pipe', 'pipe', 'ignore'], env: process.env,
  })
  const pending = new Map()
  const updates = new Map()
  let nextId = 0
  child.stdin.on('error', () => {})
  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    let message
    try { message = JSON.parse(line) } catch { return }
    if (message.id !== undefined && !message.method) {
      const entry = pending.get(message.id)
      if (!entry) return
      pending.delete(message.id)
      clearTimeout(entry.timer)
      if (message.error) entry.reject(Object.assign(new Error('RPC rejected'), { code: message.error.code }))
      else entry.resolve(message.result)
    } else if (message.id !== undefined) {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'No tools or interactions during compatibility audit' } }) + '\n')
    } else if (message.method === 'session/update') {
      const kind = message.params?.update?.sessionUpdate
      updates.set(kind, (updates.get(kind) ?? 0) + 1)
    }
  })
  const rejectPending = () => {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Adapter exited')) }
    pending.clear()
  }
  child.on('error', rejectPending)
  child.on('exit', rejectPending)
  const request = (method, params) => new Promise((resolveRequest, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Request timed out')) }, 25_000)
    pending.set(id, { resolve: resolveRequest, reject, timer })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
  const row = { adapter: name, version: manifest.version, negotiated }
  try {
    const clientCapabilities = { fs: { readTextFile: false, writeTextFile: false }, terminal: false }
    if (negotiated) {
      clientCapabilities.subagents = {}
      clientCapabilities.elicitation = { form: {}, url: {} }
      clientCapabilities._meta = { terminal_output: true, terminal_output_delta: true }
    }
    const init = await request('initialize', { protocolVersion: 1, clientInfo: { name: 'ramu-acp-audit', version: '0.0.1' }, clientCapabilities })
    row.initialize = 'passed'
    row.protocolVersion = init.protocolVersion
    row.agentVersion = init.agentInfo?.version
    row.capabilities = init.agentCapabilities
    row.steering = init._meta?.steering?.supported === true
    row.authMethods = (init.authMethods ?? []).map((method) => method.id)
    if (negotiated) {
      const session = await request('session/new', { cwd, mcpServers: [] })
      row.newSession = 'passed'
      row.modes = (session.modes?.availableModes ?? []).map((mode) => mode.id)
      row.configOptions = (session.configOptions ?? []).map((option) => ({ id: option.id, category: option.category, type: option.type }))
      const mode = (session.configOptions ?? []).find((option) => option.category === 'mode')
      const readOnly = name === 'codex-acp' ? 'read-only' : 'plan'
      if (mode) {
        await request('session/set_config_option', { sessionId: session.sessionId, configId: mode.id, value: readOnly })
        row.readOnlyMode = 'passed'
      }
      try {
        await request('account/rateLimits/read', {})
        row.nativeRateLimitPassthrough = 'available'
      } catch (error) {
        row.nativeRateLimitPassthrough = error.code === -32601 ? 'method-not-found' : 'rejected'
      }
      await request('session/close', { sessionId: session.sessionId })
      row.closeSession = 'passed'
      // Delete only this audit's newly created empty session, if it was persisted.
      try { await request('session/delete', { sessionId: session.sessionId }); row.emptySessionCleanup = 'passed' }
      catch { row.emptySessionCleanup = 'not-deleted' }
    }
  } catch (error) {
    row.error = { stage: row.initialize ? 'session-setup' : 'initialize', code: error.code ?? null, category: error.message === 'Request timed out' ? 'timeout' : 'runtime-or-rpc-error' }
  } finally {
    row.updateKinds = Object.fromEntries(updates)
    child.stdin.end()
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      const timer = setTimeout(() => child.kill('SIGKILL'), 2_000)
      child.kill('SIGTERM')
      await exited.catch(() => {})
      clearTimeout(timer)
    }
    lines.close()
  }
  results.push(row)
  console.log(JSON.stringify(row))
}

try {
  for (const name of ['claude-agent-acp', 'codex-acp']) {
    await probe(name, false)
    await probe(name, true)
  }
} finally {
  await rm(cwd, { recursive: true, force: true })
}
if (results.some((row) => row.error)) process.exitCode = 1
