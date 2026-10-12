// Diagnostic only. No prompts, login, tools, existing chats, or Ramu provider changes.
// Requires the isolated adapter installation used by acp-compatibility-smoke.mjs.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'

if (!process.argv[2]) throw new Error('Usage: node scripts/acp-hybrid-feasibility.mjs <isolated npm install directory>')
const runtimeDir = resolve(process.argv[2])

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.stdin.end()
  child.kill('SIGTERM')
  const timer = setTimeout(() => child.kill('SIGKILL'), 2000)
  await exited.catch(() => {})
  clearTimeout(timer)
}

async function claudeLibraryProbe() {
  const packageDir = join(runtimeDir, 'node_modules', '@agentclientprotocol', 'claude-agent-acp')
  const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
  assert.equal(manifest.version, '0.89.1', 'Re-audit this probe against a different adapter release')
  const { ClaudeAcpAgent } = await import(pathToFileURL(join(packageDir, 'dist', 'lib.js')).href)
  const cwd = await mkdtemp(join(tmpdir(), 'ramu-claude-library-audit-'))
  const children = []
  let hookRegistered = false
  const callback = async () => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'audit' } })
  const noop = async () => {}
  const client = {
    sessionUpdate: noop, extNotification: noop, completeElicitation: noop,
    requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
    createElicitation: async () => ({ action: 'cancel' }),
    readTextFile: async () => { throw new Error('Disabled during audit') },
    writeTextFile: async () => { throw new Error('Disabled during audit') },
  }
  const agent = new ClaudeAcpAgent(client, { log() {}, error() {} })
  const sdkOptions = {
    persistSession: false, tools: [],
    hooks: { PreToolUse: [{ matcher: 'Agent|Task', hooks: [callback] }] },
    spawnClaudeCodeProcess: (options) => {
      const child = spawn(options.command, options.args, { cwd: options.cwd, env: options.env, signal: options.signal, stdio: ['pipe', 'pipe', 'pipe'] })
      children.push(child)
      const original = child.stdin.write.bind(child.stdin)
      let pending = ''
      // Observe only whether our callback was registered; never print native wire data.
      child.stdin.write = (chunk, ...args) => {
        pending += chunk.toString()
        let boundary
        while ((boundary = pending.indexOf('\n')) !== -1) {
          const line = pending.slice(0, boundary)
          pending = pending.slice(boundary + 1)
          try {
            const frame = JSON.parse(line)
            if (frame.type === 'control_request' && frame.request?.subtype === 'initialize') {
              hookRegistered = (frame.request.hooks?.PreToolUse ?? []).some((hook) => hook.matcher === 'Agent|Task' && (hook.hookCallbackIds ?? []).length > 0)
            }
          } catch {}
        }
        return original(chunk, ...args)
      }
      return child
    },
  }
  const timer = setTimeout(() => { for (const child of children) child.kill('SIGKILL') }, 30000)
  try {
    await agent.initialize({ protocolVersion: 1, clientInfo: { name: 'ramu-library-audit', version: '0.0.1' }, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false, subagents: {} } })
    const response = await agent.newSession({ cwd, mcpServers: [], _meta: { claudeCode: { options: sdkOptions } } })
    const session = agent.sessions[response.sessionId]
    assert.ok(session.query)
    assert.equal(session.creationParams._meta.claudeCode.options.hooks.PreToolUse[0].hooks[0], callback)
    assert.equal(hookRegistered, true)
    assert.equal(typeof session.query.stopTask, 'function')
    assert.equal(typeof session.query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET, 'function')
    console.log(JSON.stringify({ test: 'claude-acp-library-host', adapterVersion: manifest.version, newSession: true, hostRetainsSameQuery: true, hostCallbackRetained: true, callbackRegisteredWithNativeCLI: true, queryStopTaskAvailable: true, queryUsageAvailable: true, inferenceRequests: 0 }))
  } finally {
    try { await agent.dispose() } finally {
      await Promise.all(children.map(stopChild))
      clearTimeout(timer)
      await rm(cwd, { recursive: true, force: true })
    }
  }
}

async function codexProcessProbe() {
  const cwd = await mkdtemp(join(tmpdir(), 'ramu-acp-process-audit-'))
  const servers = []
  function server() {
    const child = spawn(process.env.CODEX_PATH || 'codex', ['app-server', '--stdio'], { cwd, env: { ...process.env, CODEX_HOME: cwd }, stdio: ['pipe', 'pipe', 'ignore'] })
    const pending = new Map()
    let nextId = 0
    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => {
      let message
      try { message = JSON.parse(line) } catch { return }
      const entry = pending.get(message.id)
      if (entry && !message.method) {
        pending.delete(message.id)
        clearTimeout(entry.timer)
        if (message.error) entry.reject(new Error('Native RPC rejected'))
        else entry.resolve(message.result)
      }
    })
    child.stdin.on('error', () => {})
    const rejectPending = () => {
      for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Native process exited')) }
      pending.clear()
    }
    child.on('error', rejectPending)
    child.on('exit', rejectPending)
    const rpc = (method, params) => new Promise((resolveRequest, reject) => {
      const id = ++nextId
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Native RPC timed out')) }, 10000)
      pending.set(id, { resolve: resolveRequest, reject, timer })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
    const close = async () => { await stopChild(child); lines.close() }
    const result = { rpc, close }
    servers.push(result)
    return result
  }
  try {
    const owner = server()
    const observer = server()
    for (const item of [owner, observer]) await item.rpc('initialize', { clientInfo: { name: 'ramu-process-audit', version: '0.0.1' }, capabilities: { experimentalApi: true } })
    const started = await owner.rpc('thread/start', { cwd, approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true })
    const ownThreads = await owner.rpc('thread/loaded/list', {})
    const otherThreads = await observer.rpc('thread/loaded/list', {})
    assert.equal(ownThreads.data.includes(started.thread.id), true)
    assert.equal(otherThreads.data.includes(started.thread.id), false)
    console.log(JSON.stringify({ test: 'separate-app-server-processes', sharedCodexHome: true, createdEphemeralThread: true, ownerSeesThread: true, secondProcessSeesThread: false, inferenceRequests: 0 }))
    // Check the real native server accepts the policies missing from stock ACP
    // presets. This creates only additional ephemeral, empty audit threads.
    for (const [approvalPolicy, sandbox] of [['untrusted', 'workspace-write'], ['never', 'read-only'], ['on-request', 'workspace-write']]) {
      const configured = await owner.rpc('thread/start', { cwd, approvalPolicy, sandbox, ephemeral: true })
      assert.equal(configured.approvalPolicy, approvalPolicy)
      const expectedType = sandbox === 'read-only' ? 'readOnly' : 'workspaceWrite'
      assert.equal(configured.sandbox.type, expectedType)
    }
    console.log(JSON.stringify({ test: 'native-codex-policy-acceptance', realAppServer: true, editsUntrustedAccepted: true, analysisNeverReadOnlyAccepted: true, autoUserApprovalAccepted: true, inferenceRequests: 0 }))
  } finally {
    await Promise.all(servers.map((item) => item.close()))
    await rm(cwd, { recursive: true, force: true })
  }
}

await claudeLibraryProbe()
await codexProcessProbe()
