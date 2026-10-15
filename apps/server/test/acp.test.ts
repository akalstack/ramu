import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { isLimitMessage, isLimitReply, limitResetsAt } from '../src/usageLimit'
import { acpAside, openCodeConfigEnv, acpModels, acpSessionModels, createAcpRunner, AcpResumeUnavailable } from '../src/acp'
import { DEFAULT_AGENT_SETTINGS, type AgentEvent, type Attachment, type McpConnection } from '@ramu/shared/types'

let dir: string
let events: AgentEvent[]
let runner: ReturnType<typeof createAcpRunner> | undefined
const until = async (condition: () => boolean) => { const started = Date.now(); while (!condition()) { if (Date.now() - started > 5000) throw new Error('Timed out'); await new Promise((r) => setTimeout(r, 10)) } }
const log = () => readFileSync(join(dir, 'wire'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ramu-acp-')); events = []
  const bin = join(dir, 'agent')
  writeFileSync(bin, `#!/usr/bin/env node
const fs=require('node:fs'); const rl=require('node:readline').createInterface({input:process.stdin});
const send=m=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...m})+'\\n');
let promptID; let current='';
const finish=()=>send({id:promptID,result:{stopReason:'end_turn'}});
const session={sessionId:'session-1',configOptions:[{id:'model',category:'model',type:'select',currentValue:'wire-model',options:[{value:'wire-model',name:'Wire model'}]},{id:'mode',category:'mode',type:'select',currentValue:'agent',options:[{value:'agent',name:'Agent'},{value:'ask',name:'Ask'}]}]};
rl.on('line',line=>{
 fs.appendFileSync(process.env.RAMU_ACP_LOG,line+'\\n');const m=JSON.parse(line);
 if(!m.method){if(m.id===900)finish();return;}
 if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1,agentCapabilities:{loadSession:!process.env.RAMU_NO_RESUME,...JSON.parse(process.env.RAMU_CAPS||'{}')}}});
 if(m.method==='authenticate')send({id:m.id,result:{}});
 if((m.method==='session/load'||m.method==='session/resume')&&process.env.RAMU_LOST){send({id:m.id,error:{code:-32002,message:'Session not found'}});return;}
 if(m.method==='session/new'||m.method==='session/load'||m.method==='session/resume'){
  if(m.method==='session/load')send({method:'session/update',params:{sessionId:'session-1',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'historical'}}}});
  send({id:m.id,result:session});
 }
 if(m.method==='session/set_config_option')send({id:m.id,result:{}});
 if(m.method==='session/cancel')send({id:promptID,result:{stopReason:'cancelled'}});
 if(m.method==='session/prompt'){
  promptID=m.id;current=m.params.prompt[0].text;
  if(current==='limit'){send({id:m.id,error:{code:-32000,message:'quota exceeded 429'}});return;}
  if(current==='limitreply'){send({method:'session/update',params:{sessionId:'session-1',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:"You've hit your usage limit. Resets at 5pm."}}}});send({id:m.id,result:{stopReason:'end_turn'}});return;}
  if(current==='long')return;
  if(current==='todos'){send({method:'cursor/update_todos',params:{toolCallId:'t9',todos:[{id:'a',content:'Wire todo',status:'in_progress'}],merge:false}});send({id:m.id,result:{stopReason:'end_turn'}});return;}
  for(const text of ['Hello ','world'])send({method:'session/update',params:{sessionId:'session-1',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text}}}});
  if(current==='question')send({id:900,method:'cursor/ask_question',params:{title:'Choice',questions:[{id:'q1',prompt:'Which?',options:[{id:'one',label:'First'}]}]}});
  else if(current==='interaction')send({id:900,method:'session/request_permission',params:{toolCall:{toolCallId:'interaction_1',title:'Which?'},options:[{optionId:'one',name:'First',kind:'allow_once'}]}});
  else if(current==='plan')send({id:900,method:'cursor/create_plan',params:{name:'Plan',plan:'Change one file'}});
  else {send({method:'session/update',params:{sessionId:'session-1',update:{sessionUpdate:'tool_call',toolCallId:'t1',kind:'execute',title:'pwd'}}});send({id:900,method:'session/request_permission',params:{toolCall:{toolCallId:'t1',kind:'execute',title:'pwd'},options:[{optionId:'yes',kind:'allow_once',name:'Allow'},{optionId:'no',kind:'reject_once',name:'Deny'}]}});}
 }
});
`)
  chmodSync(bin, 0o755)
  vi.stubEnv('RAMU_CURSOR_BIN', bin); vi.stubEnv('RAMU_ANTIGRAVITY_BIN', bin); vi.stubEnv('RAMU_ACP_LOG', join(dir, 'wire'))
})
afterEach(async () => { await runner?.stop(); runner = undefined; vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }) })
const start = async (prompt: string, provider: 'cursor' | 'antigravity' = 'cursor', access: 'edits' | 'full' = 'edits', resume: string | null = null, readOnly = false) => {
  runner = createAcpRunner({ cwd: dir, additionalDirs: [], covers: [dir] }, { ...DEFAULT_AGENT_SETTINGS, provider, model: 'wire-model', access }, (e) => events.push(e), readOnly)
  await runner.start(prompt, resume)
}
it('discovers advertised models and authenticates Cursor without prompting', async () => {
  expect(await acpModels('cursor')).toEqual([{ provider: 'cursor', id: 'wire-model', name: 'Wire model', efforts: [], defaultEffort: null, isDefault: true }])
  expect(log().find((m) => m.method === 'authenticate').params).toEqual({ methodId: 'cursor_login' })
})
it('supports grouped config options and legacy model lists', () => {
  expect(acpSessionModels('antigravity', { configOptions: [{ category: 'model', currentValue: 'm', options: [{ group: 'Google', options: [{ value: 'm', name: 'Model' }] }] }] })[0]?.id).toBe('m')
  expect(acpSessionModels('cursor', { models: { currentModelId: 'm', availableModels: [{ modelId: 'm', name: 'Model' }] } })[0]?.isDefault).toBe(true)
})
it('offers only recognised thought levels as reasoning effort', () => {
  const session = { models: { currentModelId: 'm', availableModels: [{ modelId: 'm', name: 'Model' }] }, configOptions: [{ id: 'thinking', category: 'thought_level', currentValue: 'medium', options: [{ value: 'low' }, { value: 'medium' }, { value: 'turbo' }, { value: 'high' }] }] }
  expect(acpSessionModels('cursor', session)[0]).toMatchObject({ efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' })
  expect(acpSessionModels('cursor', { models: session.models })[0]).toMatchObject({ efforts: [], defaultEffort: null })
})
it('streams accumulated text, exposes permission requests and returns provider option IDs', async () => {
  await start('hello'); await until(() => events.some((e) => e.kind === 'permission-request'))
  expect(events.filter((e) => e.kind === 'text').map((e) => e.text)).toEqual(['Hello ', 'Hello world'])
  runner!.replyPermission('900', false)
  await until(() => events.some((e) => e.kind === 'result'))
  expect(log().find((m) => m.id === 900).result).toEqual({ outcome: { outcome: 'selected', optionId: 'no' } })
})
it('keeps Antigravity interaction questions interactive even with full access', async () => {
  await start('interaction', 'antigravity', 'full'); await until(() => events.some((e) => e.kind === 'question'))
  expect(events.some((e) => e.kind === 'result')).toBe(false)
  expect(log().some((m) => m.method === 'authenticate')).toBe(false)
  runner!.replyQuestion('900', { 'Which?': 'First' }); await until(() => events.some((e) => e.kind === 'result'))
  expect(log().find((m) => m.id === 900).result.outcome.optionId).toBe('one')
})
it('maps Cursor question answers to their IDs', async () => {
  await start('question'); await until(() => events.some((e) => e.kind === 'question'))
  runner!.replyQuestion('900', { 'Which?': 'First' }); await until(() => events.some((e) => e.kind === 'result'))
  expect(log().find((m) => m.id === 900).result).toEqual({ outcome: 'answered', answers: [{ questionId: 'q1', selectedOptionIds: ['one'] }] })
})
it('requires explicit plan approval with full access', async () => {
  await start('plan', 'cursor', 'full'); await until(() => events.some((e) => e.kind === 'permission-request'))
  runner!.replyPermission('900', true); await until(() => events.some((e) => e.kind === 'result'))
  expect(log().find((m) => m.id === 900).result).toEqual({ outcome: 'accepted' })
})
it('resumes without replaying historical text as a new answer', async () => {
  await start('hello', 'cursor', 'full', 'session-1'); await until(() => events.some((e) => e.kind === 'result'))
  expect(events.filter((e) => e.kind === 'text').map((e) => e.text).join('')).not.toContain('historical')
  expect(log().some((m) => m.method === 'session/load')).toBe(true)
})
it('refuses unsupported resume rather than silently losing context', async () => {
  vi.stubEnv('RAMU_NO_RESUME', '1')
  await expect(start('hello', 'cursor', 'full', 'old')).rejects.toThrow('does not support resuming')
  expect(log().some((m) => m.method === 'session/new')).toBe(false)
})
it('cancels a running prompt and closes without spurious errors', async () => {
  await start('long'); await runner!.interrupt()
  expect(events.some((e) => e.kind === 'result' && e.text === 'cancelled')).toBe(true)
  await runner!.stop(); expect(events.some((e) => e.kind === 'error')).toBe(false)
})
it('uses read-only mode and rejects background tool permissions', async () => {
  await start('hello', 'cursor', 'full', null, true); await until(() => events.some((e) => e.kind === 'result'))
  expect(log().some((m) => m.method === 'session/set_config_option' && m.params.value === 'ask')).toBe(true)
  expect(log().find((m) => m.id === 900).result.outcome.optionId).toBe('no')
})
it('passes scoped Ramu MCP connection and image content', async () => {
  const image = join(dir, 'image.png'); writeFileSync(image, 'image')
  runner = createAcpRunner({ cwd: dir, additionalDirs: [], covers: [dir] }, { ...DEFAULT_AGENT_SETTINGS, access: 'full' as const, provider: 'cursor', model: 'wire-model' }, (e) => events.push(e))
  runner.setTools!({ url: 'http://localhost:1234/mcp', token: 'test-token' })
  await runner.start('hello', null, [{ id: 'image', path: image, name: 'image.png', size: 5, mimeType: 'image/png' }])
  await until(() => events.some((e) => e.kind === 'result'))
  expect(log().find((m) => m.method === 'session/new').params.mcpServers[0].headers).toEqual([{ name: 'Authorization', value: 'Bearer test-token' }])
  expect(log().find((m) => m.method === 'session/prompt').params.prompt[1]).toEqual({ type: 'image', mimeType: 'image/png', data: Buffer.from('image').toString('base64') })
})

const forkRuntime = (fork: boolean) => {
  const bin = join(dir, 'fork-agent')
  writeFileSync(bin, `#!/usr/bin/env node
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
`)
  chmodSync(bin, 0o755); vi.stubEnv('RAMU_OPENCODE_BIN', bin)
}
it('answers a side question on a forked session and refuses its tool requests', async () => {
  forkRuntime(true)
  expect(await acpAside({ provider: 'opencode', cwd: dir, sessionId: 'main', prompt: 'word?' })).toBe('kumquat')
})
it('reports runtimes that cannot fork', async () => {
  forkRuntime(false)
  await expect(acpAside({ provider: 'opencode', cwd: dir, sessionId: 'main', prompt: 'word?' })).rejects.toThrow(/cannot fork/)
})

it('denies OpenCode\'s native sub-agent tool only when Ramu routes sub-agents, keeping existing config', () => {
  const connection = { url: 'http://127.0.0.1:1/mcp', token: 't' }
  expect(openCodeConfigEnv(connection, undefined)).toEqual({})
  expect(openCodeConfigEnv({ ...connection, nativeSubagents: false }, undefined)).toEqual({ OPENCODE_CONFIG_CONTENT: '{"permission":{"task":"deny"}}' })
  expect(JSON.parse(openCodeConfigEnv({ ...connection, nativeSubagents: false }, '{"model":"a/b","permission":{"bash":"ask"}}').OPENCODE_CONFIG_CONTENT!)).toEqual({ model: 'a/b', permission: { bash: 'ask', task: 'deny' } })
  expect(openCodeConfigEnv({ ...connection, nativeSubagents: false }, 'not json')).toEqual({})
})

it('steers by cancelling the running turn and continuing with the new message, reporting only one result', async () => {
  await start('long')
  expect(runner!.canSteer).toBe(true)
  await runner!.steer('limit')
  await until(() => events.some((e) => e.kind === 'result'))
  const methods = log().map((m) => m.method).filter((m) => m === 'session/cancel' || m === 'session/prompt')
  expect(methods).toEqual(['session/prompt', 'session/cancel', 'session/prompt'])
  expect(events.filter((e) => e.kind === 'result')).toEqual([expect.objectContaining({ isError: true, text: expect.stringContaining('quota') })])
})
it('refuses to steer when no turn is running', async () => {
  await start('limit'); await until(() => events.some((e) => e.kind === 'result'))
  await expect(runner!.steer('x')).rejects.toThrow(/no running turn/)
})

it('treats a limit notice sent as an ordinary reply as a usage limit so fallback can run', async () => {
  const limits: (boolean | undefined)[] = []
  runner = createAcpRunner({ cwd: dir, additionalDirs: [], covers: [dir] }, { ...DEFAULT_AGENT_SETTINGS, provider: 'cursor', model: 'wire-model' }, (e, limit) => { events.push(e); if (e.kind === 'result') limits.push(limit) })
  await runner.start('limitreply', null)
  await until(() => events.some((e) => e.kind === 'result'))
  expect(events.find((e) => e.kind === 'result')).toMatchObject({ isError: true, text: expect.stringContaining('usage limit') })
  expect(limits).toEqual([true])
  // Recorded as a reading so routing avoids this provider before the next request fails.
  expect(events.find((e) => e.kind === 'usage')).toMatchObject({ readings: [{ provider: 'cursor', status: 'limited', usedPercent: 100 }] })
})
it('reads how long a limit lasts from the notice', () => {
  expect(limitResetsAt('Rate limited. Try again in 2 hours.', 0)).toBe(7_200_000)
  expect(limitResetsAt('429: retry after 30s', 0)).toBe(30_000)
  expect(limitResetsAt('quota exceeded', 0)).toBeUndefined()
})
it('recognises provider limit wording without flagging ordinary answers', () => {
  for (const text of ['RESOURCE_EXHAUSTED: quota', 'Error 429 Too Many Requests', 'insufficient_quota', 'You are out of credits']) expect(isLimitMessage(text)).toBe(true)
  expect(isLimitMessage('File not found')).toBe(false)
  expect(isLimitReply("You've hit your usage limit. Resets at 5pm.")).toBe(true)
  expect(isLimitReply('Usage limit reached for this model')).toBe(true)
  expect(isLimitReply("You've hit your usage limit.", 1)).toBe(false)
  expect(isLimitReply('Rate limiting works by counting requests per window; here is how to add it to your API. '.repeat(10))).toBe(false)
  expect(isLimitReply('Added a rate limiter to the API.')).toBe(false)
})

const startWith = async (prompt: string, caps: object, { resume = null, attachments, tools }: { resume?: string | null; attachments?: Attachment[]; tools?: McpConnection } = {}) => {
  vi.stubEnv('RAMU_CAPS', JSON.stringify(caps))
  runner = createAcpRunner({ cwd: dir, additionalDirs: [], covers: [dir] }, { ...DEFAULT_AGENT_SETTINGS, provider: 'cursor', model: 'wire-model', access: 'full' }, (e) => events.push(e))
  if (tools) runner.setTools?.(tools)
  await runner.start(prompt, resume, attachments)
}
it('resumes with session/resume when the runtime offers it, so no history is replayed', async () => {
  await startWith('hello', { sessionCapabilities: { resume: {} } }, { resume: 'session-1' }); await until(() => events.some((e) => e.kind === 'result'))
  expect(log().map((m) => m.method)).toContain('session/resume')
  expect(log().map((m) => m.method)).not.toContain('session/load')
})
it('reports a resume the runtime cannot do as recoverable, so the chat can continue from its transcript', async () => {
  vi.stubEnv('RAMU_NO_RESUME', '1')
  await expect(start('hello', 'cursor', 'full', 'old')).rejects.toBeInstanceOf(AcpResumeUnavailable)
  await runner?.stop(); runner = undefined
  vi.unstubAllEnvs(); vi.stubEnv('RAMU_CURSOR_BIN', join(dir, 'agent')); vi.stubEnv('RAMU_ACP_LOG', join(dir, 'wire')); vi.stubEnv('RAMU_LOST', '1')
  await expect(start('hello', 'cursor', 'full', 'gone')).rejects.toBeInstanceOf(AcpResumeUnavailable)
})
it('sends images only to runtimes that accept them, and otherwise names the saved file', async () => {
  const path = join(dir, 'shot.png'); writeFileSync(path, 'png')
  const image: Attachment = { id: 'a', name: 'shot.png', size: 3, mimeType: 'image/png', path }
  await startWith('look', { promptCapabilities: { image: false } }, { attachments: [image] }); await until(() => events.some((e) => e.kind === 'result'))
  const refused = log().find((m) => m.method === 'session/prompt').params.prompt
  expect(refused).toHaveLength(1)
  expect(refused[0].text).toContain(path)
  await runner?.stop(); runner = undefined; events = []
  await startWith('look', { promptCapabilities: { image: true } }, { attachments: [image] }); await until(() => events.some((e) => e.kind === 'result'))
  expect(log().filter((m) => m.method === 'session/prompt').at(-1).params.prompt.map((block: { type: string }) => block.type)).toEqual(['text', 'image'])
})
it('does not hand Ramu tools to a runtime that cannot reach HTTP MCP servers, and says so', async () => {
  const tools: McpConnection = { url: 'http://127.0.0.1:1/mcp', token: 'secret' }
  await startWith('hello', { mcpCapabilities: { http: false } }, { tools }); await until(() => events.some((e) => e.kind === 'result'))
  expect(log().find((m) => m.method === 'session/new').params.mcpServers).toEqual([])
  expect(events.some((e) => e.kind === 'error' && /Ramu's tools/.test(e.message))).toBe(true)
  await runner?.stop(); runner = undefined; events = []
  await startWith('hello', { mcpCapabilities: { http: true } }, { tools }); await until(() => events.some((e) => e.kind === 'result'))
  expect(log().filter((m) => m.method === 'session/new').at(-1).params.mcpServers).toHaveLength(1)
  expect(events.some((e) => e.kind === 'error')).toBe(false)
})

it('turns Cursor todo notifications into a plan during a turn', async () => {
  await start('todos'); await until(() => events.some((e) => e.kind === 'result'))
  expect(events.find((e) => e.kind === 'plan')).toMatchObject({ entries: [{ content: 'Wire todo', status: 'in_progress', priority: 'medium' }] })
})
