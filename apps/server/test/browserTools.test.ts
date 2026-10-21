import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
async function setup(
  options: { integrated?: boolean; helper?: boolean; cwd?: string; access?: 'edits' | 'full'; approve?: boolean } = {},
) {
  const messages: BrowserBridgeRequest[] = []
  let token = ''
  const broker = new DesktopBrowserBroker((client, message) => {
    messages.push(message)
    queueMicrotask(() =>
      broker.reply(
        client,
        token,
        message.requestId,
        message.command.kind === 'upload-begin'
          ? { uploadId: '22222222-2222-4222-8222-222222222222' }
          : message.command.kind === 'upload-chunk'
            ? { received: message.command.offset + Buffer.from(message.command.data, 'base64').length }
            : message.command.kind === 'open'
              ? { tab: { id: '33333333-3333-4333-8333-333333333333' } }
              : message.command.kind === 'screenshot'
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
    cwd: options.cwd ?? '/checkout',
    additionalDirs: [],
    provider: 'codex',
    state: 'running',
    settings: { provider: 'codex', model: 'model', access: options.access ?? 'full' },
    ...(options.helper ? { parentId: 'parent' } : {}),
  } as AgentSessionInfo
  let current = source,
    active = true
  let epoch = 0
  const server = new McpServer({ name: 'ramu', version: 'test' })
  const requestAccess = vi.fn(async () => options.approve ?? false)
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
    requestAccess,
    () => epoch,
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
    requestAccess,
    nextTurn: () => {
      epoch += 1
    },
    change: (next: AgentSessionInfo) => {
      current = next
    },
    revoke: () => {
      active = false
    },
  }
}

it('registers only the selected browser backend', async () => {
  const { client } = await setup({ integrated: false })
  // With nothing registered the server does not advertise tools at all, which the client reports as a missing method.
  await expect(client.listTools()).rejects.toThrow(/Method not found/)
})
it('requires browser-only approval for helpers and non-Full access and prevents helper tab borrowing', async () => {
  for (const options of [{ helper: true }, { access: 'edits' as const }]) {
    const { client, messages, requestAccess } = await setup({ ...options, approve: true })
    expect((await client.callTool({ name: 'browser_open', arguments: { url: 'https://test.example' } })).isError).toBe(
      true,
    )
    expect(messages).toEqual([])
    expect(
      (await client.callTool({ name: 'browser_request_access', arguments: { reason: 'Check the requested page' } }))
        .isError,
    ).not.toBe(true)
    expect(requestAccess).toHaveBeenCalledOnce()
    expect(
      (await client.callTool({ name: 'browser_open', arguments: { url: 'https://test.example' } })).isError,
    ).not.toBe(true)
    if (options.helper) {
      expect(
        (
          await client.callTool({
            name: 'browser_snapshot',
            arguments: { tabId: '22222222-2222-4222-8222-222222222222' },
          })
        ).isError,
      ).toBe(true)
      expect(
        (
          await client.callTool({
            name: 'browser_snapshot',
            arguments: { tabId: '33333333-3333-4333-8333-333333333333' },
          })
        ).isError,
      ).not.toBe(true)
    }
  }
  const denied = await setup({ access: 'edits' })
  await denied.client.callTool({ name: 'browser_request_access', arguments: { reason: 'Read page' } })
  expect(
    (await denied.client.callTool({ name: 'browser_open', arguments: { url: 'https://test.example' } })).isError,
  ).toBe(true)
  expect(denied.messages).toEqual([])
  await denied.client.callTool({ name: 'browser_request_access', arguments: { reason: 'Ask again' } })
  expect(denied.requestAccess).toHaveBeenCalledOnce()
})
it('expires browser-only approval when the turn ends even if its provider process stays connected', async () => {
  const s = await setup({ access: 'edits', approve: true })
  await s.client.callTool({ name: 'browser_request_access', arguments: { reason: 'Check page' } })
  expect(
    (await s.client.callTool({ name: 'browser_open', arguments: { url: 'https://test.example' } })).isError,
  ).not.toBe(true)
  s.nextTurn()
  expect((await s.client.callTool({ name: 'browser_open', arguments: { url: 'https://test.example' } })).isError).toBe(
    true,
  )
})

it('transfers only an authorized workspace file through bounded opaque handles before the snapshot-bound upload', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'ramu-browser-tool-upload-'))
  cleanup.push(() => rm(cwd, { recursive: true, force: true }))
  await writeFile(join(cwd, 'report.txt'), 'hello')
  const { client, messages } = await setup({ cwd })
  const tabId = '11111111-1111-4111-8111-111111111111'
  const reply = await client.callTool({
    name: 'browser_upload',
    arguments: { tabId, snapshot: 3, ref: 2, path: 'report.txt' },
  })
  expect(reply.isError).not.toBe(true)
  expect(messages.map((message) => message.command.kind)).toEqual([
    'upload-begin',
    'upload-chunk',
    'upload',
    'upload-cancel',
  ])
  expect(messages[0]?.command).toEqual({ kind: 'upload-begin', tabId, name: 'report.txt', size: 5 })
  expect(messages[1]?.command).toMatchObject({ kind: 'upload-chunk', data: 'aGVsbG8=', offset: 0 })
  expect(messages[2]?.command).toMatchObject({ kind: 'upload', snapshot: 3, ref: 2 })
  const before = messages.length
  expect(
    (await client.callTool({ name: 'browser_upload', arguments: { tabId, snapshot: 3, ref: 2, path: '../outside' } }))
      .isError,
  ).toBe(true)
  expect(messages).toHaveLength(before)
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

it('keeps ordinary opens in the background and exposes deliberate foreground and existing-tab presentation', async () => {
  const { client, messages } = await setup()
  await client.callTool({ name: 'browser_open', arguments: { url: 'https://read.test' } })
  expect(messages.at(-1)?.command).not.toHaveProperty('presentation')
  await client.callTool({ name: 'browser_open', arguments: { url: 'https://show.test', presentation: 'foreground' } })
  expect(messages.at(-1)?.command).toMatchObject({ kind: 'open', presentation: 'foreground' })
  const tabId = '11111111-1111-4111-8111-111111111111'
  await client.callTool({ name: 'browser_present', arguments: { tabId } })
  expect(messages.at(-1)?.command).toEqual({ kind: 'present', tabId })
  const before = messages.length
  expect(
    (await client.callTool({ name: 'browser_open', arguments: { url: 'https://bad.test', presentation: 'guess' } }))
      .isError,
  ).toBe(true)
  expect(messages).toHaveLength(before)
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
