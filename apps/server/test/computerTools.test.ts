import { afterEach, expect, it, vi } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { AgentSessionInfo } from '@ramu/shared/types'
import { ComputerService } from '../src/computer/service'
import { registerComputerTools } from '../src/computer/tools'
import { ComputerRouter } from '../src/computer/router'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})
async function setup(approve: () => Promise<boolean> = async () => true, shared?: ComputerService, automatic = false) {
  const computer =
    shared ??
    new ComputerService({
      status: () => ({ available: true, computer: { id: 'local', name: 'Mac' } }),
      capture: vi.fn(),
      perform: vi.fn(),
      releaseInput: vi.fn(),
    })
  let active = true
  const source = {
    id: 'run',
    taskId: 'thread',
    provider: 'codex',
    state: 'running',
    settings: { access: 'full' },
  } as AgentSessionInfo
  const request = vi.fn(async (_detail: string, _signal?: AbortSignal) => approve())
  const grant = vi.fn(async (app?: string) => {
    computer.grant('thread', {
      target: app
        ? { id: `app:${app}`, kind: 'app', name: app }
        : { id: 'display:main', kind: 'display', name: 'Main display' },
      observe: true,
      input: true,
    })
  })
  const server = new McpServer({ name: 'ramu', version: 'test' })
  registerComputerTools(
    server,
    computer,
    source,
    () => source,
    () => active,
    { request, grant, enabled: () => automatic },
  )
  const client = new Client({ name: 'test', version: 'test' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a)
  await client.connect(b)
  cleanup.push(async () => {
    computer.revoke('thread')
    await client.close()
    await server.close()
  })
  return {
    source,
    client,
    computer,
    request,
    grant,
    stop: () => {
      active = false
    },
  }
}
it('requests app access in the thread and opens it after approval', async () => {
  const s = await setup()
  const result = await s.client.callTool({
    name: 'computer_open',
    arguments: { app: 'Calculator', reason: 'Calculate the requested total.' },
  })
  expect(result.isError).not.toBe(true)
  expect(s.request.mock.calls[0]?.[0]).toMatch(/Calculator/)
  expect(s.grant).toHaveBeenCalledWith('Calculator')
  expect(s.computer.session('thread')?.target.name).toBe('Calculator')
  await s.client.callTool({ name: 'computer_open', arguments: {} })
  expect(s.request).toHaveBeenCalledTimes(1)
})
it('respects denial without repeating the prompt or creating a grant', async () => {
  const s = await setup(async () => false)
  for (let i = 0; i < 2; i++)
    expect((await s.client.callTool({ name: 'computer_open', arguments: {} })).isError).toBe(true)
  expect(s.request).toHaveBeenCalledTimes(1)
  expect(s.grant).not.toHaveBeenCalled()
})
it('does not grant access if the run stops while the person is deciding', async () => {
  let resolve!: (value: boolean) => void
  const s = await setup(
    () =>
      new Promise<boolean>((done) => {
        resolve = done
      }),
  )
  const pending = s.client.callTool({ name: 'computer_open', arguments: {} })
  await vi.waitFor(() => expect(s.request).toHaveBeenCalled())
  s.stop()
  resolve(true)
  expect((await pending).isError).toBe(true)
  expect(s.grant).not.toHaveBeenCalled()
})
it('preserves a target chosen by the person while an approval is pending', async () => {
  let resolve!: (value: boolean) => void
  const s = await setup(
    () =>
      new Promise<boolean>((done) => {
        resolve = done
      }),
  )
  const pending = s.client.callTool({ name: 'computer_open', arguments: { app: 'Calculator' } })
  await vi.waitFor(() => expect(s.request).toHaveBeenCalled())
  s.computer.grant('thread', { target: { id: 'app:Notes', kind: 'app', name: 'Notes' }, observe: true, input: true })
  resolve(true)
  expect((await pending).isError).toBe(true)
  expect(s.grant).not.toHaveBeenCalled()
  expect(s.computer.session('thread')?.target.name).toBe('Notes')
})

it('keeps a refusal across fresh MCP connections for the same run', async () => {
  const first = await setup(async () => false)
  expect((await first.client.callTool({ name: 'computer_open', arguments: {} })).isError).toBe(true)
  const next = await setup(async () => true, first.computer)
  expect((await next.client.callTool({ name: 'computer_open', arguments: {} })).isError).toBe(true)
  expect(next.request).not.toHaveBeenCalled()
  expect(next.grant).not.toHaveBeenCalled()
})

it('opens apps automatically after host computer access is enabled', async () => {
  const s = await setup(
    async () => {
      throw new Error('Must not prompt')
    },
    undefined,
    true,
  )
  for (const app of ['Calculator', 'Notes']) {
    expect((await s.client.callTool({ name: 'computer_open', arguments: { app } })).isError).not.toBe(true)
    expect(s.computer.session('thread')?.target.name).toBe(app)
  }
  expect(s.request).not.toHaveBeenCalled()
})

it('opens apps without asking in any access mode once host access is enabled', async () => {
  const s = await setup(
    async () => {
      throw new Error('Must not prompt')
    },
    undefined,
    true,
  )
  s.source.settings.access = 'edits'
  expect((await s.client.callTool({ name: 'computer_open', arguments: { app: 'Notes' } })).isError).not.toBe(true)
  expect(s.request).not.toHaveBeenCalled()
  expect(s.computer.session('thread')?.target.name).toBe('Notes')
})
it('still asks when host computer access is not enabled', async () => {
  const s = await setup(async () => false)
  s.source.settings.access = 'edits'
  expect((await s.client.callTool({ name: 'computer_open', arguments: { app: 'Notes' } })).isError).toBe(true)
  expect(s.request).toHaveBeenCalledOnce()
  expect(s.grant).not.toHaveBeenCalled()
})
it('respects Stop across reconnects instead of automatically reopening another app', async () => {
  const first = await setup(async () => true, undefined, true)
  await first.client.callTool({ name: 'computer_open', arguments: { app: 'Notes' } })
  first.computer.revoke('thread')
  const next = await setup(async () => true, first.computer, true)
  expect((await next.client.callTool({ name: 'computer_open', arguments: { app: 'Calculator' } })).isError).toBe(true)
  expect(next.grant).not.toHaveBeenCalled()
  expect(next.request).not.toHaveBeenCalled()
})

it('does not replace a human-controlled target when another app is requested', async () => {
  const s = await setup(async () => true, undefined, true)
  await s.client.callTool({ name: 'computer_open', arguments: { app: 'Notes' } })
  s.computer.session('thread')!.takeControl('local')
  expect((await s.client.callTool({ name: 'computer_open', arguments: { app: 'Calculator' } })).isError).toBe(true)
  expect(s.computer.session('thread')?.target.name).toBe('Notes')
  expect(s.grant).toHaveBeenCalledTimes(1)
})

it('does not give helpers automatic computer access', async () => {
  const s = await setup(async () => false, undefined, true)
  s.source.parentId = 'parent'
  expect((await s.client.callTool({ name: 'computer_open', arguments: { app: 'Notes' } })).isError).toBe(true)
  expect(s.request).toHaveBeenCalledOnce()
  expect(s.grant).not.toHaveBeenCalled()
})

it('tells an agent on a locked Mac that one app still works behind the lock screen', async () => {
  const available = { available: true as const, computer: { id: 'local', name: 'Mac' } }
  const locked = { available: false as const, reason: 'locked' as const }
  const backend = { status: () => locked, capture: vi.fn(), perform: vi.fn(), releaseInput: vi.fn() }
  const apps = { ...backend, status: () => available, apps: async () => ['Finder'] }
  const s = await setup(async () => true, new ComputerService(new ComputerRouter(backend, apps)))
  const status = await s.client.callTool({ name: 'computer_status', arguments: {} })
  const text = (status.content as { type: string; text: string }[])[0]!.text
  expect(JSON.parse(text)).toMatchObject({
    runtime: { reason: 'locked' },
    lockedScreen: expect.stringMatching(/app target/),
  })
})

it('returns the screen an action left with a new observation, so actions chain without observing in between', async () => {
  const backend = {
    status: () => ({ available: true as const, computer: { id: 'local', name: 'Mac' } }),
    capture: vi.fn(async () => ({ data: 'aGk=', mimeType: 'image/png' as const, width: 800, height: 600, scale: 1 })),
    perform: vi.fn(async () => undefined),
    releaseInput: vi.fn(),
  }
  const s = await setup(async () => true, new ComputerService(backend), true)
  await s.client.callTool({ name: 'computer_open', arguments: { app: 'Calculator' } })
  const read = (result: Awaited<ReturnType<typeof s.client.callTool>>) => {
    const content = result.content as { type: string; text?: string }[]
    return { json: JSON.parse(content[0]!.text!), image: content.some((part) => part.type === 'image') }
  }
  const first = read(await s.client.callTool({ name: 'computer_observe', arguments: {} }))
  const clicked = await s.client.callTool({
    name: 'computer_click',
    arguments: { observationId: first.json.observationId, x: 10, y: 10 },
  })
  expect(clicked.isError).not.toBe(true)
  const after = read(clicked)
  expect(after.json.done).toBe(true)
  expect(after.image).toBe(true)
  expect(after.json.observationId).not.toBe(first.json.observationId)
  const typed = await s.client.callTool({
    name: 'computer_type',
    arguments: { observationId: after.json.observationId, text: 'hi' },
  })
  expect(typed.isError).not.toBe(true)
  expect(backend.perform).toHaveBeenCalledTimes(2)
})
