import { afterEach, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { AgentSessionInfo } from '@ramu/shared/types'
import { TerminalService } from '../src/workspace/pty'
import { ToolRegistry } from '../src/agent/toolRegistry'
import { registerUserTerminalTools } from '../src/agent/userTerminalTools'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})

async function setup() {
  const terminals = new TerminalService(
    () => {},
    () => {},
  )
  const source = { id: 'session', taskId: 'thread', cwd: tmpdir(), settings: { access: 'auto' } } as AgentSessionInfo
  let current = source
  const server = new McpServer({ name: 'ramu', version: 'test' })
  const registry = new ToolRegistry(server, true)
  registerUserTerminalTools(registry.server, terminals, source, () => current)
  registry.expose()
  const client = new Client({ name: 'test', version: '1' })
  const [left, right] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(left), client.connect(right)])
  cleanup.push(async () => {
    terminals.closeAll()
    await client.close()
    await server.close()
  })
  const call = async (name: string, args = {}) => {
    const reply = await client.callTool({ name: 'tool_invoke', arguments: { name, arguments: args } })
    const text = (reply.content as { text: string }[])[0]?.text ?? ''
    return { error: reply.isError === true, text, json: () => JSON.parse(text) as Record<string, unknown> }
  }
  return { terminals, call, move: (value: AgentSessionInfo) => (current = value), source }
}

it('says when the person has no terminal open', async () => {
  const { call } = await setup()
  const read = await call('terminal_read')
  expect(read.error).toBe(true)
  expect(read.text).toContain('no terminal open')
  expect((await call('terminal_list')).json()).toEqual([])
})

it.skipIf(process.platform === 'win32')(
  "reads the person's latest terminal as plain, redacted text and never another thread's",
  async () => {
    const { terminals, call } = await setup()
    const older = terminals.open('thread', null, tmpdir())
    const elsewhere = terminals.open('other-thread', null, tmpdir())
    const shell = terminals.open('thread', null, tmpdir())
    // A shell drops what is typed before it is ready, so the command waits for its prompt.
    await vi.waitFor(
      async () => {
        expect(String((await call('terminal_read')).json().output).trim()).not.toBe('')
      },
      { timeout: 10_000 },
    )
    // Colors, a redrawn progress line and a token-looking value, the way real tool output prints them.
    const command = `printf '\\033[31mfailed\\033[0m: build\\nprogress 10%%\\rprogress 100%%\\nGITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789\\n'\r`
    // On a slow machine the shell can print its prompt before it reads input, and drops what came first: type again.
    let typedAt = 0
    await vi.waitFor(
      async () => {
        if (Date.now() - typedAt > 3_000) {
          typedAt = Date.now()
          terminals.write(shell.id, command)
        }
        expect((await call('terminal_read')).json().output).toContain('failed: build')
      },
      { timeout: 20_000, interval: 250 },
    )
    const read = (await call('terminal_read')).json()
    expect(read.id).toBe(shell.id)
    expect(read.name).toBe('Terminal 2')
    const output = String(read.output)
    expect(output).toContain('failed: build')
    expect(output).not.toContain('\u001b[')
    expect(output).not.toContain('progress 10%\n')
    expect(output).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789')

    const list = (await call('terminal_list')).json() as unknown as { id: string; name: string }[]
    expect(list.map((entry) => entry.id)).toEqual([older.id, shell.id])
    expect((await call('terminal_read', { id: elsewhere.id })).error).toBe(true)
  },
)

it('stops answering once the chat moves to another thread', async () => {
  const { call, move, source } = await setup()
  move({ ...source, taskId: 'another-thread' })
  expect((await call('terminal_list')).error).toBe(true)
})
