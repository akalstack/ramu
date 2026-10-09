import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { codexModels, createCodexRunner, toolOfOtherItem } from '../src/main/codex'
import { DEFAULT_AGENT_SETTINGS, type AgentEvent } from '../src/shared/types'

let tmp: string
let events: AgentEvent[]
let runner: ReturnType<typeof createCodexRunner> | undefined
const until = async (f: () => boolean) => {
  const start = Date.now()
  while (!f()) { if (Date.now() - start > 5000) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 10)) }
}
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ramu-codex-wire-'))
  events = []
  const bin = join(tmp, 'codex')
  writeFileSync(bin, `#!/usr/bin/env node
const fs = require('node:fs');
const rl = require('node:readline').createInterface({input:process.stdin});
const send = m => process.stdout.write(JSON.stringify(m)+'\\n');
rl.on('line', line => {
  const m = JSON.parse(line);
  fs.appendFileSync(process.env.RAMU_WIRE_LOG, line+'\\n');
  if (!m.method) {
    if (m.id === 900) { send({method:'item/completed',params:{threadId:'thread-1',item:{type:'commandExecution',id:'cmd-1',status:'completed',aggregatedOutput:'workspace',exitCode:0}}}); send({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'completed',error:null}}}); }
    return;
  }
  if (m.method === 'initialize') send({id:m.id,result:{userAgent:'test'}});
  if (m.method === 'model/list') send({id:m.id,result:{data:[{model:'codex-wire',displayName:'Codex wire',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}],defaultReasoningEffort:'low',isDefault:true}],nextCursor:null}});
  if (m.method === 'thread/start' || m.method === 'thread/resume') send({id:m.id,result:{thread:{id:'thread-1'},model:'codex-wire'}});
  if (m.method === 'turn/start') {
    send({id:m.id,result:{turn:{id:'turn-1'}}});
    send({method:'turn/started',params:{threadId:'thread-1',turn:{id:'turn-1'}}});
    const text = m.params.input[0].text;
    if (text === 'limit') { send({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'failed',error:{message:'Limit reached',codexErrorInfo:'usageLimitExceeded'}}}}); return; }
    if (text === 'compact') {
      send({method:'item/started',params:{threadId:'thread-1',turnId:'turn-1',item:{type:'contextCompaction',id:'compact-1'}}});
      send({method:'item/completed',params:{threadId:'thread-1',turnId:'turn-1',item:{type:'contextCompaction',id:'compact-1'}}});
      send({method:'item/completed',params:{threadId:'thread-1',turnId:'turn-1',item:{type:'contextCompaction',id:'compact-1'}}});
      send({method:'thread/compacted',params:{threadId:'thread-1',turnId:'turn-1'}});
    }
    if (text === 'legacy compact') send({method:'thread/compacted',params:{threadId:'thread-1',turnId:'turn-1'}});
    send({method:'item/agentMessage/delta',params:{threadId:'thread-1',itemId:'msg-1',delta:'Hello '}});
    send({method:'item/agentMessage/delta',params:{threadId:'thread-1',itemId:'msg-1',delta:'Ramu'}});
    send({method:'item/completed',params:{threadId:'thread-1',item:{type:'agentMessage',id:'msg-1',text:'Hello Ramu'}}});
    if (text === 'question') { send({id:900,method:'item/tool/requestUserInput',params:{threadId:'thread-1',questions:[{id:'choice',header:'Choice',question:'Which?',options:[{label:'A',description:'First'}]}]}}); return; }
    send({method:'item/started',params:{threadId:'thread-1',item:{type:'commandExecution',id:'cmd-1',command:'pwd'}}});
    if (m.params.approvalPolicy === 'never') send({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'completed',error:null}}});
    else send({id:900,method:'item/commandExecution/requestApproval',params:{threadId:'thread-1',command:'pwd',reason:'approval'}});
  }
  if (m.method === 'turn/steer') send({id:m.id,result:{turnId:'turn-1'}});
  if (m.method === 'turn/interrupt') { send({id:m.id,result:{}}); send({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'interrupted',error:null}}}); }
});
`)
  chmodSync(bin, 0o755)
  vi.stubEnv('RAMU_CODEX_BIN', bin)
  vi.stubEnv('RAMU_WIRE_LOG', join(tmp, 'wire.log'))
})
afterEach(async () => { await runner?.stop(); runner = undefined; vi.unstubAllEnvs(); rmSync(tmp, { recursive: true, force: true }) })
const messages = () => readFileSync(join(tmp, 'wire.log'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
const scope = { cwd: '/workspace', additionalDirs: ['/other'], covers: ['/workspace/api', '/other'] }

describe('Codex app-server wire adapter', () => {
  it.each(['compact', 'legacy compact'])('shows Codex compaction without duplicate legacy events or invented token counts: %s', async (prompt) => {
    runner = createCodexRunner(scope, { ...DEFAULT_AGENT_SETTINGS, provider: 'codex', access: 'full' }, (event) => events.push(event))
    await runner.start(prompt, null)
    await until(() => events.some((event) => event.kind === 'result'))
    expect(events.filter((event) => event.kind === 'compaction')).toEqual([
      ...(prompt === 'compact' ? [{ kind: 'compaction', state: 'started' }] : []),
      { kind: 'compaction', state: 'completed' },
    ])
  })
  it('discovers actual model names and supported reasoning levels', async () => {
    expect(await codexModels()).toEqual([{ provider: 'codex', id: 'codex-wire', name: 'Codex wire', efforts: ['low', 'high'], defaultEffort: 'low', isDefault: true, serviceTiers: [] }])
    expect(messages()[0]).toMatchObject({ method: 'initialize', params: { clientInfo: { name: 'ramu' } } })
  })
  it('streams text, scopes sandbox writes, and routes command approvals', async () => {
    runner = createCodexRunner(scope, { ...DEFAULT_AGENT_SETTINGS, provider: 'codex', model: 'codex-wire', effort: 'high', access: 'edits' }, (e) => events.push(e))
    await runner.start('hello', null)
    await until(() => events.some((e) => e.kind === 'permission-request'))
    expect(messages().find((m) => m.method === 'turn/start').params).toMatchObject({ model: 'codex-wire', effort: 'high', approvalPolicy: 'untrusted', sandboxPolicy: { type: 'workspaceWrite', writableRoots: ['/workspace', '/other'], networkAccess: false } })
    expect(events.filter((e) => e.kind === 'text')).toEqual([
      { kind: 'text', messageId: 'msg-1', text: 'Hello ' },
      { kind: 'text', messageId: 'msg-1', text: 'Hello Ramu' },
      { kind: 'text', messageId: 'msg-1', text: 'Hello Ramu' },
    ])
    runner.replyPermission('900', true)
    await until(() => events.some((e) => e.kind === 'result'))
    expect(messages()).toContainEqual({ id: 900, result: { decision: 'accept' } })
  })
  it('resumes native threads with full access and applies effort per turn', async () => {
    runner = createCodexRunner(scope, { ...DEFAULT_AGENT_SETTINGS, provider: 'codex', model: 'codex-wire', access: 'full', effort: 'low' }, (e) => events.push(e))
    await runner.start('hello', 'saved-thread')
    await until(() => events.some((e) => e.kind === 'result'))
    expect(messages().find((m) => m.method === 'thread/resume').params).toMatchObject({ threadId: 'saved-thread', sandbox: 'danger-full-access', approvalPolicy: 'never' })
    expect(messages().find((m) => m.method === 'turn/start').params).toMatchObject({ sandboxPolicy: { type: 'dangerFullAccess' }, effort: 'low' })
  })
  it('maps structured usage limits to a terminal turn failure', async () => {
    let limited = false
    runner = createCodexRunner(scope, { ...DEFAULT_AGENT_SETTINGS, provider: 'codex' }, (e, limit) => { events.push(e); limited ||= !!limit })
    await runner.start('limit', null)
    await until(() => events.some((e) => e.kind === 'result'))
    expect(limited).toBe(true)
  })
  it('answers user input using the provider question IDs', async () => {
    runner = createCodexRunner(scope, { ...DEFAULT_AGENT_SETTINGS, provider: 'codex' }, (e) => events.push(e))
    await runner.start('question', null)
    await until(() => events.some((e) => e.kind === 'question'))
    runner.replyQuestion('900', { 'Which?': 'A' })
    await until(() => events.some((e) => e.kind === 'result'))
    expect(messages()).toContainEqual({ id: 900, result: { answers: { choice: { answers: ['A'] } } } })
  })
})

it('steers the active turn using its expected id', async () => {
  runner = createCodexRunner(scope, { ...DEFAULT_AGENT_SETTINGS, provider: 'codex', access: 'ask' }, (event) => events.push(event))
  await runner.start('hello', null)
  await until(() => events.some((event) => event.kind === 'permission-request'))
  await runner.steer('change direction')
  expect(messages().find((message) => message.method === 'turn/steer')).toMatchObject({ params: {
    threadId: 'thread-1', expectedTurnId: 'turn-1', input: [{ type: 'text', text: 'change direction' }],
  } })
})

it('accepts a follow-up after a turn completes before the start response settles', async () => {
  runner = createCodexRunner(scope, { ...DEFAULT_AGENT_SETTINGS, provider: 'codex', access: 'full' }, (event) => events.push(event))
  await runner.start('first', null)
  await until(() => events.some((event) => event.kind === 'result'))
  await expect(runner.send('follow-up')).resolves.toBeUndefined()
})

it('sends native image attachments and readable file context to Codex', async () => {
  const { AttachmentStore } = await import('../src/main/attachments')
  const store = new AttachmentStore(join(tmp, 'attachments'))
  const image = store.add('screenshot.png', Buffer.from('image'))
  const file = store.add('notes.txt', Buffer.from('Review the empty state'))
  runner = createCodexRunner(scope, { ...DEFAULT_AGENT_SETTINGS, provider: 'codex', access: 'full' }, (event) => events.push(event))
  await runner.start('check this', null, [image, file])
  const input = messages().find((message) => message.method === 'turn/start').params.input
  expect(input[0].text).toContain('Review the empty state')
  expect(input[1]).toEqual({ type: 'localImage', path: image.path })
})

describe('other Codex tool items', () => {
  it('shows web searches, page opens and image views as tool calls', () => {
    expect(toolOfOtherItem({ type: 'webSearch', action: { type: 'search', query: 'jadwal imunisasi IDAI 2024' } })).toMatchObject({ name: 'WebSearch', summary: 'jadwal imunisasi IDAI 2024' })
    expect(toolOfOtherItem({ type: 'webSearch', query: 'idai' })).toMatchObject({ name: 'WebSearch', summary: 'idai' })
    expect(toolOfOtherItem({ type: 'webSearch', action: { type: 'openPage', url: 'https://www.idai.or.id' } })).toMatchObject({ name: 'WebFetch', summary: 'https://www.idai.or.id' })
    expect(toolOfOtherItem({ type: 'imageView', path: '/tmp/a.png' })).toMatchObject({ name: 'Read', summary: '/tmp/a.png' })
    expect(toolOfOtherItem({ type: 'agentMessage', text: 'hi' })).toBeNull()
  })
})
