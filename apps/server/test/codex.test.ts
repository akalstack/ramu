import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { addTokens } from '../src/providers/turnTokens'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  codexContext,
  codexLast,
  createCodexRunner,
  codexModels,
  codexReadings,
  codexHelperHistory,
  codexAside,
  toolOfOtherItem,
} from '../src/providers/codex'
import { SessionInUse } from '../src/agent/agentRunner'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { DEFAULT_AGENT_SETTINGS, type AgentEvent } from '@ramu/shared/types'

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
  if (m.method === 'mcpServerStatus/list') send({id:m.id,result:{data:m.params.cursor ? [{name:'needs-login',runtimeStatus:'authenticationRequired',authStatus:'notLoggedIn',tools:{}}] : [{name:'connected',runtimeStatus:'connected',authStatus:'oAuth',tools:{jira:{name:'jira'}}},{name:'cached',runtimeStatus:null,authStatus:'oAuth',tools:{cachedTool:{name:'cached'}}}],nextCursor:m.params.cursor ? null : 'second-page'}});
  if (m.method === 'config/mcpServer/reload') send({id:m.id,result:{}});
  if (m.method === 'model/list') send({id:m.id,result:{data:[{model:'codex-wire',displayName:'Codex wire',hidden:false,isLegacy:true,supportedReasoningEfforts:[{reasoningEffort:'low'},{reasoningEffort:'high'}],defaultReasoningEffort:'low',isDefault:true}],nextCursor:null}});
  if (m.method === 'thread/resume' && m.params.threadId === 'busy-thread') { send({id:m.id,error:{code:-32600,message:'thread busy-thread already has an active writer'}}); return; }
  if (m.method === 'thread/fork' && m.params.threadId === 'archived-thread' && !globalThis.unarchived) { send({id:m.id,error:{code:-32600,message:'session archived-thread is archived. Run \\\`codex unarchive archived-thread\\\` to unarchive it first.'}}); return; }
  if (m.method === 'thread/unarchive') { globalThis.unarchived = true; send({id:m.id,result:{}}); return; }
  if (m.method === 'thread/fork') send({id:m.id,result:{thread:{id:'fork-1'}}});
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
    if (text === 'full gate') {
      send({id:910,method:'item/commandExecution/requestApproval',params:{threadId:'thread-1',command:'pnpm test'}});
      send({id:911,method:'mcpServer/elicitation/request',params:{threadId:'thread-1',serverName:'ramu',mode:'form',message:'Allow tool?',requestedSchema:{type:'object',properties:{}},_meta:{codex_approval_kind:'mcp_tool_call'}}});
      send({id:912,method:'item/commandExecution/requestApproval',params:{threadId:'thread-1',command:['bash','-lc','rm -rf ~/notes']}});
      return;
    }
    if (text === 'dynamic call') {
      send({method:'item/started',params:{threadId:'thread-1',item:{type:'dynamicToolCall',id:'dyn-1',namespace:'ramu',tool:'ask_user',arguments:{question:'Ship it?'},status:'inProgress',contentItems:null,success:null}}});
      send({id:930,method:'item/tool/call',params:{threadId:'thread-1',turnId:'turn-1',callId:'dyn-1',namespace:'ramu',tool:'ask_user',arguments:{question:'Ship it?'}}});
      return;
    }
    if (text === 'edits gate') {
      const ask = (id, serverName, tool_name, tool_params) => send({id,method:'mcpServer/elicitation/request',params:{threadId:'thread-1',serverName,mode:'form',message:'Allow tool?',requestedSchema:{type:'object',properties:{}},_meta:{codex_approval_kind:'mcp_tool_call',tool_name,tool_params}}});
      ask(921, 'ramu', 'ask_user', {});
      ask(922, 'shared_mcp', 'Linear-abc123__list_issues', {});
      ask(923, 'ramu', 'tool_invoke', {name:'browser_click',arguments:{}});
      ask(924, 'ramu', 'schedule_create', {});
      ask(925, 'github', 'create_issue', {});
      return;
    }
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
  it('says a thread open in another Codex client is in use, rather than starting a new one', async () => {
    const runner = createCodexRunner(scope, { ...DEFAULT_AGENT_SETTINGS, provider: 'codex' }, () => {})
    try {
      const started = runner.start('hello', 'busy-thread')
      await expect(started).rejects.toBeInstanceOf(SessionInUse)
      await expect(started).rejects.toThrow('open in another Codex client')
    } finally {
      await runner.stop()
    }
  })
  it('unarchives a thread archived in another Codex client before asking a side question on it', async () => {
    await codexAside({ threadId: 'archived-thread', cwd: '/workspace', prompt: 'why?', timeoutMs: 300 }).catch(() => {})
    const methods = messages()
      .map((message) => message.method)
      .filter((method) => method === 'thread/fork' || method === 'thread/unarchive')
    expect(methods).toEqual(['thread/fork', 'thread/unarchive', 'thread/fork'])
  })
  it('routes Full access through approval, answering everything at once except a dangerous command', async () => {
    const events: AgentEvent[] = []
    const runner = createCodexRunner(scope, { ...DEFAULT_AGENT_SETTINGS, provider: 'codex', access: 'full' }, (event) =>
      events.push(event),
    )
    try {
      await runner.start('full gate', null)
      await vi.waitFor(() => expect(events.some((event) => event.kind === 'permission-request')).toBe(true))
      expect(messages().find((message) => message.method === 'thread/start').params).toMatchObject({
        approvalPolicy: 'untrusted',
        sandbox: 'danger-full-access',
      })
      expect(messages().find((message) => message.id === 910).result).toEqual({ decision: 'accept' })
      expect(messages().find((message) => message.id === 911).result).toMatchObject({ action: 'accept' })
      expect(messages().some((message) => message.id === 912 && message.result)).toBe(false)
      const asked = events.filter((event) => event.kind === 'permission-request')
      expect(asked).toEqual([
        expect.objectContaining({ approvalOnceOnly: true, detail: expect.stringContaining('outside this thread') }),
      ])
      runner.replyPermission!(asked[0]!.requestId, false)
      await vi.waitFor(() =>
        expect(messages().find((message) => message.id === 912)?.result).toEqual({ decision: 'decline' }),
      )
    } finally {
      await runner.stop()
    }
  })
  it('declares the always-loaded Ramu tools as dynamic tools and answers their calls through Ramu’s endpoint', async () => {
    const asked: string[] = []
    const headers: string[] = []
    const http = createServer(async (req, res) => {
      headers.push(String(req.headers.authorization))
      const server = new McpServer({ name: 'ramu', version: 'test' })
      server.registerTool(
        'ask_user',
        { description: 'Ask the person', inputSchema: { question: z.string() } },
        ({ question }) => {
          asked.push(question)
          return { content: [{ type: 'text', text: 'Yes' }] }
        },
      )
      server.registerTool('memory_save', { description: 'Save a memory', inputSchema: {} }, () => ({ content: [] }))
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
      res.on('close', () => void transport.close())
      await server.connect(transport)
      let body = ''
      for await (const chunk of req) body += chunk
      await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined)
    })
    await new Promise<void>((done) => http.listen(0, '127.0.0.1', done))
    const port = (http.address() as AddressInfo).port
    const events: AgentEvent[] = []
    const runner = createCodexRunner(
      scope,
      { ...DEFAULT_AGENT_SETTINGS, provider: 'codex', access: 'edits' },
      (event) => events.push(event),
    )
    runner.setTools!({ url: `http://127.0.0.1:${port}/mcp`, token: 'chat-token' })
    try {
      await runner.start('dynamic call', null)
      await vi.waitFor(() => expect(messages().find((message) => message.id === 930)?.result).toBeDefined())
      expect(messages().find((message) => message.method === 'initialize').params.capabilities).toEqual({
        experimentalApi: true,
      })
      const declared = messages().find((message) => message.method === 'thread/start').params.dynamicTools
      expect(declared).toEqual([
        expect.objectContaining({
          type: 'namespace',
          name: 'ramu',
          tools: [expect.objectContaining({ type: 'function', name: 'ask_user', deferLoading: false })],
        }),
      ])
      expect(messages().find((message) => message.id === 930).result).toEqual({
        contentItems: [{ type: 'inputText', text: 'Yes' }],
        success: true,
      })
      expect(asked).toEqual(['Ship it?'])
      expect(headers.every((header) => header === 'Bearer chat-token')).toBe(true)
      expect(events).toContainEqual(expect.objectContaining({ kind: 'tool-use', name: 'ask_user', summary: 'ramu' }))
    } finally {
      await runner.stop()
      http.close()
    }
  })
  it('answers MCP approvals Ramu decides itself in Allow edits, and asks for the rest', async () => {
    const events: AgentEvent[] = []
    const runner = createCodexRunner(
      scope,
      { ...DEFAULT_AGENT_SETTINGS, provider: 'codex', access: 'edits' },
      (event) => events.push(event),
    )
    try {
      await runner.start('edits gate', null)
      await vi.waitFor(() => expect(events.filter((event) => event.kind === 'elicitation')).toHaveLength(2))
      for (const id of [921, 922, 923])
        expect(messages().find((message) => message.id === id)?.result, String(id)).toMatchObject({ action: 'accept' })
      for (const id of [924, 925]) expect(messages().some((message) => message.id === id && message.result)).toBe(false)
    } finally {
      await runner.stop()
    }
  })
  it('starts each streamed message from empty once the previous one with that id completed', async () => {
    const events: AgentEvent[] = []
    const runner = createCodexRunner(scope, { ...DEFAULT_AGENT_SETTINGS, provider: 'codex', access: 'full' }, (event) =>
      events.push(event),
    )
    const results = () => events.filter((event) => event.kind === 'result').length
    try {
      await runner.start('hello', null)
      await vi.waitFor(() => expect(results()).toBe(1))
      await runner.send!('hello again')
      await vi.waitFor(() => expect(results()).toBe(2))
      const streamed = events.filter((event) => event.kind === 'text').map((event) => event.text)
      expect(streamed).toEqual(['Hello ', 'Hello Ramu', 'Hello Ramu', 'Hello ', 'Hello Ramu', 'Hello Ramu'])
    } finally {
      await runner.stop()
    }
  })
  it('reads thread-scoped MCP status across pages and reloads without starting another turn', async () => {
    const runner = createCodexRunner(scope, { ...DEFAULT_AGENT_SETTINGS, provider: 'codex' }, () => {})
    try {
      await runner.start('hello', null)
      const status = await runner.mcpStatus!()
      expect(status).toMatchObject({
        live: true,
        canReload: true,
        servers: [
          { name: 'connected', status: 'connected', toolCount: 1 },
          { name: 'cached', status: 'unknown', toolCount: 1 },
          { name: 'needs-login', status: 'needs-auth', toolCount: 0 },
        ],
      })
      await runner.reloadMcp!()
      const requests = messages().filter((m) => m.method === 'mcpServerStatus/list')
      expect(requests).toHaveLength(2)
      expect(requests[0].params).toMatchObject({ threadId: 'thread-1', detail: 'toolsAndAuthOnly' })
      expect(requests[1].params.cursor).toBe('second-page')
      expect(messages().filter((m) => m.method === 'config/mcpServer/reload')).toHaveLength(1)
      expect(messages().filter((m) => m.method === 'turn/start')).toHaveLength(1)
    } finally {
      await runner.stop()
    }
  })
  it('discovers actual model names and supported reasoning levels', async () => {
    expect(await codexModels()).toEqual([
      {
        provider: 'codex',
        id: 'codex-wire',
        name: 'Codex wire',
        isLegacy: true,
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

describe('Codex turn tokens', () => {
  it("adds each model call's input and output within a turn, ignoring calls without counts", () => {
    const first = codexLast({ last: { inputTokens: 1000, cachedInputTokens: 800, outputTokens: 120 } })
    const second = codexLast({ last: { inputTokens: 1500, outputTokens: 80 } })
    expect(addTokens(addTokens(null, first), second)).toEqual({ input: 2500, output: 200 })
    expect(addTokens({ input: 1, output: 2 }, codexLast({ last: { totalTokens: 9 } }))).toEqual({ input: 1, output: 2 })
    expect(addTokens(null, null)).toBeNull()
  })
})
