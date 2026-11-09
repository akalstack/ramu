import { expect, it } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, type AgentSessionInfo, type Task } from '@ramu/shared/types'
import { createDispatcher, type Services } from '../src/ipc'

const session = (id: string, provider: AgentSessionInfo['settings']['provider'], createdAt: number) =>
  ({ id, state: 'idle', createdAt, settings: { ...DEFAULT_AGENT_SETTINGS, provider } }) as AgentSessionInfo

it('lists every agent that worked in a thread, from handoffs and teammates, with the leading one last', async () => {
  const dispatcher = createDispatcher({ userData: '/tmp/ramu-thread-providers', native: async () => null, send() {} }, {
    workspace: {
      getAppState: (_key: string, fallback: unknown) => fallback,
      listTasks: () => [{ id: 't' }, { id: 'quiet' }],
      threadBranches: async () => new Map([['t', 'ramu/fix-login']]),
    },
    agents: {
      helperSummaries: () => new Map(),
      unreadAdvice: () => new Map(),
      goalOf: () => null,
      // A Cursor teammate joined first; the main session began on Claude and handed off to Codex.
      listByTask: () => new Map([['t', [session('teammate', 'cursor', 2), session('main', 'codex', 3)]]]),
      providerUses: () =>
        new Map([
          [
            'main',
            [
              { provider: 'claude-code', at: 4 },
              { provider: 'codex', at: 9 },
            ],
          ],
        ]),
    },
  } as unknown as Services)
  try {
    const tasks = (await dispatcher.invoke('tasks.list', [])) as Task[]
    expect(tasks.find((task) => task.id === 't')?.providers).toEqual(['cursor', 'claude-code', 'codex'])
    expect(tasks.find((task) => task.id === 'quiet')?.providers).toEqual([])
    // The branch rides along in the same list, so rows need no call of their own.
    expect(tasks.map((task) => task.branch)).toEqual(['ramu/fix-login', null])
  } finally {
    dispatcher.close()
  }
})
