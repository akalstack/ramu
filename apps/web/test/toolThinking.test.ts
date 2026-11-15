import { expect, it } from 'vitest'
import type { ChatBlock, ToolUse } from '@ramu/shared/chat/chatFolding'
import { groupToolThinking } from '../src/views/agent/lib/toolThinking'
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
    { kind: 'work', block: tools, entries: [call] },
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
      { kind: 'work', block: tools, entries: [first.event, call, next.event] },
    ])
  }
})
