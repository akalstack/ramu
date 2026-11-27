import { afterEach, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { AgentSessionInfo } from '@ramu/shared/types'
import { TerminalService } from '../src/workspace/pty'
import { ToolRegistry } from '../src/agent/toolRegistry'
import { registerBackgroundTerminalTools } from '../src/agent/backgroundTerminalTools'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})

async function setup(
  access: 'full' | 'auto' | 'edits' = 'full',
  approve?: (detail: string, signal?: AbortSignal) => Promise<boolean>,
) {
  const terminals = new TerminalService(
    () => {},
    () => {},
  )
  const source = {
    id: 'session',
    taskId: 'thread',
    cwd: tmpdir(),
    settings: { access },
  } as AgentSessionInfo
  let current = source
  const server = new McpServer({ name: 'ramu', version: 'test' })
  const registry = new ToolRegistry(server, true)
  registerBackgroundTerminalTools(registry.server, terminals, source, () => current, approve)
  registry.expose()
  const client = new Client({ name: 'test', version: '1' })
  const [left, right] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(left), client.connect(right)])
  cleanup.push(async () => {
    terminals.closeAll()
    await client.close()
    await server.close()
  })
  const call = (name: string, args = {}) =>
    client.callTool({ name: 'tool_invoke', arguments: { name, arguments: args } })
  return {
    terminals,
    client,
    call,
    change: (value: AgentSessionInfo) => {
      current = value
    },
    source,
  }
}

it.each(['auto', 'edits'] as const)('does not turn %s MCP trust into arbitrary command execution', async (access) => {
  const { call, terminals } = await setup(access)
  const denied = await call('background_terminal_launch', { command: 'echo forbidden' })
  expect(denied.isError).toBe(true)
  expect(denied.content).toEqual([expect.objectContaining({ text: expect.stringContaining('Full access') })])
  expect(terminals.listBackground('thread')).toEqual([])
})

it.skipIf(process.platform === 'win32')(
  'asks the person to approve the exact command outside Full access',
  async () => {
    const asked: string[] = []
    const { call, terminals } = await setup('edits', async (detail) => {
      asked.push(detail)
      return !detail.includes('refuse-me')
    })
    const refused = await call('background_terminal_launch', { command: 'sleep 100 # refuse-me' })
    expect(refused.isError).toBe(true)
    expect(terminals.listBackground('thread')).toEqual([])
    const allowed = await call('background_terminal_launch', { command: 'sleep 100' })
    expect(allowed.isError).not.toBe(true)
    expect(asked).toHaveLength(2)
    expect(asked[1]).toContain('sleep 100')
    expect(terminals.listBackground('thread')).toHaveLength(1)
  },
)

it('refuses a launch when access changes while the approval is pending', async () => {
  let release: (value: boolean) => void = () => {}
  const harness = await setup('edits', () => new Promise<boolean>((resolve) => (release = resolve)))
  const pending = harness.call('background_terminal_launch', { command: 'sleep 100' })
  await new Promise((resolve) => setTimeout(resolve, 20))
  harness.change({ ...harness.source, settings: { ...harness.source.settings, access: 'auto' } })
  release(true)
  expect((await pending).isError).toBe(true)
  expect(harness.terminals.listBackground('thread')).toEqual([])
})

it.skipIf(process.platform === 'win32')(
  'attributes a command launched by a helper and keeps it after restart',
  async () => {
    const { terminals } = await setup()
    const mine = terminals.launchBackground('thread', null, tmpdir(), 'sleep 100')
    const helper = terminals.launchBackground('thread', null, tmpdir(), 'sleep 101', 'helper')
    expect(mine.startedBy).toBeUndefined()
    expect(helper.startedBy).toBe('helper')
    expect(terminals.listBackground('thread').find((entry) => entry.id === helper.id)?.startedBy).toBe('helper')
  },
)

it('revalidates access and checkout at invocation rather than trusting a previously discovered tool', async () => {
  const { call, source, change, terminals } = await setup()
  change({ ...source, settings: { ...source.settings, access: 'edits' } })
  expect((await call('background_terminal_launch', { command: 'echo forbidden' })).isError).toBe(true)
  change({ ...source, cwd: '/another-checkout' })
  expect((await call('background_terminal_list')).isError).toBe(true)
  expect(terminals.listBackground('thread')).toEqual([])
})

it.skipIf(process.platform === 'win32')(
  'discovers, launches, inspects and stops a real command through deferred MCP',
  async () => {
    const { client, call, terminals } = await setup()
    const found = await client.callTool({ name: 'tool_search', arguments: { query: 'background terminal launch' } })
    expect(found.content).toEqual([
      expect.objectContaining({ text: expect.stringContaining('background_terminal_launch') }),
    ])
    const launched = await call('background_terminal_launch', {
      command: `node -e 'const s=require("node:http").createServer((req,res)=>res.end("managed-ready")); s.listen(0,"127.0.0.1",()=>console.log("managed-port:"+s.address().port))'`,
      taskId: 'other',
      cwd: '/',
    })
    expect(launched.isError).not.toBe(true)
    const command = terminals.listBackground('thread')[0]!
    expect(command.cwd).toBe(tmpdir())
    expect(terminals.listBackground('other')).toEqual([])
    expect((await call('background_terminal_stop', { id: command.id, force: true })).isError).toBe(true)
    const deadline = Date.now() + 8000
    while (!/managed-port:\d+/.test(terminals.inspectBackground('thread', command.id).output)) {
      if (Date.now() > deadline) throw new Error('Command did not produce output')
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    const port = /managed-port:(\d+)/.exec(terminals.inspectBackground('thread', command.id).output)![1]
    const url = `http://127.0.0.1:${port}`
    expect(await (await fetch(url)).text()).toBe('managed-ready')
    expect((await call('background_terminal_inspect', { id: command.id })).isError).not.toBe(true)
    const other = terminals.launchBackground('other', null, tmpdir(), 'sleep 300')
    expect((await call('background_terminal_stop', { id: other.id })).isError).toBe(true)
    expect((await call('background_terminal_stop', { id: command.id })).isError).not.toBe(true)
    while (terminals.inspectBackground('thread', command.id).state === 'stopping') {
      if (Date.now() > deadline) throw new Error('Command did not stop')
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(terminals.inspectBackground('thread', command.id).state).toBe('exited')
    await expect(fetch(url, { signal: AbortSignal.timeout(1000) })).rejects.toThrow()
    expect(terminals.inspectBackground('other', other.id).state).toBe('running')
  },
)

const waitResult = (response: Awaited<ReturnType<Client['callTool']>>) =>
  JSON.parse((response.content as { text: string }[])[0]!.text) as {
    reason: string
    matched?: { text: string }
    commands: { state: string; exitCode: number | null; output: string }[]
  }

it.skipIf(process.platform === 'win32')(
  'waits for a ready line already printed, ignoring terminal colors, without waiting for exit',
  async () => {
    const { call, terminals } = await setup()
    const server = terminals.launchBackground(
      'thread',
      null,
      tmpdir(),
      "printf '\\033[32mLocal: ready\\033[0m\\n'; sleep 100",
    )
    await new Promise((resolve) => setTimeout(resolve, 300))
    const done = waitResult(
      await call('background_terminal_wait', {
        ids: [server.id],
        outputIncludes: ['local: READY'],
        timeoutSeconds: 10,
      }),
    )
    expect(done.reason).toBe('matched')
    expect(done.matched?.text).toBe('local: READY')
    expect(done.commands[0]!.state).toBe('running')
    expect(done.commands[0]!.output).toContain('Local: ready')
    expect(done.commands[0]!.output).not.toContain('\u001b')
  },
)

it.skipIf(process.platform === 'win32')('returns when a command exits and reports a failure', async () => {
  const { call, terminals } = await setup()
  const command = terminals.launchBackground('thread', null, tmpdir(), 'sleep 0.2; echo broke; exit 3')
  const done = waitResult(await call('background_terminal_wait', { ids: [command.id], timeoutSeconds: 10 }))
  expect(done.reason).toBe('exited')
  expect(done.commands[0]).toMatchObject({ state: 'failed', exitCode: 3 })
  expect(done.commands[0]!.output).toContain('broke')
})

it.skipIf(process.platform === 'win32')(
  'with newOutputOnly, earlier output does not count and the wait ends on timeout or silence',
  async () => {
    const { call, terminals } = await setup()
    const watcher = terminals.launchBackground('thread', null, tmpdir(), 'echo compiled; sleep 100')
    await new Promise((resolve) => setTimeout(resolve, 300))
    const timedOut = waitResult(
      await call('background_terminal_wait', {
        ids: [watcher.id],
        outputIncludes: ['compiled'],
        newOutputOnly: true,
        timeoutSeconds: 1,
      }),
    )
    expect(timedOut.reason).toBe('timeout')
    const quiet = waitResult(
      await call('background_terminal_wait', { ids: [watcher.id], quietSeconds: 2, timeoutSeconds: 30 }),
    )
    expect(quiet.reason).toBe('quiet')
  },
)

it.skipIf(process.platform === 'win32')('with mode all, waits for every command', async () => {
  const { call, terminals } = await setup()
  const quick = terminals.launchBackground('thread', null, tmpdir(), 'exit 0')
  const slow = terminals.launchBackground('thread', null, tmpdir(), 'sleep 0.5; exit 0')
  const done = waitResult(
    await call('background_terminal_wait', { ids: [quick.id, slow.id], mode: 'all', timeoutSeconds: 10 }),
  )
  expect(done.reason).toBe('exited')
  expect(done.commands.map((entry) => entry.state)).toEqual(['exited', 'exited'])
})

it.skipIf(process.platform === 'win32')(
  'refuses to wait on another thread’s command and stops when the turn stops',
  async () => {
    const { client, terminals } = await setup()
    const other = terminals.launchBackground('other', null, tmpdir(), 'sleep 100')
    const mine = terminals.launchBackground('thread', null, tmpdir(), 'sleep 100')
    const refused = await client.callTool({
      name: 'tool_invoke',
      arguments: { name: 'background_terminal_wait', arguments: { ids: [other.id] } },
    })
    expect(refused.isError).toBe(true)
    const controller = new AbortController()
    const pending = client.callTool(
      { name: 'tool_invoke', arguments: { name: 'background_terminal_wait', arguments: { ids: [mine.id] } } },
      undefined,
      { signal: controller.signal },
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    controller.abort()
    await expect(pending).rejects.toThrow()
    expect(terminals.inspectBackground('thread', mine.id).state).toBe('running')
  },
)

it.skipIf(process.platform === 'win32')(
  'marks a command as awaited while the agent waits, so every device can say so',
  async () => {
    const { call, terminals } = await setup()
    const command = terminals.launchBackground('thread', null, tmpdir(), 'sleep 0.5; exit 0')
    const pending = call('background_terminal_wait', { ids: [command.id], timeoutSeconds: 10 })
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(terminals.listBackground('thread')[0]?.agentWaiting).toBe(true)
    await pending
    expect(terminals.listBackground('thread')[0]?.agentWaiting).toBeUndefined()
  },
)

it('still asks before a production deploy in Full access, and refuses when it cannot ask', async () => {
  const details: string[] = []
  const { call } = await setup('full', async (detail) => {
    details.push(detail)
    return false
  })
  const declined = await call('background_terminal_launch', { command: 'npx vercel deploy --prod' })
  expect(declined.isError).toBe(true)
  expect(details).toEqual([expect.stringContaining('Deploys to production')])
  const unasked = await (await setup('full')).call('background_terminal_launch', { command: 'vercel deploy --prod' })
  expect(unasked.isError).toBe(true)
  expect(unasked.content).toEqual([expect.objectContaining({ text: expect.stringContaining('production') })])
})
