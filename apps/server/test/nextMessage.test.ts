import { beforeEach, expect, it, vi } from 'vitest'
import type { AgentEvent, AgentSessionInfo } from '@ramu/shared/types'
import { registerNextMessageHandlers } from '../src/ipc/handlers/nextMessage'
import type { HandlerContext } from '../src/ipc/types'

let events: AgentEvent[], state: AgentSessionInfo['state'], preferences: Record<string, unknown>
let fork: ReturnType<typeof vi.fn>, analyze: ReturnType<typeof vi.fn>
let ask: () => Promise<string[]>

const turn: AgentEvent[] = [
  { kind: 'user', text: 'Add a dark theme' },
  { kind: 'result', isError: false, text: 'Added it.', costUsd: null },
]

beforeEach(() => {
  events = [...turn]
  state = 'idle'
  preferences = {}
  fork = vi.fn(async () => ({ text: '{"suggestions":["Run the tests","Commit this"]}', provider: 'codex', model: 'm' }))
  analyze = vi.fn(async () => ({ message: '{"suggestions":["Open a pull request"]}', provider: 'codex', model: 'm' }))
  const methods = registerNextMessageHandlers({
    workspace: { getAppState: () => preferences },
    agents: {
      get: () => ({ id: 's', state, cwd: '/nowhere', settings: { provider: 'codex', model: 'm' } }),
      events: () => events,
      getGoal: () => ({ objective: 'Ship the dark theme', status: 'active' }),
      forkAnswer: fork,
      analyze,
      asideContext: () => 'USER: Add a dark theme\n\nASSISTANT: Added it.',
    },
  } as unknown as HandlerContext)
  ask = () => methods['agent.nextMessages']!.run('s') as Promise<string[]>
})

it('asks the thread’s own session once per turn, however many devices ask', async () => {
  const [desktop, phone] = await Promise.all([ask(), ask()])
  expect(desktop).toEqual(['Run the tests', 'Commit this'])
  expect(phone).toEqual(desktop)
  expect(await ask()).toEqual(desktop)
  expect(fork).toHaveBeenCalledTimes(1)
  expect(fork.mock.calls[0]![1]).toContain('Ship the dark theme')
  expect(analyze).not.toHaveBeenCalled()
  // The next turn gets its own.
  events = [...events, ...turn]
  await ask()
  expect(fork).toHaveBeenCalledTimes(2)
})

it('spends nothing while the agent works, when the setting is off, or after a failed turn', async () => {
  state = 'running'
  expect(await ask()).toEqual([])
  state = 'idle'
  preferences = { suggestNextMessage: false }
  expect(await ask()).toEqual([])
  preferences = {}
  events = [turn[0]!, { kind: 'result', isError: true, text: 'Failed', costUsd: null }]
  expect(await ask()).toEqual([])
  expect(fork).not.toHaveBeenCalled()
})

it('reads the end of the conversation with the maintenance model when the provider cannot fork', async () => {
  fork.mockResolvedValue(null)
  preferences = { intelligence: { maintenanceModel: { provider: 'claude-code', model: 'small', effort: null } } }
  expect(await ask()).toEqual(['Open a pull request'])
  expect(analyze.mock.calls[0]![0]).toContain('ASSISTANT: Added it.')
  expect(analyze.mock.calls[0]![1]).toMatchObject({ provider: 'claude-code', model: 'small' })
})

it('shows nothing when the request fails or the person has already sent something', async () => {
  fork.mockRejectedValueOnce(new Error('limit'))
  expect(await ask()).toEqual([])
  events = [...events, ...turn]
  fork.mockImplementationOnce(async () => {
    events = [...events, { kind: 'user', text: 'Actually, undo that' }]
    state = 'running'
    return { text: '{"suggestions":["Run the tests"]}', provider: 'codex', model: 'm' }
  })
  expect(await ask()).toEqual([])
})
