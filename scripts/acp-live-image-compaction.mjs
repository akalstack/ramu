// Opt-in diagnostics: new disposable saved chats only; no production routing.
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { auditHost, textOf, reportFailure } from './acp-audit-host.mjs'
if (!process.argv[2] || !process.argv.includes('--live')) throw new Error('Usage: node scripts/acp-live-image-compaction.mjs <isolated runtime> --live')
const runtime = resolve(process.argv[2])
function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const tag = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4)
  size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([tag, data])))
  return Buffer.concat([size, tag, data, crc])
}
const header = Buffer.alloc(13); header.writeUInt32BE(64); header.writeUInt32BE(64, 4); header[8] = 8; header[9] = 2
const pixels = Buffer.alloc(64 * (1 + 64 * 3))
for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) pixels[y * 193 + 1 + x * 3] = 255
const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]).toString('base64')
const rows = (events, id) => events.filter(e => e.sessionId === id && ['user_message_chunk', 'agent_message_chunk'].includes(e.update.sessionUpdate) && e.update.content?.type === 'text').map(e => ({ kind: e.update.sessionUpdate, text: e.update.content.text, id: e.update.messageId ?? e.update._meta?.messageId ?? e.update._meta?.claudeCode?.uuid }))
const providers = process.argv.includes('--claude-only') ? ['claude'] : ['claude', 'codex']
for (const provider of providers) {
  const cwd = await mkdtemp(join(tmpdir(), `ramu-acp-image-compact-${provider}-`))
  const events = [], token = `COMPACT_${randomUUID().replaceAll('-', '')}`
  let host, sessionId, stage = 'image', deleted = false
  const open = () => auditHost(provider, runtime, cwd, { sessionId, onUpdate: event => events.push(event), clientCapabilities: { session: { compaction: {} }, plan: {} }, options: { persistSession: true, tools: [] } })
  try {
    host = await open(); sessionId = host.sessionId
    if (provider === 'codex') await host.mode('read-only')
    const result = await host.promptBlocks([{ type: 'text', text: `Remember the exact audit token ${token}. Identify the dominant color of the attached image in one word. Do not use tools.` }, { type: 'image', mimeType: 'image/png', data: png }])
    assert.equal(result.stopReason, 'end_turn')
    assert.match(textOf(events, sessionId), /\bred\b/i, 'Real image recognition must identify fixture color')
    console.log(JSON.stringify({ test: `live-${provider}-image-input`, passed: true, base64PngRecognized: true, existingChatsLoaded: false }))
    stage = 'compaction'; events.length = 0
    await host.prompt('/compact')
    const compact = events.filter(e => e.sessionId === sessionId && e.update.sessionUpdate === 'compaction_update').map(e => e.update)
    assert.ok(compact.some(e => e.status === 'in_progress'), 'Missing compaction start')
    assert.ok(compact.some(e => e.status === 'completed'), 'Missing completed compaction')
    const terminal = compact.filter(e => e.status === 'completed')
    assert.equal(new Set(terminal.map(e => e.compactionId)).size, 1, 'One manual compaction must retain one entity identity')
    let finished = false
    for (const update of compact) {
      if (finished) assert.equal(update.status, 'completed', 'Compaction must not regress after completion')
      if (update.status === 'completed') finished = true
    }
    if (provider === 'codex') assert.equal(terminal.length, 1, 'Codex must suppress duplicate terminal reports')
    stage = 'restart'
    await host.close({ preserve: true }); host = undefined
    events.length = 0; host = await open()
    const first = rows(events, sessionId)
    const replayCompactions = events.filter(e => e.update.sessionUpdate === 'compaction_update')
    assert.ok(first.length > 0 || replayCompactions.some(e => e.update.summary?.some(part => part.type === 'text' && part.text.length > 0)), 'Compacted history has no replay text or summary')
    await host.close({ preserve: true }); host = undefined
    events.length = 0; host = await open()
    assert.deepEqual(rows(events, sessionId), first, 'Compacted replay must remain stable across restart')
    assert.deepEqual(events.filter(e => e.update.sessionUpdate === 'compaction_update'), replayCompactions, 'Compaction entities must remain stable across restart')
    stage = 'continuation'; events.length = 0
    if (provider === 'codex') await host.mode('read-only')
    assert.equal((await host.prompt('Reply only with the exact audit token given before compaction. No tools.')).stopReason, 'end_turn')
    assert.ok(textOf(events, sessionId).includes(token), 'Compacted continuation lost the token')
    console.log(JSON.stringify({ test: `live-${provider}-compact-recovery`, passed: true, manualCompactionLifecycle: true, logicalCompactionEntities: 1, terminalReports: terminal.length, terminalStateDoesNotRegress: true, restartedReplayStable: true, replayCompactionUpdates: replayCompactions.length, contextRetainedAfterCompaction: true, automaticCompactionVerified: false }))
  } catch (error) { reportFailure(`live-${provider}-image-compact`, error, { stage }) }
  finally {
    if (host) { const result = await host.close(); deleted = result?.deleted ?? false }
    if (provider === 'claude' && sessionId) {
      const sdk = await import(pathToFileURL(join(runtime, 'node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs')).href)
      try { await sdk.deleteSession(sessionId, { dir: cwd }); deleted = true } catch {}
    }
    console.log(JSON.stringify({ test: `${provider}-image-compact-owned-cleanup`, deleted }))
    await rm(cwd, { recursive: true, force: true })
  }
}
