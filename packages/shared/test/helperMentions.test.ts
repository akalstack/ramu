import { expect, it } from 'vitest'
import { helperWork } from '../src/chat/agentTasks'
import { draftMentions, mentionInstruction, mentionRole, resolveMention } from '../src/chat/helperMentions'
import { composerDraft } from '../src/chat/composerDraft'
import type { AgentEvent, AgentModel } from '../src/types'
import type { CustomAgent } from '../src/customAgents'

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

it('reads @name as a model or custom agent to hand the message to, and leaves anything else plain', () => {
  const models = [model({}), model({ provider: 'claude-code', id: 'opus', name: 'Opus 5.5' })]
  const agents = [{ id: 'r', name: 'Strict reviewer' } as CustomAgent]
  expect(resolveMention('@opus-5.5 review the diff', models)).toMatchObject({
    kind: 'model',
    model: { id: 'opus' },
    body: 'review the diff',
  })
  expect(resolveMention('@strict-reviewer look', models, agents)?.kind).toBe('agent')
  expect(resolveMention('@someone else', models)).toBeNull()
  expect(resolveMention('@gpt-sol', models)).toBeNull()
})

it('tells the main agent which helper to start for each kind of mention', () => {
  const opus = model({ provider: 'claude-code', id: 'opus', name: 'Opus 5.5' })
  expect(mentionInstruction({ kind: 'model', model: opus, body: 'x' })).toContain('model "opus-5.5" and role "review"')
  const agent = { id: 'r', name: 'Strict reviewer', readOnly: true } as CustomAgent
  expect(mentionInstruction({ kind: 'agent', agent, body: 'x' })).toContain('type "strict-reviewer",')
  expect(mentionInstruction({ kind: 'ability', handle: 'images', model: opus, body: 'x' })).toContain(
    'needs ["image_generation"]',
  )
})

it('starts @images, @search or @long on the model this host picks for that ability', () => {
  const images = model({ provider: 'codex', id: 'gpt-image', name: 'GPT Sol' })
  const models = [model({ provider: 'claude-code', id: 'opus', name: 'Opus 5.5' })]
  expect(resolveMention('@images draw the hero', models, [], { images })).toEqual({
    kind: 'ability',
    handle: 'images',
    model: images,
    body: 'draw the hero',
  })
  // A handle no provider here can serve stays a plain message.
  expect(resolveMention('@search find hosts', models, [], { images })).toBeNull()
  expect(draftMentions(models, [], { images })).toContainEqual({
    handle: 'images',
    label: 'images · GPT Sol',
    provider: 'codex',
  })
})

it('draws a leading @model as that model with its icon, and leaves a real file mention a file', () => {
  const sonnet = model({ provider: 'claude-code', id: 'claude-sonnet-5-5', name: 'Sonnet 5.5' })
  const mentions = draftMentions([sonnet])
  const [chip] = composerDraft('@sonnet-5.5 review this', mentions).chips
  expect(chip).toMatchObject({ kind: 'mention', label: 'Sonnet 5.5', provider: 'claude-code', source: '@sonnet-5.5' })
  expect(composerDraft('@sonnet-5.5 review this').chips[0]?.kind).toBe('file')
  expect(composerDraft('see @src/app.ts now', mentions).chips[0]?.kind).toBe('file')
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

it('gives a model the work when the request asks for a change, and a read-only look otherwise', () => {
  for (const body of [
    'fix the failing test',
    'take over and finish the migration',
    'add a retry to the uploader',
    'rename the helper and update its callers',
    'perbaiki tes yang gagal',
    'ambil alih pekerjaan ini',
  ])
    expect(mentionRole(body), body).toBe('implementation')
  for (const body of [
    'review the last commit',
    'check this too, only 1 time',
    'why does the upload fail?',
    'what would you change here?',
    'is this safe to merge',
    'review and fix nothing yet',
    'tinjau perubahan terakhir',
    'second opinion on the plan',
  ])
    expect(mentionRole(body), body).toBe('review')
  const opus = model({ provider: 'claude-code', id: 'opus', name: 'Opus 5.5' })
  expect(mentionInstruction({ kind: 'model', model: opus, body: 'fix the failing test' })).toContain(
    'model "opus-5.5" and role "implementation",',
  )
})
