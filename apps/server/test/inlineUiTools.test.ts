import { afterEach, beforeEach, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { AgentService } from '../src/agent'
import { openDb, type Db } from '../src/db'
import { registerInlineUiTools } from '../src/agent/inlineUiTools'
import { DEFAULT_AGENT_SETTINGS } from '@ramu/shared/types'
import { parseInlineUiActionMessage } from '@ramu/shared/chat/inlineUi'

let db: Db, agents: AgentService, server: McpServer, client: Client, sessionId: string
const steered: string[] = []
beforeEach(async () => {
  steered.length = 0
  db = openDb(':memory:')
  db.exec(
    "INSERT INTO projects (id,name,created_at) VALUES ('p','P',0); INSERT INTO tasks (id,project_id,title,mode,status,created_at) VALUES ('t','p','T','current','idle',0)",
  )
  agents = new AgentService(
    db,
    () => {},
    () => {
      throw new Error('Unused Claude adapter')
    },
    (_scope, _settings, emit) => ({
      start: async () => {
        emit({ kind: 'state', state: 'running' })
      },
      send: async (text: string) => {
        steered.push(text)
      },
      steer: async (text: string) => {
        steered.push(text)
      },
      stop: async () => {},
      interrupt: async () => {},
      replyPermission: () => {},
      replyQuestion: () => {},
    }),
  )
  sessionId = agents.start('t', { cwd: '/workspace', additionalDirs: [], covers: ['/workspace'] }, 'Do the work', {
    ...DEFAULT_AGENT_SETTINGS,
    provider: 'codex',
    access: 'full',
  }).id
  server = new McpServer({ name: 'inline-ui-test', version: '1' })
  registerInlineUiTools(server, agents, sessionId)
  client = new Client({ name: 'inline-ui-test', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
})
afterEach(async () => {
  await client.close()
  await server.close()
  await agents.stopAndWait(sessionId)
  db.close()
})
const dataOf = (result: Awaited<ReturnType<Client['callTool']>>) =>
  JSON.parse((result.content as { text: string }[])[0]!.text)
const cards = () => agents.events(sessionId).filter((event) => event.kind === 'inline-ui')

const plan = {
  version: '1.0',
  createSurface: {
    surfaceId: 'plan',
    components: [
      { id: 'root', component: 'Column', children: ['pick', 'go'] },
      {
        id: 'pick',
        component: 'ChoicePicker',
        label: 'Plan',
        options: [
          { label: 'Free', value: 'free' },
          { label: 'Pro', value: 'pro' },
        ],
        value: { '@path': '/plan' },
      },
      { id: 'go_label', component: 'Text', text: 'Choose' },
      {
        id: 'go',
        component: 'Button',
        child: 'go_label',
        action: { event: { name: 'choose', context: { plan: { '@path': '/plan' } } } },
      },
    ],
    dataModel: { plan: ['free'] },
  },
}

it('records a card for each change and tells the agent what failed without changing anything', async () => {
  expect(dataOf(await client.callTool({ name: 'show_ui', arguments: { messages: [plan] } }))).toEqual({
    ok: true,
    shown: [{ surfaceId: 'plan', revision: 1 }],
  })
  const broken = await client.callTool({
    name: 'show_ui',
    arguments: {
      messages: [
        { version: '1.0', updateDataModel: { surfaceId: 'plan', path: '/plan', value: ['pro'] } },
        {
          version: '1.0',
          updateComponents: { surfaceId: 'plan', components: [{ id: 'root', component: 'Card', child: 'gone' }] },
        },
      ],
    },
  })
  expect(broken.isError).toBe(true)
  expect(dataOf(broken).error).toContain('"gone"')
  expect(cards()).toHaveLength(1)
  await client.callTool({
    name: 'show_ui',
    arguments: {
      messages: [{ version: '1.0', updateDataModel: { surfaceId: 'plan', path: '/plan', value: ['pro'] } }],
    },
  })
  expect(cards().map((event) => event.kind === 'inline-ui' && event.surface.revision)).toEqual([1, 2])
})

it('sends a pressed button to the agent only when the card still offers it', async () => {
  await client.callTool({ name: 'show_ui', arguments: { messages: [plan] } })
  const action = {
    name: 'choose',
    surfaceId: 'plan',
    sourceComponentId: 'go',
    timestamp: new Date(0).toISOString(),
    context: { plan: ['pro'] },
  }
  await expect(agents.inlineUiAction(sessionId, { ...action, name: 'delete_everything' })).rejects.toThrow(
    'no longer offers',
  )
  await expect(agents.inlineUiAction(sessionId, { ...action, sourceComponentId: 'pick' })).rejects.toThrow(
    'no longer offers',
  )
  await expect(agents.inlineUiAction(sessionId, { ...action, dataModel: { plan: ['pro'] } })).rejects.toThrow(
    'does not send its values',
  )
  await agents.inlineUiAction(sessionId, action)
  const delivered = [...steered, ...agents.queued(sessionId).map((message) => message.text)]
  expect(delivered).toHaveLength(1)
  expect(parseInlineUiActionMessage(delivered[0]!)).toEqual({ surfaceId: 'plan', summary: 'choose' })
  expect(delivered[0]).toContain('"context":{"plan":["pro"]}')
  await client.callTool({
    name: 'show_ui',
    arguments: { messages: [{ version: '1.0', deleteSurface: { surfaceId: 'plan' } }] },
  })
  await expect(agents.inlineUiAction(sessionId, action)).rejects.toThrow('no longer shown')
})
