// Isolated released-code diagnostics. No native processes, inference, or migration.
import assert from 'node:assert/strict'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

if (!process.argv[2]) throw new Error('Usage: node scripts/acp-state-contracts.mjs <isolated npm install directory>')
const packageDir = resolve(process.argv[2], 'node_modules/@agentclientprotocol/codex-acp')
assert.equal(JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8')).version, '2.2.2')
const bundle = await readFile(join(packageDir, 'dist/index.js'), 'utf8')
const marker = '// src/index.ts'
assert.equal(bundle.split(marker).length, 2)
const modulePath = join(packageDir, 'dist', `ramu-state-audit-${randomUUID()}.mjs`)
const report = (test, fields) => console.log(JSON.stringify({ test, transport: 'synthetic', inferenceRequests: 0, ...fields }))
try {
  await writeFile(modulePath, bundle.slice(0, bundle.indexOf(marker)) + '\nexport {CodexEventHandler, ClientCapabilities, CodexSessionCompactions, clientSupportsCompaction, zInitializeRequest, zSessionNotification, zNewSessionRequest, zLoadSessionRequest, zResumeSessionRequest, zForkSessionRequest, readAdditionalDirectories, CodexPlanStream};\n')
  const api = await import(pathToFileURL(modulePath).href)
  const negotiated = api.zInitializeRequest.parse({ protocolVersion: 1, clientCapabilities: { plan: {}, session: { compaction: {}, configOptions: { boolean: {} }, notices: {} }, elicitation: { form: {}, url: {} } } }).clientCapabilities
  assert.equal(api.clientSupportsCompaction(negotiated), true)
  assert.deepEqual(negotiated.plan, {})
  assert.deepEqual(negotiated.session.configOptions.boolean, {})
  assert.deepEqual(negotiated.elicitation, { form: {}, url: {} })
  const compactions = new api.CodexSessionCompactions()
  const start = compactions.start('root', 'turn', 'compact')
  assert.equal(start.status, 'in_progress')
  assert.equal(compactions.start('root', 'turn', 'compact'), null)
  const done = compactions.completeLegacy('root', 'turn')
  assert.equal(done.compactionId, start.compactionId)
  assert.equal(done.status, 'completed')
  assert.equal(compactions.complete('root', 'turn', 'compact'), null)
  const late = compactions.completeLegacy('root', 'late-turn')
  assert.equal(compactions.complete('root', 'late-turn', 'late-item'), null)
  assert.equal(late.status, 'completed')
  compactions.start('root', 'cancel-turn', 'root-cancel')
  compactions.start('child', 'cancel-turn', 'child-cancel')
  assert.deepEqual(compactions.finishTurn('root', 'cancel-turn', 'cancelled').map(x => x.compactionId), ['root-cancel'])
  const outstanding = compactions.finishOutstanding('failed', 'child')
  assert.equal(outstanding.length, 1)
  assert.equal(outstanding[0].sessionId, 'child')
  assert.equal(outstanding[0].update.status, 'failed')
  assert.equal(compactions.finishOutstanding('failed').length, 0)
  for (const update of [start, done, outstanding[0].update]) {
    assert.deepEqual(api.zSessionNotification.parse({ sessionId: 'root', update }).update, update)
  }
  report('codex-compaction-state', { canonicalNegotiationPreserved: true, lifecycleSurvivesWireSchema: true, duplicateCompletionSuppressed: true, lateCompletionSuppressed: true, cancellationScopedToSession: true, failureCleanupTerminalOnce: true })

  const state = { sessionId: 'root', currentTurnId: 'turn', clientCapabilities: api.ClientCapabilities.from({}), compactions }
  const handler = new api.CodexEventHandler({}, state, false, 'audit', {}, undefined, false, true, false)
  const translate = (method, fields) => handler.createUpdateEvent({ method, params: { threadId: 'root', turnId: 'turn', ...fields } })
  const plan = await translate('turn/plan/updated', { plan: [{ step: 'Inspect', status: 'completed' }, { step: 'Verify', status: 'inProgress' }, { step: 'Finish', status: 'pending' }] })
  assert.deepEqual(plan.entries.map(x => x.status), ['completed', 'in_progress', 'pending'])
  assert.equal(api.zSessionNotification.parse({ sessionId: 'root', update: plan }).update.entries.length, 3)
  const command = { type: 'commandExecution', id: 'command', command: 'audit-command', cwd: '/audit', status: 'inProgress', commandActions: [], aggregatedOutput: null, exitCode: null, durationMs: null, source: 'agent' }
  assert.equal((await translate('item/started', { item: command })).kind, 'execute')
  const output = await translate('item/commandExecution/outputDelta', { itemId: command.id, delta: 'audit-output' })
  assert.equal(output._meta.terminal_output_delta.data, 'audit-output')
  assert.equal(output.toolCallId, command.id)
  const finish = await translate('item/completed', { item: { ...command, status: 'completed', aggregatedOutput: 'audit-output', exitCode: 0 } })
  assert.equal(finish.status, 'completed')
  assert.equal(finish._meta.terminal_exit.exit_code, 0)
  assert.equal(finish._meta.terminal_output_delta, undefined)
  assert.equal(finish.content, undefined)
  assert.equal(api.zSessionNotification.parse({ sessionId: 'root', update: output }).update._meta.terminal_output_delta.data, 'audit-output')
  report('codex-checklist-command-output', { checklistStatusesPreserved: true, commandChunksPreserved: true, exitCodePreserved: true, streamedOutputNotDuplicatedAtCompletion: true })

  for (const planCapability of [false, true]) {
    const updates = []
    const stream = new api.CodexPlanStream({ update: async update => updates.push(update) }, api.ClientCapabilities.from(planCapability ? { plan: {} } : {}))
    try {
      assert.equal(stream.delta('plan', 'First'), null)
      assert.equal(stream.delta('plan', ' second'), null)
      await stream.flush()
      const completed = await stream.completed('plan', 'First second')
      if (planCapability) {
        assert.equal(updates.length, 1)
        assert.equal(updates[0].plan.content, 'First second')
        assert.equal(completed.update, null)
        assert.equal(api.zSessionNotification.parse({ sessionId: 'root', update: updates[0] }).update.sessionUpdate, 'plan_update')
      } else {
        assert.equal(updates.length, 0)
        assert.equal(completed.update.sessionUpdate, 'agent_message_chunk')
        assert.equal(completed.update.content.text, 'First second')
      }
    } finally { await stream.dispose() }
  }
  report('codex-plan-negotiation', { negotiatedSnapshotsPreserved: true, completionDoesNotDuplicateSnapshot: true, unnegotiatedTextFallbackPreserved: true })

  for (const schema of [api.zNewSessionRequest, api.zLoadSessionRequest, api.zResumeSessionRequest, api.zForkSessionRequest]) {
    const request = schema.parse({ cwd: '/audit', sessionId: 'root', mcpServers: [], additionalDirectories: ['/extra', '/extra', '/audit'] })
    assert.deepEqual(api.readAdditionalDirectories(request.cwd, request.additionalDirectories, request._meta), ['/extra'])
  }
  for (const bad of [['relative'], [''], [42]]) assert.throws(() => api.readAdditionalDirectories('/audit', bad))
  report('codex-workspace-root-lifecycle', { newLoadResumeForkSchemaPreservesRoots: true, duplicateAndParentRootsRemoved: true, invalidRootsRejectedBeforeNativeCall: true })
} finally { await rm(modulePath, { force: true }) }
