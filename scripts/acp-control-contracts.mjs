// Diagnostic only: published adapter code, synthetic native transport, no CLI or inference.
// These contracts do not implement or install a Ramu migration.
import assert from 'node:assert/strict'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

if (!process.argv[2]) throw new Error('Usage: node scripts/acp-control-contracts.mjs <isolated npm install directory>')
const runtime = resolve(process.argv[2])
const packageDir = join(runtime, 'node_modules', '@agentclientprotocol', 'codex-acp')
const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
assert.equal(manifest.version, '2.2.2')
const bundle = await readFile(join(packageDir, 'dist', 'index.js'), 'utf8')
const marker = '// src/index.ts'
assert.equal(bundle.split(marker).length, 2)
const modulePath = join(packageDir, 'dist', `ramu-control-audit-${randomUUID()}.mjs`)
const report = (test, fields) => console.log(JSON.stringify({ test, transport: 'synthetic', inferenceRequests: 0, ...fields }))

try {
  await writeFile(modulePath, bundle.slice(0, bundle.indexOf(marker)) + '\nexport {CodexAcpClient, AgentMode, ModelId, forkSession, zInitializeRequest, clientSupportsSubagents};\n')
  const { CodexAcpClient, AgentMode, ModelId, forkSession, zInitializeRequest, clientSupportsSubagents } = await import(pathToFileURL(modulePath).href)
  const canonical = zInitializeRequest.parse({ protocolVersion: 1, clientCapabilities: { subagents: {} } })
  assert.equal(canonical.clientCapabilities.subagents, undefined)
  assert.equal(clientSupportsSubagents(canonical.clientCapabilities), false)
  const legacy = zInitializeRequest.parse({ protocolVersion: 1, clientCapabilities: { _meta: { jetbrains: { air: { version: 1, capabilities: ['nativeSubagentSessions'] } } } } })
  assert.equal(clientSupportsSubagents(legacy.clientCapabilities), true)
  report('codex-published-subagent-negotiation', { canonicalCapabilityStrippedByBundledSchema: true, legacyAirCapabilityPreserved: true })
  const turns = []
  const notifications = new Map()
  const approvals = new Map()
  const elicitations = new Map()
  const native = {
    runTurn: async (params) => { turns.push(params); return { threadId: params.threadId, turn: { id: 'turn', status: 'completed' } } },
    onServerNotification: (id, callback) => notifications.set(id, callback),
    onApprovalRequest: (id, handler) => approvals.set(id, handler),
    onElicitationRequest: (id, handler) => elicitations.set(id, handler),
  }
  const client = new CodexAcpClient(native)
  // Skills discovery is unrelated to these contracts and is the only method stubbed.
  client.refreshSkills = async () => {}
  const prompt = { sessionId: 'root', prompt: [{ type: 'text', text: 'audit' }, { type: 'image', mimeType: 'image/png', data: 'AA==' }] }
  for (const mode of AgentMode.all()) {
    await client.sendPrompt(prompt, mode, ModelId.create('audit-model', 'high'), 'fast', true, '/audit', ['/extra'])
    const sent = turns.at(-1)
    assert.equal(sent.approvalPolicy, mode.approvalPolicy)
    assert.equal(sent.approvalsReviewer, mode.approvalsReviewer)
    assert.equal(sent.model, 'audit-model')
    assert.equal(sent.effort, 'high')
    assert.equal(sent.serviceTier, 'fast')
    assert.equal(sent.summary, 'none')
    assert.equal(sent.input[1].url, 'data:image/png;base64,AA==')
    if (sent.sandboxPolicy.type === 'workspaceWrite') assert.deepEqual(sent.sandboxPolicy.writableRoots, ['/extra'])
  }
  // This custom mode exists only in this probe. It demonstrates sendPrompt preserves
  // an added mode's policies; the released ACP mode picker does NOT expose it.
  for (const [policy, sandboxPolicy] of [
    ['untrusted', { ...AgentMode.WorkspaceWrite.sandboxPolicy, writableRoots: ['/audit'] }],
    ['never', { type: 'readOnly', networkAccess: false }],
  ]) {
    await client.sendPrompt(prompt, { approvalPolicy: policy, approvalsReviewer: 'user', sandboxPolicy }, ModelId.create('audit-model', 'high'), null, false, '/audit', ['/extra'])
    assert.equal(turns.at(-1).approvalPolicy, policy)
    assert.equal(turns.at(-1).sandboxPolicy.type, sandboxPolicy.type)
  }
  const beforeCancel = turns.length
  assert.equal(await client.sendPrompt(prompt, AgentMode.ReadOnly, ModelId.create('audit-model', 'high'), null, false, '/audit', [], undefined, () => true), null)
  assert.equal(turns.length, beforeCancel)
  report('codex-turn-parameters', { stockPoliciesPreserved: true, customEditsAndAnalysisPoliciesPreserved: true, customModesInstalled: false, rootsEffortFastAndImagesPreserved: true, cancelledBeforeTurnStart: true })

  let steered
  native.turnSteer = async (params) => { steered = params; return { turnId: 'turn' } }
  await client.steerTurn({ threadId: 'root', turnId: 'turn', prompt: prompt.prompt })
  assert.equal(steered.expectedTurnId, 'turn')
  assert.equal(steered.input[1].url, 'data:image/png;base64,AA==')
  report('codex-steering', { expectedTurnGuardPreserved: true, imagesPreserved: true })

  const events = []
  let release
  const held = new Promise((resolveHeld) => { release = resolveHeld })
  const seenApprovals = []
  let childReady = true
  const approvalHandler = { handleCommandExecution: async (params) => { seenApprovals.push(params.threadId); return { decision: 'decline' } } }
  const elicitationHandler = { handleUserInput: async () => ({ answers: {} }) }
  await client.subscribeToSessionEvents('root', async (event) => {
    events.push(event)
    if (event.method === 'item/started') await held
  }, approvalHandler, elicitationHandler, true, async () => {}, async (id) => childReady ? id : null)
  const spawnEvent = { method: 'item/started', params: { threadId: 'root', turnId: 'turn', item: { id: 'spawn', type: 'collabAgentToolCall', tool: 'spawnAgent', receiverThreadIds: ['child'] } } }
  notifications.get('root')(spawnEvent)
  assert.ok(notifications.has('child'), 'Child listener must be registered before root event finishes')
  const patch = { method: 'item/fileChange/patchUpdated', params: { threadId: 'child', turnId: 'child-turn', itemId: 'patch', changes: [{ path: '/audit/a', diff: 'synthetic diff' }] } }
  notifications.get('child')(patch)
  // Wrong-thread child notifications must not cross chat ownership boundaries.
  notifications.get('child')({ ...patch, params: { ...patch.params, threadId: 'unrelated' } })
  let approvalFinished = false
  const approval = approvals.get('child').handleCommandExecution({ threadId: 'child', itemId: 'cmd' }).then((result) => { approvalFinished = true; return result })
  await new Promise((resolveTick) => setImmediate(resolveTick))
  assert.equal(events.length, 1)
  assert.equal(approvalFinished, false)
  release()
  await client.waitForSessionNotifications('root')
  assert.equal(events.length, 2)
  assert.equal(events[1], patch, 'Raw child patch payload must survive before translator')
  assert.equal((await approval).decision, 'decline')
  assert.deepEqual(seenApprovals, ['child'])
  childReady = false
  assert.equal((await approvals.get('child').handleCommandExecution({ threadId: 'child' })).decision, 'cancel')
  assert.deepEqual(await elicitations.get('child').handleUserInput({ threadId: 'child' }), { answers: {} })
  report('codex-child-event-boundary', { synchronousChildDiscovery: true, rawPatchPayloadRetained: true, rootThenChildOrder: true, wrongThreadDropped: true, approvalWaitsForEvents: true, approvalAttributedToChild: true, unavailableChildCancelled: true })

  // Resubscription updates callbacks and capability behavior without re-registering
  // a child listener; this matters during a host/session rebuild.
  let interaction
  await client.subscribeToSessionEvents('root', async () => {}, approvalHandler, elicitationHandler, false, async (event) => { interaction = event }, async () => null)
  notifications.get('child')(patch)
  await client.waitForSessionNotifications('root')
  assert.equal(interaction.params.threadId, 'root')
  assert.equal((await approvals.get('child').handleCommandExecution({ threadId: 'child' })).decision, 'decline')
  assert.equal(seenApprovals.at(-1), 'root')
  report('codex-hidden-child-boundary', { hiddenChildRootAttribution: true, updatedSubscriptionUsed: true })

  native.configRead = async () => ({ config: {}, layers: [] })
  const mcp = [{ name: 'ramu', type: 'http', url: 'http://127.0.0.1:1/audit', headers: [{ name: 'Authorization', value: 'Bearer synthetic-audit-token' }] }]
  const config = await client.createSessionConfig('/audit', ['/extra'], mcp)
  assert.equal(config.config.mcp_servers.ramu.http_headers.Authorization, 'Bearer synthetic-audit-token')
  assert.equal(config.config.projects['/extra'].trust_level, 'trusted')
  assert.equal(config.config.mcp_servers.ramu.tool_timeout_sec, undefined)
  native.configRead = async () => ({ config: { mcp_servers: { ramu: { url: 'http://127.0.0.1:1/old' } } }, layers: [] })
  const conflict = await client.createSessionConfig('/audit', [], mcp)
  assert.deepEqual(conflict.skippedMcpServers, ['ramu'])
  assert.equal(conflict.config.mcp_servers, undefined)
  report('codex-scoped-mcp-config', { httpHeadersPreserved: true, additionalRootTrustPreserved: true, oneHourTimeoutMissing: true, existingNameSkipsScopedServer: true })

  let forked
  let released
  const forkDeps = {
    codexClient: { threadFork: async (params) => { forked = params; return { thread: { id: 'fork' }, model: 'audit-model', reasoningEffort: 'high', modelProvider: 'openai', serviceTier: null } } },
    refreshSkills: async () => {}, createSessionConfig: async () => ({ config: {}, skippedMcpServers: [] }),
    getResumeModelProvider: async () => 'openai', fetchAvailableModels: async () => [],
    createCurrentModelId: () => 'audit-model[high]', getCollaborationMode: () => 'default',
    releaseFailedFork: async (id) => { released = id },
  }
  const forkRequest = { sessionId: 'root', cwd: '/audit', mcpServers: [], _meta: { ephemeral: true } }
  assert.equal((await forkSession(forkRequest, [], forkDeps)).sessionId, 'fork')
  assert.equal(forked.excludeTurns, true)
  assert.equal(forked.ephemeral, undefined)
  await assert.rejects(() => forkSession(forkRequest, [], { ...forkDeps, fetchAvailableModels: async () => { throw new Error('synthetic model discovery failure') } }))
  assert.equal(released, 'fork')
  report('codex-fork-contract', { excludeTurnsPreserved: true, ephemeralMetaIgnored: true, failedSetupReleasesSubscription: true, failedForkDeleted: false })
} finally {
  await rm(modulePath, { force: true })
}

const claudeDir = join(runtime, 'node_modules', '@agentclientprotocol', 'claude-agent-acp')
assert.equal(JSON.parse(await readFile(join(claudeDir, 'package.json'), 'utf8')).version, '0.89.1')
const { ClaudeAcpAgent } = await import(pathToFileURL(join(claudeDir, 'dist', 'lib.js')).href)
const agent = new ClaudeAcpAgent({ sessionUpdate: async () => {} }, { log() {}, error() {} })
try {
  await agent.initialize({ protocolVersion: 1, clientCapabilities: {} })
  const input = []
  const turn = { settled: false }
  agent.sessions['audit'] = { turnQueue: [], input: { push: (message) => input.push(message) } }
  // Opt-in idle steering must not silently start a detached prompt.
  let detachedPrompts = 0
  agent.prompt = async () => { detachedPrompts++; throw new Error('No prompts permitted in this probe') }
  const idle = await agent.steer({ sessionId: 'audit', prompt: [{ type: 'text', text: 'audit' }], _meta: { steering: { idleBehavior: 'promptRequired' } } })
  assert.equal(idle.outcome, 'promptRequired')
  assert.equal(input.length, 0)
  assert.equal(detachedPrompts, 0)
  agent.sessions.audit.turnQueue.push(turn)
  agent.publishGoalFromPrompt = async () => {}
  assert.equal((await agent.steer({ sessionId: 'audit', prompt: [{ type: 'text', text: 'audit' }] })).outcome, 'injected')
  assert.equal(input.length, 1)
  assert.ok(turn.steeredUuids.has(input[0].uuid))
  assert.ok(turn.steeredEchoes.has(input[0].uuid))
  agent.sessions.audit.queryClosed = true
  await assert.rejects(() => agent.steer({ sessionId: 'audit', prompt: [{ type: 'text', text: 'audit' }] }))
  report('claude-steering-lifecycle', { idleOptInAvoidsDetachedPrompt: true, activeInputInjected: true, steerEchoTracked: true, closedQueryRejected: true })
} finally {
  // Synthetic session is not an owning SDK Query; remove before disposal.
  delete agent.sessions.audit
  await agent.dispose()
}
