import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { isLimitMessage, isLimitReply, limitResetsAt } from '../src/providers/usageLimit'
import {
  acpAside,
  acpModels,
  acpSessionModels,
  acpTurnTokens,
  createAcpRunner,
  AcpResumeUnavailable,
} from '../src/providers/acp'
import { DEFAULT_AGENT_SETTINGS, type AgentEvent, type Attachment, type McpConnection } from '@ramu/shared/types'

let dir: string
let events: AgentEvent[]
let runner: ReturnType<typeof createAcpRunner> | undefined
const until = async (condition: () => boolean) => {
  const started = Date.now()
  while (!condition()) {
    if (Date.now() - started > 5000) throw new Error('Timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}
const log = () =>
  readFileSync(join(dir, 'wire'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ramu-acp-'))
  events = []
  const bin = join(dir, 'agent')
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs=require('node:fs'); const rl=require('node:readline').createInterface({input:process.stdin});
const send=m=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...m})+'\\n');
let promptID; let current='';
const finish=()=>send({id:promptID,result:{stopReason:'end_turn'}});
const session={sessionId:'session-1',configOptions:[{id:'model',category:'model',type:'select',currentValue:'wire-model',options:[{value:'wire-model',name:'Wire model'}]},{id:'mode',category:'mode',type:'select',currentValue:'agent',options:[{value:'agent',name:'Agent'},{value:'ask',name:'Ask'},...JSON.parse(process.env.RAMU_EXTRA_MODES||'[]')]}]};
const levels={id:'thinking_level',category:'thought_level',type:'select',currentValue:'high',options:[{value:'low'},{value:'high'}]};
if(process.env.RAMU_NO_ASK)session.configOptions[1].options=session.configOptions[1].options.filter(o=>o.value!=='ask');
if(process.env.RAMU_TWO_MODELS)session.configOptions=[{id:'model',category:'model',type:'select',currentValue:'gemini',options:[{value:'gemini',name:'Gemini'},{value:'claude',name:'Claude'}]},levels];
if(process.env.RAMU_LEGACY_MODES){session.configOptions=undefined;session.models={currentModelId:'wire-model',availableModels:[{modelId:'wire-model',name:'Wire model'}]};session.modes={availableModes:[{id:'agent'},{id:'ask'},{id:'auto'},...JSON.parse(process.env.RAMU_EXTRA_MODES||'[]').map(mode=>({id:mode.value}))]};}
rl.on('line',line=>{
 fs.appendFileSync(process.env.RAMU_ACP_LOG,line+'\\n');const m=JSON.parse(line);
 if(!m.method){if(m.id===900||m.id===901)finish();return;}
 if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1,agentCapabilities:{loadSession:!process.env.RAMU_NO_RESUME,...JSON.parse(process.env.RAMU_CAPS||'{}')},...(process.env.RAMU_STEER?{_meta:{steering:{supported:true}}}:{})}});
 if(m.method==='_session/steering')send({id:m.id,result:{outcome:'injected'}});
 if(m.method==='authenticate')send({id:m.id,result:{}});
 if((m.method==='session/load'||m.method==='session/resume')&&process.env.RAMU_LOST){send({id:m.id,error:{code:-32002,message:'Session not found'}});return;}
 if(m.method==='session/new'||m.method==='session/load'||m.method==='session/resume'){
  if(m.method==='session/load' && process.env.RAMU_REPLAY_COMPACTION){
    const update=u=>send({method:'session/update',params:{sessionId:'session-1',update:u}});
    update({sessionUpdate:'usage_update',used:212000,size:258400});
    update({sessionUpdate:'compaction_update',compactionId:'saved-c',status:'in_progress'});
    update({sessionUpdate:'compaction_update',compactionId:'saved-c',status:'completed'});
    update({sessionUpdate:'usage_update',used:33700,size:258400});
  }
  if(m.method==='session/load')send({method:'session/update',params:{sessionId:'session-1',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'historical'}}}});
  send({id:m.id,result:session});
 }
 if(process.env.RAMU_TWO_MODELS&&m.method==='session/set_config_option'&&m.params.configId==='model'){send({id:m.id,result:{configOptions:[session.configOptions[0],...(m.params.value==='gemini'?[levels]:[])]}});return;}
 if(['session/set_config_option','session/set_model','session/set_mode'].includes(m.method))send({id:m.id,result:{}});
 if(m.method==='session/cancel'&&!process.env.RAMU_IGNORE_CANCEL)send({id:promptID,result:{stopReason:'cancelled'}});
 if(m.method==='session/prompt'){
  promptID=m.id;current=m.params.prompt[0].text;
  if(current==='limit'){send({id:m.id,error:{code:-32000,message:'quota exceeded 429'}});return;}
  if(current==='limitreply'){send({method:'session/update',params:{sessionId:'session-1',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:"You've hit your usage limit. Resets at 5pm."}}}});send({id:m.id,result:{stopReason:'end_turn'}});return;}
  if(current==='long')return;
  if(current==='late'){send({id:m.id,result:{stopReason:'end_turn'}});setTimeout(()=>send({method:'session/update',params:{sessionId:'session-1',update:{sessionUpdate:'tool_call',toolCallId:'late1',kind:'read',title:'Read .gitignore',status:'in_progress'}}}),50);setTimeout(()=>send({method:'session/update',params:{sessionId:'session-1',update:{sessionUpdate:'tool_call_update',toolCallId:'late1',status:'completed'}}}),150);return;}
  if(current==='elicit'){send({id:901,method:'elicitation/create',params:{mode:'form',sessionId:'session-1',message:'Pick a name',requestedSchema:{type:'object',properties:{name:{type:'string',title:'Name'}},required:['name']}}});return;}
  if(current==='compact'){
    const update=u=>send({method:'session/update',params:{sessionId:'session-1',update:u}});
    update({sessionUpdate:'usage_update',used:212000,size:258400});
    update({sessionUpdate:'compaction_update',compactionId:'c1',status:'in_progress'});
    update({sessionUpdate:'compaction_summary_chunk',compactionId:'c1',content:{type:'text',text:'Retained context'}});
    update({sessionUpdate:'compaction_update',compactionId:'c1',status:'completed'});
    update({sessionUpdate:'usage_update',used:33700,size:258400});
    finish();return;
  }
  if(current==='tool'){send({id:900,method:'session/request_permission',params:{toolCall:{toolCallId:'t1',kind:'other',...JSON.parse(process.env.RAMU_PERMISSION_CALL||'{}')},options:[{optionId:'yes',kind:'allow_once',name:'Allow'},{optionId:'no',kind:'reject_once',name:'Deny'}]}});return;}
  if(current==='todos'){send({method:'cursor/update_todos',params:{toolCallId:'t9',todos:[{id:'a',content:'Wire todo',status:'in_progress'}],merge:false}});send({id:m.id,result:{stopReason:'end_turn'}});return;}
  for(const text of ['Hello ','world'])send({method:'session/update',params:{sessionId:'session-1',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text}}}});
  if(current==='question')send({id:900,method:'cursor/ask_question',params:{title:'Choice',questions:[{id:'q1',prompt:'Which?',options:[{id:'one',label:'First'}]}]}});
  else if(current==='interaction')send({id:900,method:'session/request_permission',params:{toolCall:{toolCallId:'interaction_1',title:'Which?'},options:[{optionId:'one',name:'First',kind:'allow_once'}]}});
  else if(current==='plan')send({id:900,method:'cursor/create_plan',params:{name:'Plan',plan:'Change one file'}});
  else {send({method:'session/update',params:{sessionId:'session-1',update:{sessionUpdate:'tool_call',toolCallId:'t1',kind:'execute',title:'pwd'}}});send({id:900,method:'session/request_permission',params:{toolCall:{toolCallId:'t1',kind:'execute',title:'pwd'},options:[{optionId:'yes',kind:'allow_once',name:'Allow'},{optionId:'no',kind:'reject_once',name:'Deny'}]}});}
 }
});
`,
  )
  chmodSync(bin, 0o755)
  vi.stubEnv('RAMU_OPENCODE_BIN', bin)
  vi.stubEnv('RAMU_CURSOR_BIN', bin)
  vi.stubEnv('RAMU_ANTIGRAVITY_BIN', bin)
  vi.stubEnv('RAMU_ACP_LOG', join(dir, 'wire'))
})
afterEach(async () => {
  await runner?.stop()
  runner = undefined
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})
const start = async (
  prompt: string,
  provider: 'cursor' | 'antigravity' | 'opencode' = 'cursor',
  access: 'edits' | 'auto' | 'full' = 'edits',
  resume: string | null = null,
  readOnly = false,
  connection?: McpConnection,
) => {
  runner = createAcpRunner(
    { cwd: dir, additionalDirs: [], covers: [dir] },
    { ...DEFAULT_AGENT_SETTINGS, provider, model: 'wire-model', access },
    (e) => events.push(e),
    readOnly,
  )
  if (connection) runner.setTools!(connection)
  await runner.start(prompt, resume)
}
it('discovers advertised models and authenticates Cursor without prompting', async () => {
  expect(await acpModels('cursor')).toEqual([
    { provider: 'cursor', id: 'wire-model', name: 'Wire model', efforts: [], defaultEffort: null, isDefault: true },
  ])
  expect(log().find((m) => m.method === 'authenticate').params).toEqual({ methodId: 'cursor_login' })
})
it('identifies as Zed to Antigravity alone, and reads each Antigravity model’s own thinking levels', async () => {
  vi.stubEnv('RAMU_TWO_MODELS', '1')
  expect(await acpModels('antigravity')).toMatchObject([
    { id: 'gemini', efforts: ['low', 'high'], defaultEffort: 'high', isDefault: true },
    { id: 'claude', efforts: [], defaultEffort: null, isDefault: false },
  ])
  expect(log().find((m) => m.method === 'initialize').params.clientInfo.name).toBe('zed')
  rmSync(join(dir, 'wire'))
  await acpModels('opencode')
  expect(log().find((m) => m.method === 'initialize').params.clientInfo.name).toBe('ramu')
  expect(log().some((m) => m.method === 'session/set_config_option')).toBe(false)
})
it('supports grouped config options and legacy model lists', () => {
  expect(
    acpSessionModels('antigravity', {
      configOptions: [
        {
          category: 'model',
          currentValue: 'm',
          options: [{ group: 'Google', options: [{ value: 'm', name: 'Model' }] }],
        },
      ],
    })[0]?.id,
  ).toBe('m')
  expect(
    acpSessionModels('cursor', {
      models: { currentModelId: 'm', availableModels: [{ modelId: 'm', name: 'Model' }] },
    })[0]?.isDefault,
  ).toBe(true)
})
it('offers only recognised thought levels as reasoning effort', () => {
  const session = {
    models: { currentModelId: 'm', availableModels: [{ modelId: 'm', name: 'Model' }] },
    configOptions: [
      {
        id: 'thinking',
        category: 'thought_level',
        currentValue: 'medium',
        options: [{ value: 'low' }, { value: 'medium' }, { value: 'turbo' }, { value: 'high' }],
      },
    ],
  }
  expect(acpSessionModels('cursor', session)[0]).toMatchObject({
    efforts: ['low', 'medium', 'high'],
    defaultEffort: 'medium',
  })
  expect(acpSessionModels('cursor', { models: session.models })[0]).toMatchObject({ efforts: [], defaultEffort: null })
})
it('streams accumulated text, exposes permission requests and returns provider option IDs', async () => {
  await start('hello')
  await until(() => events.some((e) => e.kind === 'permission-request'))
  expect(events.filter((e) => e.kind === 'text').map((e) => e.text)).toEqual(['Hello ', 'Hello world'])
  runner!.replyPermission('900', false)
  await until(() => events.some((e) => e.kind === 'result'))
  expect(log().find((m) => m.id === 900).result).toEqual({ outcome: { outcome: 'selected', optionId: 'no' } })
})
it.each(['auto', 'full'] as const)(
  'keeps Antigravity interaction questions interactive with %s access',
  async (access) => {
    await start('interaction', 'antigravity', access)
    await until(() => events.some((e) => e.kind === 'question'))
    expect(events.some((e) => e.kind === 'result')).toBe(false)
    expect(log().some((m) => m.method === 'authenticate')).toBe(false)
    runner!.replyQuestion('900', { 'Which?': 'First' })
    await until(() => events.some((e) => e.kind === 'result'))
    expect(log().find((m) => m.id === 900).result.outcome.optionId).toBe('one')
  },
)
it('maps Cursor question answers to their IDs', async () => {
  await start('question')
  await until(() => events.some((e) => e.kind === 'question'))
  runner!.replyQuestion('900', { 'Which?': 'First' })
  await until(() => events.some((e) => e.kind === 'result'))
  expect(log().find((m) => m.id === 900).result).toEqual({
    outcome: 'answered',
    answers: [{ questionId: 'q1', selectedOptionIds: ['one'] }],
  })
})
it('requires explicit plan approval with full access', async () => {
  await start('plan', 'cursor', 'full')
  await until(() => events.some((e) => e.kind === 'permission-request'))
  runner!.replyPermission('900', true)
  await until(() => events.some((e) => e.kind === 'result'))
  expect(log().find((m) => m.id === 900).result).toEqual({ outcome: 'accepted' })
})
it('resumes without replaying historical text as a new answer', async () => {
  await start('hello', 'cursor', 'full', 'session-1')
  await until(() => events.some((e) => e.kind === 'result'))
  expect(
    events
      .filter((e) => e.kind === 'text')
      .map((e) => e.text)
      .join(''),
  ).not.toContain('historical')
  expect(log().some((m) => m.method === 'session/load')).toBe(true)
})
it('refuses unsupported resume rather than silently losing context', async () => {
  vi.stubEnv('RAMU_NO_RESUME', '1')
  await expect(start('hello', 'cursor', 'full', 'old')).rejects.toThrow('does not support resuming')
  expect(log().some((m) => m.method === 'session/new')).toBe(false)
})
it('cancels a running prompt and closes without spurious errors', async () => {
  await start('long')
  await runner!.interrupt()
  expect(events.some((e) => e.kind === 'result' && e.text === 'cancelled')).toBe(true)
  await runner!.stop()
  expect(events.some((e) => e.kind === 'error')).toBe(false)
})
it('uses read-only mode and rejects background tool permissions', async () => {
  await start('hello', 'cursor', 'full', null, true)
  await until(() => events.some((e) => e.kind === 'result'))
  expect(log().some((m) => m.method === 'session/set_config_option' && m.params.value === 'ask')).toBe(true)
  expect(log().find((m) => m.id === 900).result.outcome.optionId).toBe('no')
})
it('runs Antigravity background analysis in its approval mode when it lists no read-only mode, refusing every tool', async () => {
  vi.stubEnv('RAMU_NO_ASK', '1')
  vi.stubEnv(
    'RAMU_EXTRA_MODES',
    JSON.stringify([
      { value: 'default', name: 'Default' },
      { value: 'yolo', name: 'Yolo' },
    ]),
  )
  await start('hello', 'antigravity', 'full', null, true)
  await until(() => events.some((e) => e.kind === 'result'))
  const modes = log().filter((m) => m.method === 'session/set_config_option' && m.params.configId === 'mode')
  expect(modes.map((m) => m.params.value)).toEqual(['default'])
  expect(log().find((m) => m.id === 900).result.outcome.optionId).toBe('no')
  expect(events.some((e) => e.kind === 'error')).toBe(false)
})
it('still refuses background analysis on a runtime with neither a read-only nor an approval mode', async () => {
  vi.stubEnv('RAMU_NO_ASK', '1')
  await expect(start('hello', 'cursor', 'full', null, true)).rejects.toThrow(/read-only mode/)
})
it('passes scoped Ramu MCP connection and image content', async () => {
  const image = join(dir, 'image.png')
  writeFileSync(image, 'image')
  runner = createAcpRunner(
    { cwd: dir, additionalDirs: [], covers: [dir] },
    { ...DEFAULT_AGENT_SETTINGS, access: 'full' as const, provider: 'cursor', model: 'wire-model' },
    (e) => events.push(e),
  )
  runner.setTools!({ url: 'http://localhost:1234/mcp', token: 'test-token' })
  await runner.start('hello', null, [{ id: 'image', path: image, name: 'image.png', size: 5, mimeType: 'image/png' }])
  await until(() => events.some((e) => e.kind === 'result'))
  expect(log().find((m) => m.method === 'session/new').params.mcpServers[0].headers).toEqual([
    { name: 'Authorization', value: 'Bearer test-token' },
  ])
  expect(log().find((m) => m.method === 'session/prompt').params.prompt[1]).toEqual({
    type: 'image',
    mimeType: 'image/png',
    data: Buffer.from('image').toString('base64'),
  })
})

const forkRuntime = (fork: boolean) => {
  const bin = join(dir, 'fork-agent')
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const rl=require('node:readline').createInterface({input:process.stdin});
const send=m=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...m})+'\\n');
rl.on('line',line=>{const m=JSON.parse(line);
 if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1,agentCapabilities:{sessionCapabilities:${fork ? '{fork:{}}' : '{}'}}}});
 if(m.method==='session/fork')send({id:m.id,result:{sessionId:'fork-1'}});
 if(m.method==='session/prompt'){send({method:'session/update',params:{sessionId:'other',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'ignored'}}}});
  for(const text of ['ku','mquat'])send({method:'session/update',params:{sessionId:m.params.sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text}}}});
  send({id:900,method:'session/request_permission',params:{toolCall:{toolCallId:'t'},options:[{optionId:'yes',kind:'allow_once'},{optionId:'no',kind:'reject_once'}]}});
  process.stdin.once('data',()=>send({id:m.id,result:{stopReason:'end_turn'}}))}
});
`,
  )
  chmodSync(bin, 0o755)
  vi.stubEnv('RAMU_OPENCODE_BIN', bin)
}
it('answers a side question on a forked session and refuses its tool requests', async () => {
  forkRuntime(true)
  expect(await acpAside({ provider: 'opencode', cwd: dir, sessionId: 'main', prompt: 'word?' })).toBe('kumquat')
})
it('reports runtimes that cannot fork', async () => {
  forkRuntime(false)
  await expect(acpAside({ provider: 'opencode', cwd: dir, sessionId: 'main', prompt: 'word?' })).rejects.toThrow(
    /cannot fork/,
  )
})

it('steers by cancelling the running turn and continuing with the new message, reporting only one result', async () => {
  await start('long')
  expect(runner!.canSteer).toBe(true)
  await runner!.steer('limit')
  await until(() => events.some((e) => e.kind === 'result'))
  const methods = log()
    .map((m) => m.method)
    .filter((m) => m === 'session/cancel' || m === 'session/prompt')
  expect(methods).toEqual(['session/prompt', 'session/cancel', 'session/prompt'])
  expect(events.filter((e) => e.kind === 'result')).toEqual([
    expect.objectContaining({ isError: true, text: expect.stringContaining('quota') }),
  ])
})
it('gives up on a runtime that ignores cancel instead of hanging steer and interrupt', async () => {
  vi.stubEnv('RAMU_IGNORE_CANCEL', '1')
  vi.stubEnv('RAMU_ACP_CANCEL_WAIT_MS', '100')
  await start('long')
  await expect(runner!.interrupt()).rejects.toThrow(/did not stop/)
  await expect(runner!.steer('limit')).rejects.toThrow(/did not stop/)
})
it('ends an Antigravity turn that stays silent, and continues the session on a fresh runtime', async () => {
  vi.stubEnv('RAMU_ACP_SILENT_TURN_MS', '300')
  await start('long', 'antigravity')
  await until(() => events.some((e) => e.kind === 'result'))
  expect(events.find((e) => e.kind === 'result')).toMatchObject({
    isError: true,
    text: expect.stringContaining('sent nothing for 1 minute'),
  })
  // The next message starts the runtime again and resumes the same session, rather than failing on a closed one.
  await runner!.send('limit')
  await until(() => log().filter((m) => m.method === 'session/load').length === 1)
  expect(log().filter((m) => m.method === 'initialize')).toHaveLength(2)
  expect(log().find((m) => m.method === 'session/load')?.params.sessionId).toBe('session-1')
})
it('keeps a turn waiting on the person past the silence limit', async () => {
  vi.stubEnv('RAMU_ACP_SILENT_TURN_MS', '300')
  await start('tool', 'antigravity')
  await until(() => events.some((e) => e.kind === 'permission-request'))
  await new Promise((r) => setTimeout(r, 900))
  expect(events.some((e) => e.kind === 'result')).toBe(false)
})
it('refuses to steer when no turn is running', async () => {
  await start('limit')
  await until(() => events.some((e) => e.kind === 'result'))
  await expect(runner!.steer('x')).rejects.toThrow(/no running turn/)
})

it('treats a limit notice sent as an ordinary reply as a usage limit so fallback can run', async () => {
  const limits: (boolean | 'low' | undefined)[] = []
  runner = createAcpRunner(
    { cwd: dir, additionalDirs: [], covers: [dir] },
    { ...DEFAULT_AGENT_SETTINGS, provider: 'cursor', model: 'wire-model' },
    (e, limit) => {
      events.push(e)
      if (e.kind === 'result') limits.push(limit)
    },
  )
  await runner.start('limitreply', null)
  await until(() => events.some((e) => e.kind === 'result'))
  expect(events.find((e) => e.kind === 'result')).toMatchObject({
    isError: true,
    text: expect.stringContaining('usage limit'),
  })
  expect(limits).toEqual([true])
  // Recorded as a reading so routing avoids this provider before the next request fails.
  expect(events.find((e) => e.kind === 'usage')).toMatchObject({
    readings: [{ provider: 'cursor', status: 'limited', usedPercent: 100 }],
  })
})
it('reads how long a limit lasts from the notice', () => {
  expect(limitResetsAt('Rate limited. Try again in 2 hours.', 0)).toBe(7_200_000)
  expect(limitResetsAt('429: retry after 30s', 0)).toBe(30_000)
  expect(limitResetsAt('quota exceeded', 0)).toBeUndefined()
})
it('recognises provider limit wording without flagging ordinary answers', () => {
  for (const text of [
    'RESOURCE_EXHAUSTED: quota',
    'Error 429 Too Many Requests',
    'insufficient_quota',
    'You are out of credits',
  ])
    expect(isLimitMessage(text)).toBe(true)
  expect(isLimitMessage('File not found')).toBe(false)
  expect(isLimitReply("You've hit your usage limit. Resets at 5pm.")).toBe(true)
  expect(isLimitReply('Usage limit reached for this model')).toBe(true)
  expect(isLimitReply("You've hit your usage limit.", 1)).toBe(false)
  expect(
    isLimitReply('Rate limiting works by counting requests per window; here is how to add it to your API. '.repeat(10)),
  ).toBe(false)
  expect(isLimitReply('Added a rate limiter to the API.')).toBe(false)
})

const startWith = async (
  prompt: string,
  caps: object,
  {
    resume = null,
    attachments,
    tools,
  }: { resume?: string | null; attachments?: Attachment[]; tools?: McpConnection } = {},
) => {
  vi.stubEnv('RAMU_CAPS', JSON.stringify(caps))
  runner = createAcpRunner(
    { cwd: dir, additionalDirs: [], covers: [dir] },
    { ...DEFAULT_AGENT_SETTINGS, provider: 'cursor', model: 'wire-model', access: 'full' },
    (e) => events.push(e),
  )
  if (tools) runner.setTools?.(tools)
  await runner.start(prompt, resume, attachments)
}
it('resumes with session/resume when the runtime offers it, so no history is replayed', async () => {
  await startWith('hello', { sessionCapabilities: { resume: {} } }, { resume: 'session-1' })
  await until(() => events.some((e) => e.kind === 'result'))
  expect(log().map((m) => m.method)).toContain('session/resume')
  expect(log().map((m) => m.method)).not.toContain('session/load')
})
it('reports a resume the runtime cannot do as recoverable, so the thread can continue from its transcript', async () => {
  vi.stubEnv('RAMU_NO_RESUME', '1')
  await expect(start('hello', 'cursor', 'full', 'old')).rejects.toBeInstanceOf(AcpResumeUnavailable)
  await runner?.stop()
  runner = undefined
  vi.unstubAllEnvs()
  vi.stubEnv('RAMU_CURSOR_BIN', join(dir, 'agent'))
  vi.stubEnv('RAMU_ACP_LOG', join(dir, 'wire'))
  vi.stubEnv('RAMU_LOST', '1')
  await expect(start('hello', 'cursor', 'full', 'gone')).rejects.toBeInstanceOf(AcpResumeUnavailable)
})

it.each([false, true])('plans settings changes using negotiated resume support (%s)', async (resumable) => {
  if (!resumable) vi.stubEnv('RAMU_NO_RESUME', '1')
  await start('hello')
  const target = {
    ...DEFAULT_AGENT_SETTINGS,
    provider: 'cursor' as const,
    model: 'wire-model',
    effort: 'high' as const,
  }
  expect(runner!.planSettingsTransition!(target)).toEqual({ type: resumable ? 'restart-and-resume' : 'handoff' })
  expect(runner!.planSettingsTransition!({ ...target, model: 'missing-model' })).toMatchObject({ type: 'reject' })
  // Preflight itself never closes or mutates the live session.
  expect(log().filter((m) => m.method === 'session/new')).toHaveLength(1)
})
it('sends images only to runtimes that accept them, and otherwise names the saved file', async () => {
  const path = join(dir, 'shot.png')
  writeFileSync(path, 'png')
  const image: Attachment = { id: 'a', name: 'shot.png', size: 3, mimeType: 'image/png', path }
  await startWith('look', { promptCapabilities: { image: false } }, { attachments: [image] })
  await until(() => events.some((e) => e.kind === 'result'))
  const refused = log().find((m) => m.method === 'session/prompt').params.prompt
  expect(refused).toHaveLength(1)
  expect(refused[0].text).toContain(path)
  await runner?.stop()
  runner = undefined
  events = []
  await startWith('look', { promptCapabilities: { image: true } }, { attachments: [image] })
  await until(() => events.some((e) => e.kind === 'result'))
  expect(
    log()
      .filter((m) => m.method === 'session/prompt')
      .at(-1)
      .params.prompt.map((block: { type: string }) => block.type),
  ).toEqual(['text', 'image'])
})
it('still supplies repository stdio MCPs when a runtime cannot connect over HTTP', async () => {
  writeFileSync(
    join(dir, '.mcp.json'),
    JSON.stringify({
      mcpServers: {
        local: { command: 'local-mcp', args: ['--stdio'] },
        remote: { type: 'http', url: 'https://remote.example/mcp' },
      },
    }),
  )
  await startWith(
    'hello',
    { mcpCapabilities: { http: false } },
    { tools: { url: 'http://localhost/mcp', token: 'secret' } },
  )
  expect(log().find((m) => m.method === 'session/new').params.mcpServers).toEqual([
    { name: 'local', command: 'local-mcp', args: ['--stdio'], env: [] },
  ])
  expect(await runner!.mcpStatus!()).toMatchObject({
    live: false,
    source: 'configuration',
    servers: [
      { name: 'local', status: 'configured' },
      { name: 'remote', status: 'unsupported' },
      { name: 'ramu', status: 'unsupported' },
    ],
  })
})

it('does not hand Ramu tools to a runtime that cannot reach HTTP MCP servers, and says so', async () => {
  const tools: McpConnection = { url: 'http://127.0.0.1:1/mcp', token: 'secret' }
  await startWith('hello', { mcpCapabilities: { http: false } }, { tools })
  await until(() => events.some((e) => e.kind === 'result'))
  expect(log().find((m) => m.method === 'session/new').params.mcpServers).toEqual([])
  expect(events.some((e) => e.kind === 'error' && /Ramu's tools/.test(e.message))).toBe(true)
  await runner?.stop()
  runner = undefined
  events = []
  await startWith('hello', { mcpCapabilities: { http: true } }, { tools })
  await until(() => events.some((e) => e.kind === 'result'))
  expect(
    log()
      .filter((m) => m.method === 'session/new')
      .at(-1).params.mcpServers,
  ).toHaveLength(1)
  expect(events.some((e) => e.kind === 'error')).toBe(false)
})

it('turns Cursor todo notifications into a plan during a turn', async () => {
  await start('todos')
  await until(() => events.some((e) => e.kind === 'result'))
  expect(events.find((e) => e.kind === 'plan')).toMatchObject({
    entries: [{ content: 'Wire todo', status: 'in_progress', priority: 'medium' }],
  })
})

it.each(['cursor', 'antigravity'] as const)('negotiates and receives compaction through %s ACP', async (provider) => {
  await start('compact', provider)
  await until(() => events.some((event) => event.kind === 'result'))
  expect(log().find((m) => m.method === 'initialize').params.clientCapabilities.session).toEqual({ compaction: {} })
  expect(events.find((event) => event.kind === 'compaction' && event.state === 'started')).toMatchObject({
    beforeTokens: 212000,
    contextWindow: 258400,
  })
  expect(events.findLast((event) => event.kind === 'compaction')).toMatchObject({
    state: 'completed',
    compactionId: 'c1',
    beforeTokens: 212000,
    afterTokens: 33700,
    contextWindow: 258400,
    summary: [{ type: 'text', text: 'Retained context' }],
  })
})

it('accepts saved compaction and usage during session replay without duplicating historical messages', async () => {
  vi.stubEnv('RAMU_REPLAY_COMPACTION', '1')
  await start('long', 'cursor', 'full', 'session-1')
  expect(events.findLast((event) => event.kind === 'compaction')).toMatchObject({
    compactionId: 'saved-c',
    state: 'completed',
    beforeTokens: 212000,
    afterTokens: 33700,
  })
  expect(events.some((event) => event.kind === 'text' && event.text.includes('historical'))).toBe(false)
})

it('steers into the running turn with _session/steering when the runtime offers it, without cancelling', async () => {
  vi.stubEnv('RAMU_STEER', '1')
  await startWith('long', {})
  await until(() => events.some((e) => e.kind === 'state' && e.state === 'running'))
  expect(runner!.steerInterrupts).toBe(false)
  await runner!.steer('also add tests')
  const wire = log()
  expect(wire.find((m) => m.method === '_session/steering')?.params).toMatchObject({
    sessionId: 'session-1',
    prompt: [{ type: 'text', text: expect.stringContaining('also add tests') }],
  })
  expect(wire.some((m) => m.method === 'session/cancel')).toBe(false)
  expect(events.some((e) => e.kind === 'result')).toBe(false)
})
it('cancels and restarts the turn to steer a runtime without _session/steering', async () => {
  await startWith('long', {})
  await until(() => events.some((e) => e.kind === 'state' && e.state === 'running'))
  expect(runner!.steerInterrupts).toBe(true)
})

const ramuConnection = { url: 'http://127.0.0.1:1/mcp', token: 'test' }
it.each([
  ['cursor', { rawInput: { _toolName: 'mcp__ramu__tool_invoke' } }],
  ['opencode', { name: 'ramu_memory_search' }],
  ['antigravity', { _meta: { claudeCode: { toolName: 'mcp__ramu__schedule_create' } } }],
  ['antigravity', { title: 'Run mcp_ramu_tool_invoke?' }],
] as const)('Auto approves qualified Ramu calls from %s', async (provider, call) => {
  vi.stubEnv('RAMU_PERMISSION_CALL', JSON.stringify(call))
  await start('tool', provider, 'auto', null, false, ramuConnection)
  await until(() => events.some((event) => event.kind === 'result'))
  expect(
    events.some(
      (event) => event.kind === 'permission-request' || (event.kind === 'state' && event.state === 'needs-input'),
    ),
  ).toBe(false)
  expect(log().find((message) => message.id === 900).result.outcome.optionId).toBe('yes')
})

it.each([
  { name: 'mcp__external__tool_invoke' },
  { name: 'mcp__ramu_other__tool_invoke' },
  { name: 'ramu_other_tool' },
  { name: 'Bash', title: 'Run mcp_ramu_tool_invoke?' },
  { kind: 'execute', title: 'Run mcp_ramu_tool_invoke?', rawInput: { command: 'echo hello' } },
  { title: 'Read a file with mcp_ramu_tool_invoke' },
])('Auto leaves non-Ramu permission requests interactive: %j', async (call) => {
  vi.stubEnv('RAMU_PERMISSION_CALL', JSON.stringify(call))
  await start('tool', 'antigravity', 'auto', null, false, ramuConnection)
  await until(() => events.some((event) => event.kind === 'permission-request'))
  expect(log().some((message) => message.id === 900)).toBe(false)
  runner!.replyPermission('900', false)
  await until(() => events.some((event) => event.kind === 'result'))
})

it.each([
  ['antigravity', { title: 'Run mcp_ramu_ask_user?' }],
  ['antigravity', { name: 'mcp_shared_mcp_Linear-abc123__list_issues' }],
  ['cursor', { rawInput: { _toolName: 'mcp__ramu__tool_invoke', name: 'browser_click', arguments: {} } }],
  ['cursor', { rawInput: { _toolName: 'mcp__ramu__run_script', code: 'return 1' } }],
] as const)('Allow edits answers calls Ramu decides itself from %s: %j', async (provider, call) => {
  vi.stubEnv('RAMU_PERMISSION_CALL', JSON.stringify(call))
  await start('tool', provider, 'edits', null, false, ramuConnection)
  await until(() => events.some((event) => event.kind === 'result'))
  expect(events.some((event) => event.kind === 'permission-request')).toBe(false)
  expect(log().find((message) => message.id === 900).result.outcome.optionId).toBe('yes')
})

it.each([
  { _meta: { claudeCode: { toolName: 'mcp__ramu__schedule_create' } } },
  { rawInput: { _toolName: 'mcp__ramu__tool_invoke', name: 'schedule_create', arguments: {} } },
  { name: 'mcp__external__ask_user' },
  { kind: 'execute', title: 'Run mcp_ramu_ask_user?', rawInput: { command: 'echo hello' } },
])('Allow edits still asks for Ramu changes and other tools: %j', async (call) => {
  vi.stubEnv('RAMU_PERMISSION_CALL', JSON.stringify(call))
  await start('tool', 'antigravity', 'edits', null, false, ramuConnection)
  await until(() => events.some((event) => event.kind === 'permission-request'))
  expect(log().some((message) => message.id === 900)).toBe(false)
  runner!.replyPermission('900', false)
  await until(() => events.some((event) => event.kind === 'result'))
})

it.each([false, true])('selects advertised native Auto in Antigravity (legacy modes: %s)', async (legacy) => {
  vi.stubEnv('RAMU_EXTRA_MODES', JSON.stringify([{ value: 'auto', name: 'Auto' }]))
  if (legacy) vi.stubEnv('RAMU_LEGACY_MODES', '1')
  await start('hello', 'antigravity', 'auto')
  await until(() => events.some((event) => event.kind === 'permission-request'))
  expect(log()).toContainEqual(
    expect.objectContaining({
      method: legacy ? 'session/set_mode' : 'session/set_config_option',
      params: legacy
        ? { sessionId: 'session-1', modeId: 'auto' }
        : { sessionId: 'session-1', configId: 'mode', value: 'auto' },
    }),
  )
  // Native Auto can still request a decision; Ramu does not turn that into Full access.
  expect(log().some((message) => message.id === 900)).toBe(false)
  runner!.replyPermission('900', true)
  await until(() => events.some((event) => event.kind === 'result'))
})

it('does not invent Auto support or select it in read-only analysis', async () => {
  await start('hello', 'antigravity', 'auto')
  await until(() => events.some((event) => event.kind === 'permission-request'))
  expect(log().some((message) => message.params?.value === 'auto' || message.params?.modeId === 'auto')).toBe(false)
  runner!.replyPermission('900', false)
  await until(() => events.some((event) => event.kind === 'result'))
  await runner!.stop()
  vi.stubEnv('RAMU_EXTRA_MODES', JSON.stringify([{ value: 'auto', name: 'Auto' }]))
  events = []
  await start('hello', 'antigravity', 'auto', null, true)
  await until(() => events.some((event) => event.kind === 'result'))
  expect(log().some((message) => message.params?.value === 'auto')).toBe(false)
  expect(log().findLast((message) => message.id === 900).result.outcome.optionId).toBe('no')
})

it('does not trust a Ramu-looking call without the app-owned server connection', async () => {
  vi.stubEnv('RAMU_PERMISSION_CALL', JSON.stringify({ name: 'ramu_tool_invoke' }))
  await start('tool', 'antigravity', 'auto')
  await until(() => events.some((event) => event.kind === 'permission-request'))
  runner!.replyPermission('900', false)
  await until(() => events.some((event) => event.kind === 'result'))
})

it.each(['command', 'CommandLine'])('exposes the actual %s command for reusable approvals', async (field) => {
  vi.stubEnv('RAMU_PERMISSION_CALL', JSON.stringify({ kind: 'execute', rawInput: { [field]: 'git diff --stat' } }))
  await start('tool', 'antigravity', 'auto')
  await until(() => events.some((event) => event.kind === 'permission-request'))
  expect(events.find((event) => event.kind === 'permission-request')).toMatchObject({
    approvalCommand: 'git diff --stat',
    approvalKey: expect.any(String),
  })
  runner!.replyPermission('900', false)
  await until(() => events.some((event) => event.kind === 'result'))
})

it.each([false, true])('selects native Antigravity edit mode on resume (legacy: %s)', async (legacy) => {
  vi.stubEnv(
    'RAMU_EXTRA_MODES',
    JSON.stringify([
      { value: 'auto_edit', name: 'Auto Edit' },
      { value: 'yolo', name: 'YOLO' },
    ]),
  )
  if (legacy) vi.stubEnv('RAMU_LEGACY_MODES', '1')
  await start('hello', 'antigravity', 'edits', 'session-1')
  await until(() => events.some((event) => event.kind === 'permission-request'))
  expect(log()).toContainEqual(
    expect.objectContaining({
      method: legacy ? 'session/set_mode' : 'session/set_config_option',
      params: legacy
        ? { sessionId: 'session-1', modeId: 'auto_edit' }
        : { sessionId: 'session-1', configId: 'mode', value: 'auto_edit' },
    }),
  )
  expect(log().some((message) => message.params?.value === 'yolo' || message.params?.modeId === 'yolo')).toBe(false)
  runner!.replyPermission('900', false)
  await until(() => events.some((event) => event.kind === 'result'))
})

it('does not select native edit mode in restricted threads', async () => {
  vi.stubEnv('RAMU_EXTRA_MODES', JSON.stringify([{ value: 'auto_edit', name: 'Auto Edit' }]))
  await start('tool', 'antigravity', 'edits', null, false, { ...ramuConnection, restricted: true })
  await until(() => events.some((event) => event.kind === 'result'))
  expect(log().some((message) => message.params?.value === 'auto_edit')).toBe(false)
  expect(log().find((message) => message.id === 900).result.outcome.optionId).toBe('no')
})

it.each([
  ['pnpm test', false],
  ['rm -rf ~/notes', true],
] as const)(
  'runs Antigravity Full access in auto_edit and asks only before a dangerous command: %s',
  async (command, asks) => {
    vi.stubEnv(
      'RAMU_EXTRA_MODES',
      JSON.stringify([
        { value: 'auto_edit', name: 'Auto Edit' },
        { value: 'yolo', name: 'YOLO' },
      ]),
    )
    vi.stubEnv('RAMU_PERMISSION_CALL', JSON.stringify({ kind: 'execute', rawInput: { command } }))
    await start('tool', 'antigravity', 'full')
    if (asks) {
      await until(() => events.some((event) => event.kind === 'permission-request'))
      expect(events.find((event) => event.kind === 'permission-request')).toMatchObject({
        approvalOnceOnly: true,
        approvalFullAccess: { reason: expect.stringContaining('outside this thread') },
      })
      runner!.replyPermission('900', false)
    }
    await until(() => events.some((event) => event.kind === 'result'))
    expect(log().find((message) => message.id === 900).result.outcome.optionId).toBe(asks ? 'no' : 'yes')
    expect(log().some((message) => message.params?.value === 'yolo')).toBe(false)
    expect(log().some((message) => message.params?.value === 'auto_edit')).toBe(true)
  },
)

it('uses auto_edit for Antigravity Auto while keeping commands in the client approval flow', async () => {
  vi.stubEnv(
    'RAMU_EXTRA_MODES',
    JSON.stringify([
      { value: 'auto_edit', name: 'Auto Edit' },
      { value: 'yolo', name: 'YOLO' },
    ]),
  )
  vi.stubEnv('RAMU_PERMISSION_CALL', JSON.stringify({ kind: 'execute', rawInput: { CommandLine: 'git diff' } }))
  await start('tool', 'antigravity', 'auto')
  await until(() => events.some((event) => event.kind === 'permission-request'))
  expect(log()).toContainEqual(
    expect.objectContaining({
      method: 'session/set_config_option',
      params: { sessionId: 'session-1', configId: 'mode', value: 'auto_edit' },
    }),
  )
  expect(log().some((message) => message.params?.value === 'yolo')).toBe(false)
  runner!.replyPermission('900', true)
  await until(() => events.some((event) => event.kind === 'result'))
})

it('keeps a turn running while the runtime keeps working after its reply, then settles', async () => {
  await start('late', 'antigravity')
  const states = () => events.filter((e) => e.kind === 'state').map((e) => (e as { state: string }).state)
  await until(() => events.some((e) => e.kind === 'result'))
  // The reply came first; the tool call after it puts the turn back to running.
  await until(() => states().filter((state) => state === 'running').length >= 2)
  expect(events.some((e) => e.kind === 'tool-use')).toBe(true)
  const started = Date.now()
  while (!states().includes('idle') && Date.now() - started < 8000) await new Promise((r) => setTimeout(r, 50))
  expect(states().at(-1)).toBe('idle')
}, 15000)

it("records a turn's tokens when the runtime sends ACP usage, with cached reads as input, and nothing otherwise", () => {
  expect(acpTurnTokens({ totalTokens: 1500, inputTokens: 1000, outputTokens: 300, cachedReadTokens: 200 })).toEqual({
    input: 1200,
    output: 300,
  })
  expect(acpTurnTokens({ inputTokens: 10, outputTokens: 2, cachedReadTokens: null })).toEqual({ input: 10, output: 2 })
  expect(acpTurnTokens(undefined)).toBeNull()
  expect(acpTurnTokens({ inputTokens: -1, outputTokens: 2 })).toBeNull()
  expect(acpTurnTokens({ outputTokens: 2 })).toBeNull()
})
