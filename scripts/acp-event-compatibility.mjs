// Inspect the released Codex ACP event translator with synthetic input and no CLI startup.
// Pass an isolated npm install directory. This depends on the readable 2.2.2 bundle layout.
import assert from 'node:assert/strict'
import { readFile, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'

if (!process.argv[2]) throw new Error('Usage: node scripts/acp-event-compatibility.mjs <isolated npm install directory>')
const packageDir = resolve(process.argv[2], 'node_modules', '@agentclientprotocol', 'codex-acp')
const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
assert.equal(manifest.version, '2.2.2', 'Re-audit the bundle layout before using this probe with another release')
const bundle = await readFile(join(packageDir, 'dist', 'index.js'), 'utf8')
const marker = '// src/index.ts'
assert.equal(bundle.split(marker).length, 2, 'Cannot safely isolate the translator from CLI startup')
const modulePath = join(packageDir, 'dist', `ramu-audit-${randomUUID()}.mjs`)

try {
  // Keep the published translator unchanged; omit the executable entry point and export its classes.
  await writeFile(modulePath, bundle.slice(0, bundle.indexOf(marker)) + '\nexport {CodexEventHandler, ClientCapabilities, AgentMode};\n')
  const { CodexEventHandler, ClientCapabilities, AgentMode } = await import(pathToFileURL(modulePath).href)
  for (const extended of [false, true]) {
    const capabilities = ClientCapabilities.from(extended ? {
      _meta: {
        jetbrains: { air: { version: 1, capabilities: ['diffPatch', 'nativeSubagentSessions', 'sessionFailure'] } },
        terminal_output_delta: true,
      },
    } : {})
    const state = { sessionId: 'audit-root', clientCapabilities: capabilities, rateLimits: null, currentTurnId: 'audit-turn' }
    const handler = new CodexEventHandler({}, state, false, 'audit', {}, undefined, true, false, false)
    const translate = (method, params) => handler.createUpdateEvent({ method, params: { threadId: 'audit-root', turnId: 'audit-turn', ...params } })
    const limits = { limitId: 'codex', limitName: 'Codex', primary: { usedPercent: 95, windowDurationMins: 300, resetsAt: 1900000000 }, secondary: { usedPercent: 30, windowDurationMins: 10080, resetsAt: 1900600000 }, credits: null, planType: 'plus' }
    const rateLimitUpdate = await translate('account/rateLimits/updated', { rateLimits: limits })
    assert.equal(state.rateLimits.get('codex').snapshot.primary.usedPercent, 95)
    const patchUpdate = await translate('item/fileChange/patchUpdated', { itemId: 'patch', changes: [{ path: '/audit/a', kind: { type: 'update', move_path: null }, diff: 'diff --git a/a b/a\n' }] })
    const diffUpdate = await translate('turn/diff/updated', { diff: 'diff --git a/a b/a\n' })
    assert.equal(handler.getTurnDiff('audit-turn'), 'diff --git a/a b/a\n')
    const questionUpdate = await translate('item/completed', { item: { type: 'agentMessage', id: 'question', text: 'Choose a color', phase: null, memoryCitation: null, delivery: 'async', questions: [{ title: 'Color?', options: ['red', 'blue'] }] } })
    const count = { totalTokens: 42, inputTokens: 40, cachedInputTokens: 0, outputTokens: 2, reasoningOutputTokens: 0 }
    const usage = await translate('thread/tokenUsage/updated', { tokenUsage: { last: count, total: count, modelContextWindow: 1000 } })
    assert.equal(usage.sessionUpdate, 'usage_update')
    assert.equal(usage.used, 42)
    assert.equal(usage.size, 1000)
    console.log(JSON.stringify({
      adapter: 'codex-acp', version: manifest.version, airExtensions: extended,
      rateLimitsCachedButNotEmitted: rateLimitUpdate === null,
      patchUpdatedDropped: patchUpdate === null,
      turnDiffCachedButNotStreamed: diffUpdate === null,
      asyncQuestionMetadataDropped: questionUpdate === null,
      tokenContextEmitted: true,
      approvalPolicies: AgentMode.all().map((mode) => ({ mode: mode.id, policy: mode.approvalPolicy, reviewer: mode.approvalsReviewer })),
    }))
  }
} finally {
  await rm(modulePath, { force: true })
}
