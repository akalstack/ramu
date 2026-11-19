import { describe, expect, it, vi } from 'vitest'
import { registerAgentHandlers } from '../src/ipc/handlers/agent'
import type { HandlerContext } from '../src/ipc/types'

const session = '11111111-1111-4111-8111-111111111111'
const setup = (status: string) => {
  const agents = { get: () => ({ taskId: 'task' }), send: vi.fn(), sendQueuedNow: vi.fn() }
  const workspace = { getTask: () => ({ status }), setDone: vi.fn() }
  const handlers = registerAgentHandlers({ agents, workspace } as unknown as HandlerContext)
  return { agents, workspace, handlers }
}

describe('archived threads', () => {
  it('take no new message until they are unarchived', () => {
    const { agents, workspace, handlers } = setup('archived')
    expect(() => handlers['agent.send']!.run(session, 'hello')).toThrow(/archived/)
    expect(() => handlers['agent.sendQueuedNow']!.run(session, session)).toThrow(/archived/)
    expect(agents.send).not.toHaveBeenCalled()
    expect(workspace.setDone).not.toHaveBeenCalled()
  })
})
