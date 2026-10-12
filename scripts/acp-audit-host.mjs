// Shared isolated diagnostic host. Never imported by Ramu's production code.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline'

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  const timer = setTimeout(() => child.kill('SIGKILL'), 2000)
  child.kill('SIGTERM'); await exited.catch(() => {}); clearTimeout(timer)
}

export async function auditHost(provider, runtime, cwd, { onUpdate = async () => {}, onRaw = async () => {}, onPermission = async () => ({ outcome: { outcome: 'cancelled' } }), onElicitation = async () => ({ action: 'cancel' }), options = {}, mcpServers = [], sessionId: savedId, legacySubagents = false, clientCapabilities = {}, additionalDirectories = [] } = {}) {
  const capabilities = { fs: { readTextFile: false, writeTextFile: false }, terminal: false, subagents: {}, elicitation: { form: {}, url: {} }, _meta: { terminal_output: true, terminal_output_delta: true } }
  if (legacySubagents) capabilities._meta.jetbrains = { air: { version: 1, capabilities: ['nativeSubagentSessions'] } }
  Object.assign(capabilities, clientCapabilities)
  const dir = join(runtime, 'node_modules', '@agentclientprotocol', provider === 'claude' ? 'claude-agent-acp' : 'codex-acp')
  const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
  assert.equal(manifest.version, provider === 'claude' ? '0.89.1' : '2.2.2')
  if (provider === 'claude') {
    const { ClaudeAcpAgent } = await import(pathToFileURL(join(dir, 'dist', 'lib.js')).href)
    const children = []
    const agent = new ClaudeAcpAgent({ sessionUpdate: onUpdate, extNotification: onRaw, requestPermission: onPermission, createElicitation: onElicitation, completeElicitation: async () => {} }, { log() {}, error() {} })
    const deadline = setTimeout(() => { for (const child of children) child.kill('SIGKILL') }, 120000)
    try {
      await agent.initialize({ protocolVersion: 1, clientCapabilities: capabilities })
      const params = { cwd, mcpServers, additionalDirectories, _meta: { claudeCode: { emitRawSDKMessages: true, options: { persistSession: false, settingSources: [], maxTurns: 5, ...options, spawnClaudeCodeProcess: (spawnOptions) => {
        const child = spawn(spawnOptions.command, spawnOptions.args, { cwd: spawnOptions.cwd, env: spawnOptions.env, signal: spawnOptions.signal, stdio: ['pipe', 'pipe', 'pipe'] }); children.push(child); return child
      } } } } }
      const response = savedId ? await agent.loadSession({ ...params, sessionId: savedId }) : await agent.newSession(params)
      const sessionId = savedId || response.sessionId
      return {
        sessionId, agent, response,
        prompt: (text) => agent.prompt({ sessionId, prompt: [{ type: 'text', text }] }),
        promptBlocks: (prompt) => agent.prompt({ sessionId, prompt }),
        steer: (text) => agent.steer({ sessionId, prompt: [{ type: 'text', text }], _meta: { steering: { idleBehavior: 'promptRequired' } } }),
        cancel: () => agent.cancel({ sessionId }),
        mode: (modeId) => agent.setSessionMode({ sessionId, modeId }),
        close: async () => { clearTimeout(deadline); await agent.dispose(); await Promise.all(children.map(stop)) },
      }
    } catch (error) {
      clearTimeout(deadline); await agent.dispose(); await Promise.all(children.map(stop)); throw error
    }
  }
  const child = spawn(process.execPath, [join(dir, Object.values(manifest.bin)[0])], { cwd, env: process.env, stdio: ['pipe', 'pipe', 'ignore'] })
  const pending = new Map()
  let nextId = 0
  let callbackError
  const request = (method, params, timeoutMs = 60000) => new Promise((resolveRequest, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Audit request timed out')) }, timeoutMs)
    pending.set(id, { resolve: resolveRequest, reject, timer })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
  const lines = createInterface({ input: child.stdout })
  child.stdin.on('error', () => {})
  lines.on('line', (line) => {
    let frame
    try { frame = JSON.parse(line) } catch { return }
    const entry = pending.get(frame.id)
    if (entry && !frame.method) {
      pending.delete(frame.id); clearTimeout(entry.timer)
      if (frame.error) entry.reject(new Error('Audit RPC rejected'))
      else entry.resolve(frame.result)
    } else if (frame.id !== undefined && frame.method) {
      const callback = frame.method === 'session/request_permission' ? onPermission : frame.method === 'elicitation/create' ? onElicitation : null
      Promise.resolve(callback ? callback(frame.params) : Promise.reject(new Error('Unsupported audit interaction'))).then(
        (result) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }) + '\n'),
        () => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: frame.id, error: { code: -32601, message: 'Audit interaction unavailable' } }) + '\n'),
      )
    } else if (frame.method === 'session/update') Promise.resolve(onUpdate(frame.params)).catch((error) => { callbackError = error })
  })
  const rejectAll = () => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('Audit process exited')) }; pending.clear() }
  child.on('error', rejectAll); child.on('exit', rejectAll)
  let sessionId
  try {
    await request('initialize', { protocolVersion: 1, clientInfo: { name: 'ramu-isolated-audit', version: '0.0.1' }, clientCapabilities: capabilities })
    const response = await request(savedId ? 'session/load' : 'session/new', { cwd, mcpServers, additionalDirectories, ...(savedId ? { sessionId: savedId } : {}) })
    sessionId = savedId || response.sessionId
    return {
      sessionId, response, request,
      prompt: async (text) => { const result = await request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }); if (callbackError) throw callbackError; return result },
      promptBlocks: async (prompt) => { const result = await request('session/prompt', { sessionId, prompt }); if (callbackError) throw callbackError; return result },
      steer: (text) => request('_session/steering', { sessionId, prompt: [{ type: 'text', text }] }),
      cancel: async () => { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } }) + '\n') },
      mode: (value) => request('session/set_config_option', { sessionId, configId: 'mode', value }),
      close: async ({ preserve = false } = {}) => {
        let deleted = false
        try {
          await request('session/close', { sessionId }, 8000)
          if (!preserve) { await request('session/delete', { sessionId }, 8000); deleted = true }
        } catch {} finally { await stop(child); lines.close() }
        return { deleted }
      },
    }
  } catch (error) { await stop(child); lines.close(); throw error }
}

export const textOf = (updates, sessionId) => updates.filter((event) => event.sessionId === sessionId && event.update.sessionUpdate === 'agent_message_chunk' && event.update.content?.type === 'text').map((event) => event.update.content.text).join('')
export function reportFailure(test, error, details = {}) {
  console.log(JSON.stringify({ test, passed: false, category: error.code === 'ERR_ASSERTION' ? 'contract-failure' : 'runtime-failure', failedCheck: error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : undefined, ...details }))
  process.exitCode = 1
}
