import { afterEach, expect, it, vi } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { AgentSessionInfo } from '@ramu/shared/types'
import { ComputerService } from '../src/computer/service'
import { registerComputerTools } from '../src/computer/tools'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})
async function setup(approve: () => Promise<boolean> = async () => true, shared?: ComputerService) {
  const computer =
    shared ??
    new ComputerService({
      status: () => ({ available: true, computer: { id: 'local', name: 'Mac' } }),
      capture: vi.fn(),
      perform: vi.fn(),
      releaseInput: vi.fn(),
    })
  let active = true
  const source = { id: 'run', taskId: 'thread', provider: 'codex', state: 'running' } as AgentSessionInfo
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
    { request, grant },
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
