import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CODEX_HOOK_CONFIG, codexContext, codexModels, codexReadings, codexHelperHistory, createCodexRunner, toolOfOtherItem } from '../src/codex'
import { DEFAULT_AGENT_SETTINGS, type AgentEvent } from '@ramu/shared/types'

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
let liveTools = false;
const send = m => process.stdout.write(JSON.stringify(m)+'\\n');
fs.appendFileSync(process.env.RAMU_WIRE_LOG, JSON.stringify({argv: process.argv.slice(2)})+'\\n');
rl.on('line', line => {
  const m = JSON.parse(line);
  fs.appendFileSync(process.env.RAMU_WIRE_LOG, line+'\\n');
  if (!m.method) {
    if (m.id === 900 && liveTools) {
      send({method:'item/completed',params:{threadId:'thread-1',item:{type:'commandExecution',id:'cmd-1',status:'failed',aggregatedOutput:'authoritative failure',exitCode:2}}});
      send({method:'item/commandExecution/outputDelta',params:{threadId:'thread-1',turnId:'turn-1',itemId:'cmd-1',delta:'late ignored'}});
      send({method:'item/completed',params:{threadId:'sub-1',item:{type:'commandExecution',id:'cmd-1',status:'completed',exitCode:0}}});
      send({method:'item/completed',params:{threadId:'thread-1',item:{type:'fileChange',id:'edit-1',status:'completed'}}});
      send({method:'item/fileChange/patchUpdated',params:{threadId:'thread-1',turnId:'turn-1',itemId:'edit-1',changes:[{path:'late.txt',diff:'late'}]}});
      send({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'completed',error:null}}}); return;
    }
    if (m.id === 900) { send({method:'item/completed',params:{threadId:'thread-1',item:{type:'commandExecution',id:'cmd-1',status:'completed',aggregatedOutput:'workspace',exitCode:0}}}); send({method:'turn/completed',params:{threadId:'thread-1',turn:{id:'turn-1',status:'completed',error:null}}}); }
    return;
  }
  if (m.method === 'initialize') send({id:m.id,result:{userAgent:'test'}});
  if (m.method === 'model/list') send({id:m.id,result:{data:[{model:'codex-wire',displayName:'Codex wire',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}],defaultReasoningEffort:'low',isDefault:true}],nextCursor:null}});
  if (m.method === 'thread/start' || m.method === 'thread/resume') send({id:m.id,result:{thread:{id:'thread-1'},model:'codex-wire'}});
  if (m.method === 'thread/read') {
    const id = m.params.threadId;
    if (id === 'missing') { send({id:m.id,error:{message:'Missing helper history'}}); return; }
    send({id:m.id,result:{thread:{id,status:{type:'notLoaded'},turns:[{id:'saved-turn',status:id === 'interrupted-helper' ? 'inProgress' : 'completed',items:id === 'saved-root' ? [{type:'collabAgentToolCall',id:'spawn-saved',tool:'spawnAgent',prompt:'Recovered survey',receiverThreadIds:['saved-helper']}] : [{type:'agentMessage',id:'saved-message',text:'Persisted findings'},{type:'commandExecution',id:'saved-command',command:'ls test',status:'completed',aggregatedOutput:'Three suites',exitCode:0}]}]}}});
  }
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
    if (text.startsWith('mcp ')) {
      const base = {threadId:'thread-1',turnId:'turn-1',serverName:'Setup server',message:'Configure connection'};
      const schema = {type:'object',properties:{count:{type:'integer',minimum:1,maximum:10},enabled:{type:'boolean'},region:{type:'string',oneOf:[{const:'id',title:'Jakarta'},{const:'sg',title:'Singapore'}]},note:{type:'string'}},required:['count','enabled','region']};
      const request = text === 'mcp url' ? {...base,mode:'url',url:'https://example.com/auth',elicitationId:'auth'} : {...base,mode:'form',requestedSchema:text === 'mcp unsupported' ? {type:'object',properties:{nested:{type:'object'}}} : schema};
      send({id:700,method:'mcpServer/elicitation/request',params:request});
      if (text === 'mcp many') send({id:701,method:'mcpServer/elicitation/request',params:request});
      if (text === 'mcp resolved') send({method:'serverRequest/resolved',params:{threadId:'thread-1',requestId:700}});
      if (text === 'mcp dynamic') send({id:702,method:'item/tool/call',params:{threadId:'thread-1',tool:'unregistered'}});
      return;
    }
    if (text === 'live tools') {
      liveTools = true;
      send({method:'item/completed',params:{threadId:'thread-1',item:{type:'collabAgentToolCall',id:'spawn',tool:'spawnAgent',receiverThreadIds:['sub-1'],agentsStates:{'sub-1':{status:'running'}}}}});
      for (const threadId of ['thread-1','sub-1']) {
        send({method:'item/started',params:{threadId,turnId:'turn-1',item:{type:'commandExecution',id:'cmd-1',command:'test'}}});
        send({method:'item/commandExecution/outputDelta',params:{threadId,turnId:'turn-1',itemId:'cmd-1',delta:threadId === 'thread-1' ? 'first ' : 'helper '}});
        send({method:'item/commandExecution/outputDelta',params:{threadId,turnId:'turn-1',itemId:'cmd-1',delta:'output'}});
        send({method:'turn/diff/updated',params:{threadId,turnId:'turn-1',diff:threadId + ' old diff'}});
        send({method:'turn/diff/updated',params:{threadId,turnId:'turn-1',diff:threadId + ' latest diff'}});
      }
      send({method:'item/started',params:{threadId:'thread-1',item:{type:'fileChange',id:'edit-1',changes:[{path:'app.ts'}]}}});
      for (const diff of ['old patch','latest patch']) send({method:'item/fileChange/patchUpdated',params:{threadId:'thread-1',turnId:'turn-1',itemId:'edit-1',changes:[{path:'app.ts',kind:{type:'update',move_path:null},diff}]}});
      send({method:'item/commandExecution/outputDelta',params:{threadId:'other-thread',turnId:'turn-1',itemId:'cmd-1',delta:'unrelated'}});
      send({id:900,method:'item/commandExecution/requestApproval',params:{threadId:'thread-1',command:'test'}}); return;
    }
    if (text === 'agents') {
      send({method:'item/completed',params:{threadId:'thread-1',item:{type:'collabAgentToolCall',id:'collab-1',tool:'spawnAgent',status:'completed',prompt:'Survey the tests',receiverThreadIds:['sub-1'],agentsStates:{'sub-1':{status:'running'}}}}});
      send({method:'turn/started',params:{threadId:'sub-1',turn:{id:'sub-turn'}}});
      send({method:'item/agentMessage/delta',params:{threadId:'sub-1',itemId:'msg-1',delta:'Found 3 suites'}});
      send({method:'item/started',params:{threadId:'sub-1',item:{type:'commandExecution',id:'sub-cmd',command:'ls test'}}});
      send({method:'item/started',params:{threadId:'other-thread',item:{type:'commandExecution',id:'stranger',command:'rm -rf /'}}});
      send({id:901,method:'item/commandExecution/requestApproval',params:{threadId:'sub-1',command:'ls test',reason:'sub-agent'}});
      return;
    }
    if (text === 'legacy compact') send({method:'thread/compacted',params:{threadId:'thread-1',turnId:'turn-1'}});
    send({method:'item/agentMessage/delta',params:{threadId:'thread-1',itemId:'msg-1',delta:'Hello '}});
    send({method:'item/agentMessage/delta',params:{threadId:'thread-1',itemId:'msg-1',delta:'Ramu'}});
    send({method:'item/completed',params:{threadId:'thread-1',item:{type:'agentMessage',id:'msg-1',text:'Hello Ramu'}}});
    if (text === 'async questions') { send({method:'item/completed',params:{threadId:'thread-1',turnId:'turn-1',item:{type:'agentMessage',id:'ask-async',delivery:'async',text:'Choose the setup',questions:[{title:'Which database?',options:['SQLite','Postgres']},{title:'Which region?',options:['Jakarta','Singapore']}]}}}); }
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
const wireLines = () => readFileSync(join(tmp, 'wire.log'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
const messages = () => wireLines().filter((line) => !line.argv)
const scope = { cwd: '/workspace', additionalDirs: ['/other'], covers: ['/workspace/api', '/other'] }

describe('Codex app-server wire adapter', () => {
  it('recovers saved helper threads without resuming or starting work and isolates missing histories', async () => {
    const settings = { ...DEFAULT_AGENT_SETTINGS, access: 'full' as const, provider: 'codex' as const }
    const history = await codexHelperHistory({ ...scope, id: 'ramu-root', taskId: 't', repoId: null, provider: 'codex', settings, state: 'restored', providerSessionId: 'saved-root', parentId: null, createdAt: 0, title: 'Root' }, [
      { agentId: 'interrupted-helper', name: 'Interrupted', status: 'running' },
      { agentId: 'missing', name: 'Missing', status: 'running' },
    ])
    expect(history.find((entry) => entry.task.agentId === 'saved-helper')).toMatchObject({ task: { name: 'Recovered survey' }, events: [expect.objectContaining({ kind: 'text', agentId: 'saved-helper', messageId: 'saved-helper:saved-message' }), expect.objectContaining({ kind: 'tool-use' }), expect.objectContaining({ kind: 'tool-result', summary: 'Three suites' })] })
    expect(history.find((entry) => entry.task.agentId === 'interrupted-helper')?.task.status).toBe('stopped')
    expect(history.find((entry) => entry.task.agentId === 'missing')?.error).toContain('Missing helper history')
    expect(messages().filter((message) => /thread\/(start|resume)|turn\//.test(message.method ?? ''))).toEqual([])
    expect(messages().filter((message) => message.method === 'thread/read').every((message) => message.params.includeTurns)).toBe(true)
  })
  it.each(['compact', 'legacy compact'])('shows Codex compaction without duplicate legacy events or invented token counts: %s', async (prompt) => {
    runner = createCodexRunner(scope, { ...DEFAULT_AGENT_SETTINGS, provider: 'codex', access: 'full' }, (event) => events.push(event))
    await runner.start(prompt, null)
    await until(() => events.some((event) => event.kind === 'result'))
    expect(events.filter((event) => event.kind === 'compaction')).toEqual([
      ...(prompt === 'compact' ? [{ kind: 'compaction', state: 'started' }] : []),
      { kind: 'compaction', state: 'completed' },
    ])
  })
  it('validates MCP forms before replying, retains invalid requests, and uses typed values and raw server IDs', async () => {
    runner = createCodexRunner(scope, { ...DEFAULT_AGENT_SETTINGS, access: 'full' as const, provider: 'codex' }, (event) => events.push(event))
    await runner.start('mcp form', null)
    await until(() => events.some((event) => event.kind === 'elicitation'))
    const request = events.find((event) => event.kind === 'elicitation')!
    if (request.kind !== 'elicitation') throw new Error('Missing form')
    expect(request).toMatchObject({ serverName: 'Setup server', mode: 'form' })
    expect(() => runner!.replyElicitation!(request.requestId, 'accept', { count: '999', enabled: 'false', region: 'id' })).toThrow()
    expect(messages().some((message) => message.id === 700 && message.result)).toBe(false)
    runner.replyElicitation!(request.requestId, 'accept', { count: '2', enabled: 'false', region: 'id', note: '' })
    await until(() => messages().some((message) => message.id === 700 && message.result))
    expect(messages()).toContainEqual({ id: 700, result: { action: 'accept', content: { count: 2, enabled: false, region: 'id' }, _meta: null } })
    expect(() => runner!.replyElicitation!(request.requestId, 'accept', {})).toThrow(/no longer pending/)
  })
  it.each(['decline', 'cancel'] as const)('returns explicit %s and waits for other outstanding forms', async (action) => {
    runner = createCodexRunner(scope, { ...DEFAULT_AGENT_SETTINGS, access: 'full' as const, provider: 'codex' }, (event) => events.push(event))
    await runner.start('mcp many', null)
    await until(() => events.filter((event) => event.kind === 'elicitation').length === 2)
    const requests = events.filter((event) => event.kind === 'elicitation')
    const start = events.length
    runner.replyElicitation!(requests[0]!.requestId, action, {})
    expect(events.slice(start).some((event) => event.kind === 'state' && event.state === 'running')).toBe(false)
    runner.replyElicitation!(requests[1]!.requestId, 'cancel', {})
    await until(() => messages().some((message) => message.id === 701 && message.result))
    expect(messages()).toContainEqual({ id: 700, result: { action, content: null, _meta: null } })
    expect(events.at(-1)).toMatchObject({ kind: 'state', state: 'running' })
  })
  it('shows URL requests without opening them and responds only after explicit continuation', async () => {
    runner = createCodexRunner(scope, { ...DEFAULT_AGENT_SETTINGS, access: 'full' as const, provider: 'codex' }, (event) => events.push(event))
    await runner.start('mcp url', null)
    await until(() => events.some((event) => event.kind === 'elicitation'))
    const request = events.find((event) => event.kind === 'elicitation')!
    expect(request).toMatchObject({ mode: 'url', url: 'https://example.com/auth' })
    expect(messages().some((message) => message.id === 700 && message.result)).toBe(false)
    runner.replyElicitation!(request.requestId, 'accept', {})
    await until(() => messages().some((message) => message.id === 700 && message.result))
    expect(messages()).toContainEqual({ id: 700, result: { action: 'accept', content: null, _meta: null } })
  })
  it('cancels unsupported schemas, keeps dynamic tool calls separate, and observes server-side resolution', async () => {
    runner = createCodexRunner(scope, { ...DEFAULT_AGENT_SETTINGS, access: 'full' as const, provider: 'codex' }, (event) => events.push(event))
    await runner.start('mcp unsupported', null)
    await until(() => messages().some((message) => message.id === 700 && message.result))
    expect(messages()).toContainEqual({ id: 700, result: { action: 'cancel', content: null, _meta: null } })
    expect(events.some((event) => event.kind === 'error')).toBe(true)
    expect(events.some((event) => event.kind === 'elicitation')).toBe(false)
    await runner.stop(); runner = createCodexRunner(scope, { ...DEFAULT_AGENT_SETTINGS, access: 'full' as const, provider: 'codex' }, (event) => events.push(event))
    await runner.start('mcp dynamic', null)
    await until(() => messages().some((message) => message.id === 702 && message.error))
    expect(messages().find((message) => message.id === 702 && message.error)?.error.code).toBe(-32601)
    await runner.stop(); runner = undefined
    events.length = 0
    runner = createCodexRunner(scope, { ...DEFAULT_AGENT_SETTINGS, access: 'full' as const, provider: 'codex' }, (event) => events.push(event))
    await runner.start('mcp resolved', null)
    await until(() => events.some((event) => event.kind === 'request-resolved'))
    const request = events.find((event) => event.kind === 'elicitation')!
    expect(() => runner!.replyElicitation!(request.requestId, 'accept', {})).toThrow(/no longer pending/)
  })
  it('cancels outstanding elicitations on interrupt and scopes request identities to a connection', async () => {
    runner = createCodexRunner(scope, { ...DEFAULT_AGENT_SETTINGS, access: 'full' as const, provider: 'codex' }, (event) => events.push(event))
    await runner.start('mcp form', null)
    await until(() => events.some((event) => event.kind === 'elicitation'))
    const first = events.find((event) => event.kind === 'elicitation')!
    await runner.interrupt()
    await until(() => messages().some((message) => message.id === 700 && message.result))
    expect(messages()).toContainEqual({ id: 700, result: { action: 'cancel', content: null, _meta: null } })
    await runner.stop(); events.length = 0
    runner = createCodexRunner(scope, { ...DEFAULT_AGENT_SETTINGS, access: 'full' as const, provider: 'codex' }, (event) => events.push(event))
    await runner.start('mcp form', null)
    await until(() => events.some((event) => event.kind === 'elicitation'))
    expect(events.find((event) => event.kind === 'elicitation')?.requestId).not.toBe(first.requestId)
  })
  it('streams commands and replacement patches for main/helpers, then prefers final results and ignores late deltas', async () => {
    runner = createCodexRunner(scope, { ...DEFAULT_AGENT_SETTINGS, provider: 'codex', access: 'edits' }, (event) => events.push(event))
    await runner.start('live tools', null)
    await until(() => events.some((event) => event.kind === 'permission-request'))
    const results = () => events.filter((event) => event.kind === 'tool-result')
    expect(results().findLast((event) => event.toolUseId === 'cmd-1')).toMatchObject({ summary: 'first output', running: true })
    expect(results().findLast((event) => event.toolUseId === 'sub-1:cmd-1')).toMatchObject({ summary: 'helper output', running: true, agentId: 'sub-1' })
    expect(results().findLast((event) => event.toolUseId === 'edit-1')).toMatchObject({ summary: 'app.ts (update)\nlatest patch', running: true })
    expect(events.filter((event) => event.kind === 'turn-diff').map((event) => [event.turnId, event.diff, event.agentId])).toEqual([
      ['thread-1:turn-1', 'thread-1 old diff', undefined], ['thread-1:turn-1', 'thread-1 latest diff', undefined],
      ['sub-1:turn-1', 'sub-1 old diff', 'sub-1'], ['sub-1:turn-1', 'sub-1 latest diff', 'sub-1'],
    ])
    runner.replyPermission('900', true)
    await until(() => events.some((event) => event.kind === 'result'))
    expect(results().findLast((event) => event.toolUseId === 'cmd-1')).toMatchObject({ summary: 'authoritative failure', isError: true })
    expect(results().findLast((event) => event.toolUseId === 'cmd-1')?.running).toBeUndefined()
    expect(results().findLast((event) => event.toolUseId === 'sub-1:cmd-1')).toMatchObject({ summary: 'helper output', isError: false })
    expect(results().findLast((event) => event.toolUseId === 'edit-1')).toMatchObject({ summary: 'app.ts (update)\nlatest patch' })
    expect(JSON.stringify(events)).not.toMatch(/unrelated|late ignored|late.txt/)
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
    runner = createCodexRunner(scope, { ...DEFAULT_AGENT_SETTINGS, access: 'full' as const, provider: 'codex' }, (e, limit) => { events.push(e); limited ||= !!limit })
    await runner.start('limit', null)
    await until(() => events.some((e) => e.kind === 'result'))
    expect(limited).toBe(true)
  })
  it('shows sub-agent threads as agents with their own output, and routes their approvals', async () => {
    runner = createCodexRunner(scope, { ...DEFAULT_AGENT_SETTINGS, provider: 'codex', access: 'edits' }, (e) => events.push(e))
    await runner.start('agents', null)
    await until(() => events.some((e) => e.kind === 'permission-request'))
    expect(events.find((e) => e.kind === 'agent')).toMatchObject({ agentId: 'sub-1', name: 'Survey the tests', status: 'running', prompt: 'Survey the tests', address: 'sub-1', canMessage: true })
    expect(events.filter((e) => e.agentId === 'sub-1' && e.kind !== 'agent').map((e) => e.kind)).toEqual(['text', 'tool-use'])
    expect(events.find((e) => e.kind === 'text' && e.agentId === 'sub-1')).toMatchObject({ text: 'Found 3 suites', messageId: 'sub-1:msg-1' })
    // Threads it did not spawn stay out.
    expect(events.some((e) => e.kind === 'tool-use' && e.toolUseId === 'stranger')).toBe(false)
    runner.replyPermission('901', true)
    await until(() => messages().some((m) => m.id === 901 && m.result))
    expect(messages()).toContainEqual({ id: 901, result: { decision: 'accept' } })
  })
  it('answers user input using the provider question IDs', async () => {
    runner = createCodexRunner(scope, { ...DEFAULT_AGENT_SETTINGS, access: 'full' as const, provider: 'codex' }, (e) => events.push(e))
    await runner.start('question', null)
    await until(() => events.some((e) => e.kind === 'question'))
    runner.replyQuestion('900', { 'Which?': 'A' })
    await until(() => events.some((e) => e.kind === 'result'))
    expect(messages()).toContainEqual({ id: 900, result: { answers: { choice: { answers: ['A'] } } } })
  })
})

it('steers the active turn using its expected id', async () => {
  runner = createCodexRunner(scope, { ...DEFAULT_AGENT_SETTINGS, provider: 'codex', access: 'edits' }, (event) => events.push(event))
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
  const { AttachmentStore } = await import('../src/attachments')
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

describe('Codex plan usage', () => {
  it('maps the 5-hour and weekly windows from their length, with reset times and plan', () => {
    const readings = codexReadings({ planType: 'pro', primary: { usedPercent: 41.6, windowDurationMins: 300, resetsAt: 1_800_000_000 }, secondary: { usedPercent: 83, windowDurationMins: 10080, resetsAt: 1_800_500_000 } }, 5)
    expect(readings).toEqual([
      { provider: 'codex', window: 'five_hour', usedPercent: 42, resetsAt: 1_800_000_000_000, status: 'ok', plan: 'pro', updatedAt: 5 },
      { provider: 'codex', window: 'weekly', usedPercent: 83, resetsAt: 1_800_500_000_000, status: 'warning', plan: 'pro', updatedAt: 5 },
    ])
  })
  it('marks a reached limit, tolerates sparse updates, and ignores nothing-to-report', () => {
    expect(codexReadings({ rateLimitReachedType: 'rate_limit_reached', primary: { usedPercent: 100 }, secondary: null })[0]).toMatchObject({ window: 'five_hour', status: 'limited', usedPercent: 100 })
    expect(codexReadings({ primary: null, secondary: null })).toEqual([])
    expect(codexReadings(undefined)).toEqual([])
  })
})

describe('Codex context window', () => {
  it('is the last request against the model window', () => {
    expect(codexContext({ last: { totalTokens: 52_000 }, total: { totalTokens: 400_000 }, modelContextWindow: 258_000 })).toEqual({ used: 52_000, max: 258_000 })
    expect(codexContext({ last: { totalTokens: 5 }, modelContextWindow: null })).toBeNull()
    expect(codexContext(undefined)).toBeNull()
  })
})

describe('Codex sub-agent controls at launch', () => {
  const argvOf = () => wireLines().find((m) => m.argv).argv as string[]
  const scope = { cwd: '/workspace', additionalDirs: [], covers: ['/workspace'] }
  const settings = { ...DEFAULT_AGENT_SETTINGS, access: 'full' as const, provider: 'codex' as const, model: 'codex-wire' }
  it('turns Codex\'s own sub-agent tools off and lifts the tool timeout when Ramu runs sub-agents', async () => {
    runner = createCodexRunner(scope, settings, (e) => events.push(e))
    runner.setTools?.({ url: 'http://127.0.0.1:9/mcp', token: 't', nativeSubagents: false })
    await runner.start('hello', null)
    await until(() => events.some((e) => e.kind === 'result'))
    expect(argvOf()).toEqual(expect.arrayContaining(['features.multi_agent=false', 'mcp_servers.ramu.tool_timeout_sec=3600']))
  })
  it('leaves them on by default, and installs the hook that asks Ramu first when asked to', async () => {
    runner = createCodexRunner(scope, settings, (e) => events.push(e))
    runner.setTools?.({ url: 'http://127.0.0.1:9/mcp', token: 't' })
    await runner.start('hello', null)
    await until(() => events.some((e) => e.kind === 'result'))
    expect(argvOf()).not.toContain('features.multi_agent=false')
    expect(argvOf()).not.toContain(CODEX_HOOK_CONFIG)
    await runner.stop()
    rmSync(join(tmp, 'wire.log'))
    events.length = 0
    runner = createCodexRunner(scope, settings, (e) => events.push(e))
    runner.setTools?.({ url: 'http://127.0.0.1:9/mcp', token: 't', interceptSubagents: true })
    await runner.start('hello', null)
    await until(() => events.some((e) => e.kind === 'result'))
    expect(argvOf()).toContain(CODEX_HOOK_CONFIG)
    expect(CODEX_HOOK_CONFIG).toContain('matcher="spawn_agent"')
  })
})


it('keeps native async Codex questions pending after the turn finishes without treating them as a blocking RPC', async () => {
  runner = createCodexRunner(scope, { ...DEFAULT_AGENT_SETTINGS, provider: 'codex', access: 'full' }, (event) => events.push(event))
  runner.setTools?.({ url: 'http://127.0.0.1:1/mcp', token: 'test', instructions: 'Use grouped async questions.' })
  await runner.start('async questions', null)
  await until(() => events.some((e) => e.kind === 'result'))
  expect(events.find((e) => e.kind === 'question')).toMatchObject({ requestId: 'async:thread-1:ask-async', responseMode: 'message', grouping: 'together', questions: [{ id: '0', question: 'Which database?' }, { id: '1', question: 'Which region?' }] })
  expect(events.some((e) => e.kind === 'state' && e.state === 'needs-input')).toBe(false)
  expect(events.some((e) => e.kind === 'request-resolved')).toBe(false)
  expect(messages().find((m) => m.method === 'thread/start').params.developerInstructions).toBe('Use grouped async questions.')
})
