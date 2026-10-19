import { describe, expect, it, vi } from 'vitest'
import { registerAgentHandlers } from '../src/ipc/handlers/agent'
import type { HandlerContext } from '../src/ipc/types'

const setup = () => {
  const agents = { setVerify: vi.fn((id: string, command: string | null) => ({ id, verify: command ?? undefined })) }
  const handlers = registerAgentHandlers({ agents } as unknown as HandlerContext)
  return { agents, handler: handlers['agent.goal.verify']! }
}

describe('agent.goal.verify', () => {
  it('passes a command or null to the goal, and validates its arguments', async () => {
    const { agents, handler } = setup()
    const session = '11111111-1111-4111-8111-111111111111'
    const parse = (args: unknown[]) => handler.args.parse(args) as [string, string | null]
    await handler.run(...parse([session, 'pnpm test']))
    await handler.run(...parse([session, null]))
    expect(agents.setVerify.mock.calls).toEqual([
      [session, 'pnpm test'],
      [session, null],
    ])
    expect(() => parse([session, 'x'.repeat(2001)])).toThrow()
    expect(() => parse([session, 42])).toThrow()
    expect(() => parse([session])).toThrow()
  })
})
