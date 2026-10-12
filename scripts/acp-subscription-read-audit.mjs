// Read-only account-window diagnostic: owning Claude ACP Query + independent
// native Codex app-server. No prompts or inference. No account values printed.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
if (!process.argv[2]) throw new Error('Usage: node scripts/acp-subscription-read-audit.mjs <isolated install directory>')
const runtime = resolve(process.argv[2])
const cwd = await mkdtemp(join(tmpdir(), 'ramu-acp-subscription-'))
const children = []
let agent
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  const timer = setTimeout(() => child.kill('SIGKILL'), 2000)
  child.kill('SIGTERM'); await exited.catch(() => {}); clearTimeout(timer)
}
const deadline = setTimeout(() => { for (const child of children) child.kill('SIGKILL') }, 30000)
try {
  const dir = join(runtime, 'node_modules', '@agentclientprotocol', 'claude-agent-acp')
  assert.equal(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).version, '0.89.1')
  const { ClaudeAcpAgent } = await import(pathToFileURL(join(dir, 'dist', 'lib.js')).href)
  agent = new ClaudeAcpAgent({ sessionUpdate: async () => {}, extNotification: async () => {}, requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }) }, { log() {}, error() {} })
  await agent.initialize({ protocolVersion: 1, clientCapabilities: {} })
  const session = await agent.newSession({ cwd, mcpServers: [], _meta: { claudeCode: { options: { persistSession: false, tools: [], settingSources: [], spawnClaudeCodeProcess: (options) => {
    const child = spawn(options.command, options.args, { cwd: options.cwd, env: options.env, signal: options.signal, stdio: ['pipe', 'pipe', 'pipe'] }); children.push(child); return child
  } } } } })
  const usage = await agent.sessions[session.sessionId].query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })
  for (const name of ['five_hour', 'seven_day']) {
    const window = usage.rate_limits?.[name]
    assert.ok(window && typeof window.utilization === 'number')
    assert.ok(window.utilization >= 0 && window.utilization <= 100)
    assert.ok(Number.isFinite(Date.parse(window.resets_at)))
  }
  console.log(JSON.stringify({ test: 'claude-owning-query-subscription-read', passed: true, fiveHourAndWeeklyStructured: true, validPercentagesAndResetTimes: true, inferenceRequests: 0 }))
  await agent.dispose(); agent = undefined

  const child = spawn(process.env.CODEX_PATH || 'codex', ['app-server', '--stdio'], { cwd, env: process.env, stdio: ['pipe', 'pipe', 'ignore'] })
  children.push(child)
  let nextId = 0
  const pending = new Map()
  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    let frame
    try { frame = JSON.parse(line) } catch { return }
    const entry = pending.get(frame.id)
    if (!entry || frame.method) return
    pending.delete(frame.id); clearTimeout(entry.timer)
    if (frame.error) entry.reject(new Error('Usage RPC rejected'))
    else entry.resolve(frame.result)
  })
  const request = (method, params) => new Promise((resolveRequest, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Usage RPC timed out')) }, 10000)
    pending.set(id, { resolve: resolveRequest, reject, timer })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
  await request('initialize', { clientInfo: { name: 'ramu-usage-audit', version: '0.0.1' } })
  const response = await request('account/rateLimits/read', {})
  for (const name of ['primary', 'secondary']) {
    const window = response.rateLimits?.[name]
    assert.ok(window && typeof window.usedPercent === 'number')
    assert.ok(window.usedPercent >= 0 && window.usedPercent <= 100)
    assert.ok(typeof window.resetsAt === 'number' && window.resetsAt > 0)
    assert.ok(typeof window.windowDurationMins === 'number' && window.windowDurationMins > 0)
  }
  console.log(JSON.stringify({ test: 'independent-codex-subscription-read', passed: true, primaryAndSecondaryStructured: true, validPercentagesWindowsAndResetTimes: true, inferenceRequests: 0, userThreadsLoaded: false }))
  await stop(child); lines.close()
} finally {
  clearTimeout(deadline)
  if (agent) await agent.dispose()
  await Promise.all(children.map(stop))
  await rm(cwd, { recursive: true, force: true })
}
