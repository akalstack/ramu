// Diagnostic only: real Claude ACP library/SDK with a synthetic native subprocess.
// No executable, account, prompts, tools, or inference are used.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

if (!process.argv[2]) throw new Error('Usage: node scripts/acp-claude-host-contracts.mjs <isolated npm install directory>')
const packageDir = resolve(process.argv[2], 'node_modules', '@agentclientprotocol', 'claude-agent-acp')
assert.equal(JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8')).version, '0.89.1')
const { ClaudeAcpAgent } = await import(pathToFileURL(join(packageDir, 'dist', 'lib.js')).href)
const cwd = await mkdtemp(join(tmpdir(), 'ramu-claude-host-contract-'))
const requests = []
const responses = new Map()
const children = []
let hookId
let callbackCalls = 0
let denyRouting = true
let ignoredCanUseToolCalls = 0
let rejectFlagSettings = false
const routing = async (input) => {
    assert.equal(input.tool_name, 'Agent')
    callbackCalls++
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: denyRouting ? 'deny' : 'allow', permissionDecisionReason: 'synthetic routing test' } }
}

function fakeNative() {
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.exitCode = null
    child.signalCode = null
    const emit = (message) => child.stdout.write(JSON.stringify(message) + '\n')
    let pending = ''
    child.stdin = new Writable({
        write(chunk, encoding, done) {
            pending += chunk.toString()
            let end
            while ((end = pending.indexOf('\n')) !== -1) {
                const frame = JSON.parse(pending.slice(0, end))
                pending = pending.slice(end + 1)
                if (frame.type === 'user') throw new Error('Inference forbidden in this probe')
                if (frame.type === 'control_response') {
                    const waiter = responses.get(frame.response.request_id)
                    if (waiter) { responses.delete(frame.response.request_id); waiter(frame.response) }
                }
                if (frame.type !== 'control_request') continue
                requests.push({ child, request: frame.request })
                let response = {}
                if (frame.request.subtype === 'initialize') {
                    hookId = frame.request.hooks.PreToolUse.find((hook) => hook.matcher === 'Agent|Task').hookCallbackIds[0]
                    response = { commands: [], models: ['audit-model', 'audit-model-2'].map(value => ({ value, displayName: value, description: '', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high'], supportsFastMode: true })), agents: [], account: null }
                }
                if (frame.request.subtype === 'get_context_usage') response = { used_tokens: 42, context_window: 1000 }
                if (frame.request.subtype === 'get_usage') response = { rate_limits: { five_hour: { utilization: 95, resets_at: '2030-03-17T17:46:40Z' }, seven_day: { utilization: 30, resets_at: '2030-03-24T17:46:40Z' } } }
                queueMicrotask(() => emit({
                    type: 'control_response', response: rejectFlagSettings && frame.request.subtype === 'apply_flag_settings'
                        ? { subtype: 'error', request_id: frame.request_id, error: 'Synthetic rejected settings' }
                        : { subtype: 'success', request_id: frame.request_id, response }
                }))
            }
            done()
        }
    })
    child.kill = () => {
        if (child.exitCode !== null) return true
        child.exitCode = 0
        child.stdout.end()
        child.stderr.end()
        queueMicrotask(() => child.emit('exit', 0, null))
        return true
    }
    child.sendControl = (request) => {
        const requestId = `audit-${responses.size}-${callbackCalls}-${requests.length}`
        return new Promise((resolveResponse, reject) => {
            const timer = setTimeout(() => { responses.delete(requestId); reject(new Error('Synthetic SDK callback timed out')) }, 5000)
            responses.set(requestId, (response) => { clearTimeout(timer); resolveResponse(response) })
            emit({ type: 'control_request', request_id: requestId, request })
        })
    }
    children.push(child)
    return child
}

const agent = new ClaudeAcpAgent({ sessionUpdate: async () => { }, extNotification: async () => { }, requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }) }, { log() { }, error() { } })
const timeout = setTimeout(() => { for (const child of children) child.kill() }, 20000)
try {
    await agent.initialize({ protocolVersion: 1, clientCapabilities: { subagents: {}, session: { configOptions: { boolean: {} } }, fs: { readTextFile: false, writeTextFile: false } } })
    const created = await agent.newSession({
        cwd, mcpServers: [], _meta: {
            claudeCode: {
                options: {
                    persistSession: false, tools: [], settingSources: [], model: 'audit-model',
                    hooks: { PreToolUse: [{ matcher: 'Agent|Task', hooks: [routing] }] },
                    canUseTool: async () => { ignoredCanUseToolCalls++; return { behavior: 'allow', updatedInput: {} } },
                    spawnClaudeCodeProcess: fakeNative,
                }
            }
        }
    })
    assert.equal(children.length, 1)
    const child = children[0]
    const session = agent.sessions[created.sessionId]
    const select = (configId, value) => agent.setSessionConfigOption({ sessionId: created.sessionId, configId, value })
    await select('model', 'audit-model-2')
    assert.equal(requests.find(entry => entry.request.subtype === 'set_model').request.model, 'audit-model-2')
    assert.equal(session.models.currentModelId, 'audit-model-2')
    await select('effort', 'high')
    assert.equal(requests.filter(entry => entry.request.subtype === 'apply_flag_settings').at(-1).request.settings.effortLevel, 'high')
    assert.equal(session.effortPinnedLevel, 'high')
    rejectFlagSettings = true
    await assert.rejects(() => select('effort', 'low'), /Synthetic rejected settings/)
    assert.equal(session.configOptions.find(option => option.id === 'effort').currentValue, 'high')
    assert.equal(session.effortPinnedLevel, 'high')
    rejectFlagSettings = false
    await select('effort', 'default')
    assert.equal(requests.filter(entry => entry.request.subtype === 'apply_flag_settings').at(-1).request.settings.effortLevel, null)
    assert.equal(session.effortPinnedLevel, undefined)
    await select('fast', true)
    assert.equal(requests.filter(entry => entry.request.subtype === 'apply_flag_settings').at(-1).request.settings.fastMode, true)
    assert.equal(session.fastModeEnabled, true)
    rejectFlagSettings = true
    await assert.rejects(() => select('fast', false), /Synthetic rejected settings/)
    assert.equal(session.fastModeEnabled, true)
    rejectFlagSettings = false
    await select('fast', false)
    assert.equal(session.fastModeEnabled, false)
    await assert.rejects(() => select('effort', 'invalid'))
    console.log(JSON.stringify({ test: 'claude-model-effort-fast-controls', transport: 'synthetic-native-process', inferenceRequests: 0, modelControlRoundTrip: true, effortControlRoundTrip: true, defaultEffortClearsNativeFlag: true, booleanFastControlRoundTrip: true, rejectedControlsPreserveDisplayedState: true, invalidEffortRejected: true }))
    const hookRequest = { subtype: 'hook_callback', callback_id: hookId, tool_use_id: 'tool', input: { hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_input: {}, session_id: created.sessionId, cwd } }
    assert.equal((await child.sendControl(hookRequest)).response.hookSpecificOutput.permissionDecision, 'deny')
    denyRouting = false
    assert.equal((await child.sendControl(hookRequest)).response.hookSpecificOutput.permissionDecision, 'allow')
    assert.equal(callbackCalls, 2)
    await session.query.stopTask('native-task')
    const stopped = requests.find((entry) => entry.request.subtype === 'stop_task')
    assert.equal(stopped.child, child)
    assert.equal(stopped.request.task_id, 'native-task')
    const usage = await session.query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })
    assert.equal(usage.rate_limits.five_hour.utilization, 95)
    assert.equal(usage.rate_limits.seven_day.utilization, 30)
    const usageRequest = requests.find((entry) => entry.request.subtype === 'get_usage')
    assert.equal(usageRequest.child, child)
    assert.equal(usageRequest.request.skip_behaviors, true)
    // Verify ACP's own permission callback wins over the injected SDK callback.
    // Bypass the unrelated tool-row publication and presentation path by using
    // a nonexistent session: the adapter must deny it without invoking our callback.
    const original = agent.sessions[created.sessionId]
    delete agent.sessions[created.sessionId]
    try {
        const permission = await child.sendControl({ subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'audit-only' }, tool_use_id: 'tool-2' })
        assert.equal(permission.response.behavior, 'deny')
        assert.equal(ignoredCanUseToolCalls, 0)
    } finally { agent.sessions[created.sessionId] = original }
    console.log(JSON.stringify({ test: 'claude-owning-query-controls', transport: 'synthetic-native-process', inferenceRequests: 0, dynamicHookRoundTrip: true, sameQueryStopTaskWireRequest: true, sameQueryStructuredUsage: true, skipBehaviorsPreserved: true, injectedCanUseToolOverridden: true, realHelperStopped: false }))
} finally {
    clearTimeout(timeout)
    await agent.dispose()
    for (const child of children) child.kill()
    await rm(cwd, { recursive: true, force: true })
}
