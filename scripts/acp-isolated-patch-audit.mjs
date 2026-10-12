// Prototype adapter repairs in a temporary module only. No CLI startup, native
// process, inference, dependency change, or production migration is performed.
import assert from 'node:assert/strict'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
if (!process.argv[2]) throw new Error('Usage: node scripts/acp-isolated-patch-audit.mjs <isolated install directory>')
const dir = resolve(process.argv[2], 'node_modules', '@agentclientprotocol', 'codex-acp')
assert.equal(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).version, '2.2.2')
const bundle = await readFile(join(dir, 'dist', 'index.js'), 'utf8')
assert.equal(bundle.split('// src/index.ts').length, 2)
let source = bundle.slice(0, bundle.indexOf('// src/index.ts'))
function replaceOnce(before, after) {
  assert.equal(source.split(before).length, 2, 'Pinned repair anchor changed; re-audit before patching')
  source = source.replace(before, after)
}
// Repair only the initialization schema's missing canonical marker.
replaceOnce('var zClientCapabilities = object({', 'var zClientCapabilities = object({\n  subagents: defaultOnError(object({}).nullish(), () => void 0),')
// Carry a scoped timeout requested by our future host, retaining the standard
// adapter default when no extension is present.
replaceOnce('"http_headers": Object.fromEntries(mcpServer.headers.map((h) => [h.name, h.value]))', '"http_headers": Object.fromEntries(mcpServer.headers.map((h) => [h.name, h.value])),\n            ...(mcpServer._meta?.ramu?.toolTimeoutSec ? {tool_timeout_sec: mcpServer._meta.ramu.toolTimeoutSec} : {})')
const start = source.indexOf('async function forkSession(request, additionalDirectories, dependencies) {')
const end = source.indexOf('async function resolveForkTurnId(', start)
assert.ok(start > 0 && end > start)
const forkSource = source.slice(start, end)
assert.equal(forkSource.split('excludeTurns: true,').length, 2)
source = source.slice(0, start) + forkSource.replace('excludeTurns: true,', 'excludeTurns: true,\n    ...(request._meta?.ramu?.ephemeral === true ? {ephemeral: true} : {}),') + source.slice(end)
source += '\nexport {zInitializeRequest, clientSupportsSubagents, CodexAcpClient, CodexEventHandler, ClientCapabilities, AgentMode, ModelId, forkSession};\n'
const modulePath = join(dir, 'dist', `ramu-isolated-repairs-${randomUUID()}.mjs`)
try {
  await writeFile(modulePath, source)
  const { zInitializeRequest, clientSupportsSubagents, CodexAcpClient, CodexEventHandler, ClientCapabilities, AgentMode, ModelId, forkSession } = await import(pathToFileURL(modulePath).href)
  const canonical = zInitializeRequest.parse({ protocolVersion: 1, clientCapabilities: { subagents: {} } })
  assert.equal(clientSupportsSubagents(canonical.clientCapabilities), true)
  const requests = []
  const client = new CodexAcpClient({ configRead: async () => ({ config: {}, layers: [] }), runTurn: async (params) => { requests.push(params); return null } })
  client.refreshSkills = async () => {}
  const mcp = await client.createSessionConfig('/audit', [], [{ type: 'http', name: 'ramu_unique_audit', url: 'http://127.0.0.1:1/audit', headers: [{ name: 'Authorization', value: 'Bearer synthetic-audit' }], _meta: { ramu: { toolTimeoutSec: 3600 } } }])
  assert.equal(mcp.config.mcp_servers.ramu_unique_audit.tool_timeout_sec, 3600)
  assert.equal(mcp.config.mcp_servers.ramu_unique_audit.http_headers.Authorization, 'Bearer synthetic-audit')

  // Register real AgentMode instances in this module's catalogs. This affects
  // both find() and the mode config-option list; no live adapter is installed.
  const edits = new AgentMode('ramu-edits', 'Edits', 'Audit edits policy', 'standard', 'untrusted', 'user', { ...AgentMode.WorkspaceWrite.sandboxPolicy, writableRoots: ['/audit'] }, 'workspace-write')
  const analysis = new AgentMode('ramu-analysis', 'Analysis', 'Audit deny approval policy', 'standard', 'never', 'user', { type: 'readOnly', networkAccess: false }, 'read-only')
  const stockAll = AgentMode.all.bind(AgentMode)
  AgentMode.all = () => [...stockAll(), edits, analysis]
  for (const mode of [edits, analysis]) {
    assert.equal(AgentMode.find(mode.id), mode)
    assert.ok(mode.toConfigOption(false).options.some((option) => option.value === mode.id))
    await client.sendPrompt({ sessionId: 'audit', prompt: [{ type: 'text', text: 'audit' }] }, mode, ModelId.create('audit-model', 'high'), null, false, '/audit', ['/extra'])
    assert.equal(requests.at(-1).approvalPolicy, mode.approvalPolicy)
    assert.equal(requests.at(-1).sandboxPolicy.type, mode.sandboxPolicy.type)
  }
  let forkParams
  const deps = { refreshSkills: async () => {}, createSessionConfig: async () => ({ config: {}, skippedMcpServers: [] }), getResumeModelProvider: async () => 'openai', fetchAvailableModels: async () => [], createCurrentModelId: () => 'audit-model[high]', getCollaborationMode: () => 'default', releaseFailedFork: async () => {}, codexClient: { threadFork: async (params) => { forkParams = params; return { thread: { id: 'audit-fork' }, model: 'audit-model', modelProvider: 'openai', reasoningEffort: 'high' } } } }
  await forkSession({ sessionId: 'audit', cwd: '/audit', _meta: { ramu: { ephemeral: true } } }, [], deps)
  assert.equal(forkParams.ephemeral, true)
  await forkSession({ sessionId: 'audit', cwd: '/audit' }, [], deps)
  assert.equal(forkParams.ephemeral, undefined, 'Standard durable fork must retain its default')

  // Prototype interception before translation loss. Preserve stock internal
  // bookkeeping and only use a custom update for the selected missing payloads.
  // A production extension still needs ownership, wire schemas, and Ramu mapping.
  const state = { sessionId: 'audit', clientCapabilities: ClientCapabilities.from({}), rateLimits: null, currentTurnId: 'turn' }
  const handler = new CodexEventHandler({}, state, false, 'audit', {}, undefined, true, false, false)
  const stockTranslate = handler.createUpdateEvent.bind(handler)
  handler.createUpdateEvent = async (event) => {
    const translated = await stockTranslate(event)
    const selected = ['account/rateLimits/updated', 'item/fileChange/patchUpdated', 'turn/diff/updated'].includes(event.method) || (event.method === 'item/completed' && event.params.item?.type === 'agentMessage' && event.params.item.delivery === 'async')
    if (!selected) return translated
    assert.equal(translated, null, 'Avoid silently duplicating a newly supported stock update')
    return { sessionUpdate: 'session_info_update', _meta: { ramu: { nativeEvent: event } } }
  }
  const events = [
    { method: 'account/rateLimits/updated', params: { rateLimits: { limitId: 'codex', primary: { usedPercent: 95, windowDurationMins: 300, resetsAt: 1900000000 } } } },
    { method: 'item/fileChange/patchUpdated', params: { threadId: 'audit', turnId: 'turn', itemId: 'patch', changes: [{ path: '/audit/a', kind: { type: 'update', move_path: null }, diff: 'synthetic diff' }] } },
    { method: 'turn/diff/updated', params: { threadId: 'audit', turnId: 'turn', diff: 'synthetic diff' } },
    { method: 'item/completed', params: { threadId: 'audit', turnId: 'turn', item: { type: 'agentMessage', id: 'question', text: 'audit', delivery: 'async', questions: [{ title: 'Color?', options: ['red', 'blue'] }] } } },
  ]
  for (const event of events) assert.deepEqual((await handler.createUpdateEvent(event))._meta.ramu.nativeEvent, event)
  assert.equal(state.rateLimits.get('codex').snapshot.primary.usedPercent, 95)
  assert.equal(handler.getTurnDiff('turn'), 'synthetic diff')
  console.log(JSON.stringify({ test: 'isolated-codex-adapter-repairs', passed: true, canonicalChildNegotiationRepaired: true, scopedMcpTimeoutAndAuthPreserved: true, exactPoliciesSelectableAndSent: true, optInEphemeralForkPreserved: true, missingNativePayloadsRetained: true, stockRateAndDiffBookkeepingPreserved: true, transport: 'synthetic', inferenceRequests: 0, productionAdapterChanged: false, liveWireParityVerified: false }))
} finally { await rm(modulePath, { force: true }) }
