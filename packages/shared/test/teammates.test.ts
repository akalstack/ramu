import { expect, it } from 'vitest'
import {
  activeTeammates,
  helperWork,
  leadNotePrompt,
  namesTeammate,
  teammateHandle,
  teammateNotePrompt,
} from '../src/chat/agentTasks'
import { resolveMention, teammateCatchUp, teammateSettings } from '../src/chat/teammateMentions'
import { DEFAULT_AGENT_SETTINGS, type AgentModel } from '../src/types'
import type { CustomAgent } from '../src/customAgents'
import { describeRamuTool, ramuTool } from '../src/chat/ramuTools'
import type { AgentEvent, AgentTask } from '../src/types'

const task = (patch: Partial<AgentTask>) => ({ agentId: 'a', name: 'n', status: 'running', ...patch }) as AgentTask
const model = (patch: Partial<AgentModel>) =>
  ({
    provider: 'codex',
    id: 'gpt-sol',
    name: 'GPT Sol',
    efforts: [],
    defaultEffort: 'high',
    isDefault: false,
    ...patch,
  }) as AgentModel

it('sends @name to a teammate here, brings in a model or custom agent by name, and leaves anything else to the lead', () => {
  const sol = task({ agentId: 's', name: 'GPT Sol', teammate: 'review' })
  const models = [model({}), model({ provider: 'claude-code', id: 'opus', name: 'Opus 5.5' })]
  const agents = [{ id: 'r', name: 'Strict reviewer' } as CustomAgent]
  // A teammate already here wins over the model it runs on.
  expect(resolveMention('@gpt-sol check this', [sol], models)).toMatchObject({ kind: 'teammate', body: 'check this' })
  expect(resolveMention('@teammate check this', [sol], models)?.kind).toBe('teammate')
  expect(resolveMention('@opus-5.5 review the diff', [sol], models)).toMatchObject({
    kind: 'model',
    model: { id: 'opus' },
    body: 'review the diff',
  })
  expect(resolveMention('@strict-reviewer look', [], models, agents)?.kind).toBe('agent')
  // `@teammate` is ambiguous with two, and a name nobody has goes to the lead.
  expect(resolveMention('@teammate hi', [sol, task({ name: 'Opus 5.5' })], models)).toBeNull()
  expect(resolveMention('@someone else', [sol], models)).toBeNull()
  expect(resolveMention('@gpt-sol', [sol], models)).toBeNull()
})

it('finds the teammates still around, not stopped ones or helpers', () => {
  expect(activeTeammates([task({}), task({ teammate: 'review', status: 'stopped' })])).toEqual([])
  expect(
    activeTeammates([
      task({ teammate: 'take-over', status: 'completed', agentId: 'b' }),
      task({ teammate: 'review', agentId: 'c' }),
    ]).map((entry) => entry.agentId),
  ).toEqual(['b', 'c'])
})

it("carries a model's own settings and only the thread's login and fast mode for the same provider", () => {
  const base = {
    ...DEFAULT_AGENT_SETTINGS,
    provider: 'codex' as const,
    accountId: 'work',
    serviceTier: 'fast' as const,
  }
  expect(teammateSettings(base, { provider: 'codex', id: 'gpt-sol', defaultEffort: 'high' })).toMatchObject({
    model: 'gpt-sol',
    effort: 'high',
    accountId: 'work',
    serviceTier: 'fast',
  })
  const other = teammateSettings(base, { provider: 'claude-code', id: 'opus', defaultEffort: null })
  expect(other).toMatchObject({ provider: 'claude-code', serviceTier: 'standard' })
  expect(other.accountId).toBeUndefined()
})

it('tells a teammate what the thread said and changed since it last took part, or nothing', () => {
  expect(teammateCatchUp('', [])).toBe('')
  const note = teammateCatchUp('USER: rename it', ['a.ts'])
  expect(note).toContain('USER: rename it')
  expect(note).toContain('Files changed: a.ts')
  expect(note.endsWith('</thread-catch-up>\n\n')).toBe(true)
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
