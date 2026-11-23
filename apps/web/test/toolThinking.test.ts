import { expect, it } from 'vitest'
import type { ChatBlock, ToolUse } from '@ramu/shared/chat/chatFolding'
import { groupToolThinking, isLiveToolGroup } from '../src/views/agent/lib/toolThinking'
import { turnThinking } from '../src/views/agent/lib/turnThinking'

const first: ChatBlock = { kind: 'event', event: { kind: 'thinking', text: 'Inspect the files' } }
const next: ChatBlock = { kind: 'event', event: { kind: 'thinking', text: 'Check the diff' } }
const call: ToolUse = { kind: 'tool-use', toolUseId: 'read', name: 'Read', summary: 'file.ts' }
const second: ToolUse = { kind: 'tool-use', toolUseId: 'diff', name: 'Bash', summary: 'git diff' }
const tools: ChatBlock = { kind: 'tools', tools: [call] }
const moreTools: ChatBlock = { kind: 'tools', tools: [second] }
const message: ChatBlock = { kind: 'event', event: { kind: 'text', text: 'Here is the result' } }

it('puts reasoning before, between and after calls inside one tool disclosure in arrival order', () => {
  expect(groupToolThinking([first, tools, next, moreTools, first])).toEqual([
    {
      kind: 'work',
      block: { kind: 'tools', tools: [call, second] },
      entries: [first.event, call, next.event, second, first.event],
      first,
    },
  ])
})

it('preserves reasoning without tools and keeps messages between tool groups', () => {
  expect(groupToolThinking([first, message])).toEqual([first, message])
  const groups = groupToolThinking([first, tools, message, moreTools, next])
  expect(groups).toHaveLength(3)
  expect(groups[1]).toBe(message)
})

it('keeps subagent groups intact between work disclosures', () => {
  const agents: ChatBlock[] = []
  expect(groupToolThinking([tools, agents, first])).toEqual([
    { kind: 'work', block: tools, entries: [call], first: tools },
    agents,
    first,
  ])
})

it('retains reasoning inside tool groups during work and after completion', () => {
  const results = new Map([
    ['read', { kind: 'tool-result' as const, toolUseId: 'read', summary: 'contents', isError: false }],
  ])
  for (const finished of [false, true]) {
    const turn = turnThinking([first, tools, next, message], finished, new Map(), results)
    expect(groupToolThinking(finished ? turn.folded : turn.kept.filter((block) => block !== message))).toEqual([
      { kind: 'work', block: tools, entries: [first.event, call, next.event], first },
    ])
  }
})

it('keeps a group live only until the agent replies after it, then hands live to the next group', () => {
  // A runs: its thoughts and calls are live, even as a run merged with the thought before it.
  let items = [first, tools]
  const groupA = groupToolThinking(items)[0]
  expect(groupA).toMatchObject({ kind: 'work' })
  const runA = groupA && 'block' in groupA ? groupA.block : tools
  expect(isLiveToolGroup(runA, tools, items)).toBe(true)
  // A is done and the agent speaks: A settles while the turn is still running.
  items = [first, tools, message]
  expect(isLiveToolGroup(runA, tools, items)).toBe(false)
  // B starts: it is live and A stays settled.
  items = [first, tools, message, moreTools]
  expect(isLiveToolGroup(moreTools, moreTools, items)).toBe(true)
  expect(isLiveToolGroup(runA, moreTools, items)).toBe(false)
  // A thought after B's calls keeps B live.
  expect(isLiveToolGroup(moreTools, moreTools, [...items, next])).toBe(true)
})
