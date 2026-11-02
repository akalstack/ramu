import { expect, it } from 'vitest'
import { activeTeammate, teammateMention } from '../src/chat/agentTasks'
import type { AgentTask } from '../src/types'

it('routes @name and @teammate to the teammate, and anything else to the lead', () => {
  expect(teammateMention('@codex-test rewrite the README', 'codex-test')).toBe('rewrite the README')
  expect(teammateMention('@teammate check this', 'GPT Sol')).toBe('check this')
  expect(teammateMention('@gpt-sol check this', 'GPT Sol')).toBe('check this')
  expect(teammateMention('@someone else', 'codex-test')).toBeNull()
  expect(teammateMention('no mention', 'codex-test')).toBeNull()
})

it('finds the teammate still around, not a stopped one or a helper', () => {
  const task = (patch: Partial<AgentTask>) => ({ agentId: 'a', name: 'n', status: 'running', ...patch }) as AgentTask
  expect(activeTeammate([task({}), task({ teammate: 'review', status: 'stopped' })])).toBeUndefined()
  expect(activeTeammate([task({ teammate: 'take-over', status: 'completed', agentId: 'b' })])?.agentId).toBe('b')
})
