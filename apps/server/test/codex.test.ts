import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { codexContext, codexModels, codexReadings, codexHelperHistory, toolOfOtherItem } from '../src/providers/codex'
import { DEFAULT_AGENT_SETTINGS } from '@ramu/shared/types'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ramu-codex-wire-'))
  const bin = join(tmp, 'codex')
  writeFileSync(
    bin,
    `#!/usr/bin/env node
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
    if (text.startsWith('compact counts')) {
      const usage = (n) => send({method:'thread/tokenUsage/updated',params:{threadId:'thread-1',turnId:'turn-1',tokenUsage:{last:{totalTokens:n},modelContextWindow:258400}}});
      usage(212000);
      send({method:'item/started',params:{threadId:'thread-1',turnId:'turn-1',item:{type:'contextCompaction',id:'counts-1'}}});
      if (text.endsWith('early')) usage(33700);
      send({method:'item/completed',params:{threadId:'thread-1',turnId:'turn-1',item:{type:'contextCompaction',id:'counts-1'}}});
      if (!text.endsWith('early')) usage(33700);
      usage(34000);
    }
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
`,
  )
  chmodSync(bin, 0o755)
  vi.stubEnv('RAMU_CODEX_BIN', bin)
  vi.stubEnv('RAMU_WIRE_LOG', join(tmp, 'wire.log'))
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(tmp, { recursive: true, force: true })
})
const wireLines = () =>
  readFileSync(join(tmp, 'wire.log'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
const messages = () => wireLines().filter((line) => !line.argv)
const scope = { cwd: '/workspace', additionalDirs: ['/other'], covers: ['/workspace/api', '/other'] }

describe('Codex app-server wire adapter', () => {
  it('recovers saved helper threads without resuming or starting work and isolates missing histories', async () => {
    const settings = { ...DEFAULT_AGENT_SETTINGS, access: 'full' as const, provider: 'codex' as const }
    const history = await codexHelperHistory(
      {
        ...scope,
        id: 'ramu-root',
        taskId: 't',
        repoId: null,
        provider: 'codex',
        settings,
        state: 'restored',
        providerSessionId: 'saved-root',
        parentId: null,
        createdAt: 0,
        title: 'Root',
      },
      [
        { agentId: 'interrupted-helper', name: 'Interrupted', status: 'running' },
        { agentId: 'missing', name: 'Missing', status: 'running' },
      ],
    )
    expect(history.find((entry) => entry.task.agentId === 'saved-helper')).toMatchObject({
      task: { name: 'Recovered survey' },
      events: [
        expect.objectContaining({ kind: 'text', agentId: 'saved-helper', messageId: 'saved-helper:saved-message' }),
        expect.objectContaining({ kind: 'tool-use' }),
        expect.objectContaining({ kind: 'tool-result', summary: 'Three suites' }),
      ],
    })
    expect(history.find((entry) => entry.task.agentId === 'interrupted-helper')?.task.status).toBe('stopped')
    expect(history.find((entry) => entry.task.agentId === 'missing')?.error).toContain('Missing helper history')
    expect(messages().filter((message) => /thread\/(start|resume)|turn\//.test(message.method ?? ''))).toEqual([])
    expect(
      messages()
        .filter((message) => message.method === 'thread/read')
        .every((message) => message.params.includeTurns),
    ).toBe(true)
  })
  it('discovers actual model names and supported reasoning levels', async () => {
    expect(await codexModels()).toEqual([
      {
        provider: 'codex',
        id: 'codex-wire',
        name: 'Codex wire',
        efforts: ['low', 'high'],
        defaultEffort: 'low',
        isDefault: true,
        serviceTiers: [],
      },
    ])
    expect(messages()[0]).toMatchObject({ method: 'initialize', params: { clientInfo: { name: 'ramu' } } })
  })
})

describe('other Codex tool items', () => {
  it('shows web searches, page opens and image views as tool calls', () => {
    expect(
      toolOfOtherItem({ type: 'webSearch', action: { type: 'search', query: 'jadwal imunisasi IDAI 2024' } }),
    ).toMatchObject({ name: 'WebSearch', summary: 'jadwal imunisasi IDAI 2024' })
    expect(toolOfOtherItem({ type: 'webSearch', query: 'idai' })).toMatchObject({ name: 'WebSearch', summary: 'idai' })
    expect(
      toolOfOtherItem({ type: 'webSearch', action: { type: 'openPage', url: 'https://www.idai.or.id' } }),
    ).toMatchObject({ name: 'WebFetch', summary: 'https://www.idai.or.id' })
    expect(toolOfOtherItem({ type: 'imageView', path: '/tmp/a.png' })).toMatchObject({
      name: 'Read',
      summary: '/tmp/a.png',
    })
    expect(toolOfOtherItem({ type: 'agentMessage', text: 'hi' })).toBeNull()
  })
})

describe('Codex plan usage', () => {
  it('maps the 5-hour and weekly windows from their length, with reset times and plan', () => {
    const readings = codexReadings(
      {
        planType: 'pro',
        primary: { usedPercent: 41.6, windowDurationMins: 300, resetsAt: 1_800_000_000 },
        secondary: { usedPercent: 83, windowDurationMins: 10080, resetsAt: 1_800_500_000 },
      },
      5,
    )
    expect(readings).toEqual([
      {
        provider: 'codex',
        window: 'five_hour',
        usedPercent: 42,
        resetsAt: 1_800_000_000_000,
        status: 'ok',
        plan: 'pro',
        updatedAt: 5,
      },
      {
        provider: 'codex',
        window: 'weekly',
        usedPercent: 83,
        resetsAt: 1_800_500_000_000,
        status: 'warning',
        plan: 'pro',
        updatedAt: 5,
      },
    ])
  })
  it('marks a reached limit, tolerates sparse updates, and ignores nothing-to-report', () => {
    expect(
      codexReadings({ rateLimitReachedType: 'rate_limit_reached', primary: { usedPercent: 100 }, secondary: null })[0],
    ).toMatchObject({ window: 'five_hour', status: 'limited', usedPercent: 100 })
    expect(codexReadings({ primary: null, secondary: null })).toEqual([])
    expect(codexReadings(undefined)).toEqual([])
  })
})

describe('Codex context window', () => {
  it('is the last request against the model window', () => {
    expect(
      codexContext({ last: { totalTokens: 52_000 }, total: { totalTokens: 400_000 }, modelContextWindow: 258_000 }),
    ).toEqual({ used: 52_000, max: 258_000 })
    expect(codexContext({ last: { totalTokens: 5 }, modelContextWindow: null })).toBeNull()
    expect(codexContext(undefined)).toBeNull()
  })
})
