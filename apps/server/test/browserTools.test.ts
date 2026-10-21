import { afterEach, expect, it } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { DesktopBrowserBroker } from '../src/browser/desktopBroker'
import { registerBrowserTools } from '../src/browser/tools'
import type { AgentSessionInfo } from '@ramu/shared/types'
import type { BrowserBridgeRequest } from '@ramu/shared/browserBridge'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})
async function setup(options: { integrated?: boolean; helper?: boolean } = {}) {
  const messages: BrowserBridgeRequest[] = []
  let token = ''
  const broker = new DesktopBrowserBroker((client, message) => {
    messages.push(message)
    queueMicrotask(() =>
      broker.reply(
        client,
        token,
        message.requestId,
        message.command.kind === 'screenshot'
          ? { mimeType: 'image/jpeg', data: 'AA==', width: 1, height: 1 }
          : { accepted: true },
      ),
    )
    return true
  })
  token = broker.attach('desktop').token
  broker.ready('desktop', token)
  const source = {
    id: 'run',
    taskId: 'thread',
    cwd: '/checkout',
    provider: 'codex',
    state: 'running',
    settings: { provider: 'codex', model: 'model', access: 'full' },
    ...(options.helper ? { parentId: 'parent' } : {}),
  } as AgentSessionInfo
  let current = source,
    active = true
  const server = new McpServer({ name: 'ramu', version: 'test' })
  registerBrowserTools(
    server,
    broker,
    source,
    () => current,
    {
      agentBrowser: options.integrated === false ? 'provider' : 'integrated',
      providerOverrides: {},
      defaultProfileId: 'temporary',
    },
    () => active,
  )
  const client = new Client({ name: 'test', version: '1' })
  const [left, right] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(left), client.connect(right)])
  cleanup.push(async () => {
    broker.detach('desktop')
    await client.close()
    await server.close()
  })
  return {
    client,
    messages,
    source,
    change: (next: AgentSessionInfo) => {
      current = next
    },
    revoke: () => {
      active = false
    },
  }
}

it('registers only the selected toolset and never lends parent browser access to helpers', async () => {
  for (const options of [{ integrated: false }, { helper: true }]) {
    const { client } = await setup(options)
    // With nothing registered the server does not advertise tools at all, which the client reports as a missing method.
    await expect(client.listTools()).rejects.toThrow(/Method not found/)
  }
})

it('derives scope and frozen profile on the host, ignoring caller attempts to choose another thread', async () => {
  const { client, messages } = await setup()
  const opened = await client.callTool({
    name: 'browser_open',
    arguments: { url: 'https://a.test', threadId: 'other', runId: 'another' },
  })
  expect(opened.isError).not.toBe(true)
  expect(messages).toEqual([
    expect.objectContaining({
      threadId: 'thread',
      runId: 'run',
      command: { kind: 'open', url: 'https://a.test', profileId: 'temporary' },
    }),
  ])
})

it('rechecks live access, account, process connection and running state before sending any command', async () => {
  const { client, messages, source, change, revoke } = await setup()
  for (const current of [
    { ...source, state: 'idle' },
    { ...source, cwd: '/another' },
    { ...source, settings: { ...source.settings, access: 'edits' } },
    { ...source, settings: { ...source.settings, accountId: 'other' } },
    { ...source, provider: 'cursor' },
  ] as AgentSessionInfo[]) {
    change(current)
    expect((await client.callTool({ name: 'browser_open', arguments: { url: 'https://a.test' } })).isError).toBe(true)
  }
  change(source)
  revoke()
  expect((await client.callTool({ name: 'browser_list', arguments: {} })).isError).toBe(true)
  expect(messages).toEqual([])
})

it('rejects invalid element references and oversized text before dispatch', async () => {
  const { client, messages } = await setup()
  const tabId = '8b360495-a21b-4bf6-9970-bc05cc2c1183'
  for (const arguments_ of [
    { tabId, snapshot: 0, ref: 1, text: 'hello' },
    { tabId, snapshot: 1, ref: 201, text: 'hello' },
    { tabId, snapshot: 1, ref: 1, text: 'x'.repeat(20001) },
  ])
    expect((await client.callTool({ name: 'browser_type', arguments: arguments_ })).isError).toBe(true)
  expect(messages).toEqual([])
})

it('returns a browser screenshot through MCP image content and keeps named profile ids as metadata', async () => {
  const { client, messages } = await setup()
  const tabId = '8b360495-a21b-4bf6-9970-bc05cc2c1183'
  const image = await client.callTool({ name: 'browser_screenshot', arguments: { tabId } })
  expect(image.content).toEqual([{ type: 'image', mimeType: 'image/jpeg', data: 'AA==' }])
  expect(messages[0]).toMatchObject({ threadId: 'thread', runId: 'run', command: { kind: 'screenshot', tabId } })
  await client.callTool({ name: 'browser_open', arguments: { url: 'https://a.test', profileId: 'work-identity' } })
  expect(messages[1]!.command).toMatchObject({ kind: 'open', profileId: 'work-identity' })
})

it('bounds extended actions before dispatch and never accepts arbitrary keys or filesystem selectors', async () => {
  const { client, messages } = await setup()
  const target = { tabId: '8b360495-a21b-4bf6-9970-bc05cc2c1183', snapshot: 1, ref: 1 }
  const invalid = [
    { name: 'browser_press', arguments: { ...target, key: 'Meta+L' } },
    { name: 'browser_scroll', arguments: { ...target, y: 2001 } },
    { name: 'browser_select', arguments: { ...target, labels: Array.from({ length: 21 }, () => 'choice') } },
    { name: 'browser_wait', arguments: { tabId: target.tabId, text: 'ready', timeoutMs: 10001 } },
    { name: 'browser_open', arguments: { url: 'https://a.test', profileId: '../profile' } },
  ]
  for (const call of invalid) expect((await client.callTool(call)).isError).toBe(true)
  expect(messages).toEqual([])
})
