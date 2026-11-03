import { expect, it } from 'vitest'
import {
  activeTeammate,
  helperWork,
  leadNotePrompt,
  namesTeammate,
  teammateHandle,
  teammateMention,
  teammateNotePrompt,
} from '../src/chat/agentTasks'
import { describeRamuTool, ramuTool } from '../src/chat/ramuTools'
import type { AgentEvent, AgentTask } from '../src/types'

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

it('addresses a teammate by its handle or as teammate, and each note says how to reply', () => {
  expect(teammateHandle(' GPT  Sol ')).toBe('gpt-sol')
  expect(namesTeammate('@gpt-sol', 'GPT Sol')).toBe(true)
  expect(namesTeammate('Teammate', 'GPT Sol')).toBe(true)
  expect(namesTeammate('lead', 'GPT Sol')).toBe(false)
  expect(teammateNotePrompt('GPT Sol', ' Tests fail on main ')).toBe(
    '[Teammate "GPT Sol" says]\nTests fail on main\n\n(Reply with teammate_message, to "gpt-sol", only if it needs an answer.)',
  )
  expect(leadNotePrompt('Check a.ts too')).toContain('teammate_message, to "lead"')
})

it("sums a helper's edits, writes, turns and cost, skipping reads and failed calls", () => {
  const events = [
    { kind: 'tool-use', toolUseId: 'r', name: 'Read', summary: 'a.ts', input: '{"file_path":"a.ts"}' },
    { kind: 'tool-result', toolUseId: 'r', isError: false, summary: '' },
    {
      kind: 'tool-use',
      toolUseId: 'e',
      name: 'Edit',
      summary: 'a.ts',
      input: JSON.stringify({ file_path: 'a.ts', old_string: 'x', new_string: 'y\nz' }),
    },
    { kind: 'tool-result', toolUseId: 'e', isError: false, summary: '' },
    {
      kind: 'tool-use',
      toolUseId: 'w',
      name: 'Write',
      summary: 'b.ts',
      input: JSON.stringify({ file_path: 'b.ts', content: 'one\ntwo\n' }),
    },
    { kind: 'tool-result', toolUseId: 'w', isError: false, summary: '' },
    {
      kind: 'tool-use',
      toolUseId: 'f',
      name: 'Edit',
      summary: 'c.ts',
      input: JSON.stringify({ file_path: 'c.ts', old_string: 'a', new_string: 'b' }),
    },
    { kind: 'tool-result', toolUseId: 'f', isError: true, summary: 'no match' },
    { kind: 'result', isError: false, text: '', costUsd: 0.05 },
    { kind: 'result', isError: false, text: '', costUsd: null },
  ] as AgentEvent[]
  expect(helperWork(events)).toEqual({
    files: 2,
    paths: ['a.ts', 'b.ts'],
    added: 4,
    removed: 1,
    turns: 2,
    costUsd: 0.05,
  })
  expect(helperWork([]).costUsd).toBeNull()
})

it('shows teammate_message as a message to the main agent or to the named teammate', () => {
  const row = (to: string) =>
    describeRamuTool(
      ramuTool({ name: 'mcp__ramu__teammate_message', summary: '', input: JSON.stringify({ to, text: 'hi' }) })!,
    )
  expect(row('lead')).toMatchObject({ done: 'Messaged the main agent' })
  expect(row('gpt-sol')).toMatchObject({ done: 'Messaged teammate', subject: 'gpt-sol' })
})
