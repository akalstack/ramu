// Live tests only in temporary workspaces: steering/cancel during sleep and
// rejection of an attempted temporary-file write. No production provider changes.
import assert from 'node:assert/strict'
import { mkdtemp, rm, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { auditHost, textOf, reportFailure } from './acp-audit-host.mjs'
if (!process.argv[2] || !process.argv.includes('--live')) throw new Error('Usage: node scripts/acp-live-interactions.mjs <isolated install directory> --live')
const runtime = resolve(process.argv[2])

async function timing(provider, action) {
  const cwd = await mkdtemp(join(tmpdir(), `ramu-acp-${action}-`))
  const updates = []
  let host
  let injected
  let trigger
  let interactionError
  try {
    host = await auditHost(provider, runtime, cwd, {
      options: { tools: ['Bash'], permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true },
      onUpdate: async (event) => {
        updates.push(event)
        if (trigger || event.update.sessionUpdate !== 'tool_call' || event.update.kind !== 'execute') return
        // Delay slightly so the command is executing when the control arrives.
        trigger = new Promise((resolveTrigger) => setTimeout(resolveTrigger, 400)).then(async () => {
          if (action === 'steer') injected = await host.steer('New instruction for this running turn: after sleep completes, reply exactly ACP_STEERED. Do not call another tool.')
          else await host.cancel()
        }).catch((error) => { interactionError = error })
      },
    })
    if (provider === 'codex') await host.mode('agent-full-access')
    const result = await host.prompt('Integration audit in a temporary directory: execute the shell command sleep 5 exactly once. Then reply ACP_ORIGINAL. Do not read or write any files, use network, or call helpers.')
    assert.ok(trigger, 'Model did not execute audit sleep')
    await trigger
    if (interactionError) throw interactionError
    if (action === 'steer') {
      assert.equal(injected.outcome, 'injected', 'Steering did not enter running turn')
      assert.ok(textOf(updates, host.sessionId).includes('ACP_STEERED'), 'Steered instruction not followed')
      assert.equal(result.stopReason, 'end_turn')
    } else {
      assert.equal(result.stopReason, 'cancelled', 'Interrupted turn was not cancelled')
      updates.length = 0
      const followup = await host.prompt('The interrupt test is complete. Do not call tools. Reply exactly ACP_AFTER_CANCEL.')
      assert.equal(followup.stopReason, 'end_turn')
      assert.ok(textOf(updates, host.sessionId).includes('ACP_AFTER_CANCEL'))
    }
    console.log(JSON.stringify({ test: `live-${provider}-${action}-during-tool`, passed: true, stopReason: result.stopReason, activeToolControl: true, parentUsableAfterCancel: action === 'cancel' ? true : undefined }))
  } catch (error) { reportFailure(`live-${provider}-${action}-during-tool`, error, { controlTriggered: !!trigger, steerOutcome: injected?.outcome }) }
  finally { if (host) await host.close(); await rm(cwd, { recursive: true, force: true }) }
}

async function permission(provider) {
  const cwd = await mkdtemp(join(tmpdir(), 'ramu-acp-permission-'))
  const target = join(cwd, 'denied.txt')
  let host
  let asked = 0
  let attributed = true
  const updates = []
  try {
    host = await auditHost(provider, runtime, cwd, {
      options: { tools: ['Bash'], permissionMode: 'default', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [async () => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: 'Audit requires explicit approval' } })] }] } },
      onUpdate: async (event) => updates.push(event),
      onPermission: async (request) => { asked++; attributed &&= request.sessionId === host.sessionId; return { outcome: { outcome: 'cancelled' } } },
    })
    if (provider === 'codex') await host.mode('read-only')
    const result = await host.prompt(`Approval audit. Use your shell execution tool exactly once to execute printf audit > '${target}'. For Codex, request sandbox_permissions=require_escalated because this read-only session needs approval. The client will cancel approval. Do not retry or use another write tool. Reply ACP_DENIED afterwards.`)
    assert.ok(asked > 0, 'No permission request received')
    assert.equal(attributed, true)
    let exists = true
    try { await access(target) } catch { exists = false }
    assert.equal(exists, false, 'Cancelled write executed')
    assert.ok(['end_turn', 'cancelled'].includes(result.stopReason))
    updates.length = 0
    const followup = await host.prompt('Permission audit finished. No tools. Reply exactly ACP_AFTER_DENIAL.')
    assert.equal(followup.stopReason, 'end_turn')
    assert.ok(textOf(updates, host.sessionId).includes('ACP_AFTER_DENIAL'))
    console.log(JSON.stringify({ test: `live-${provider}-permission-cancellation`, passed: true, permissionRequests: asked, correctlyAttributed: true, cancelledWriteAbsent: true, parentUsable: true }))
  } catch (error) { reportFailure(`live-${provider}-permission-cancellation`, error, { permissionRequests: asked }) }
  finally { if (host) await host.close(); await rm(cwd, { recursive: true, force: true }) }
}

for (const provider of ['claude', 'codex']) {
  for (const action of ['steer', 'cancel']) await timing(provider, action)
  await permission(provider)
}
