import { createElement, type PropsWithChildren } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import type { AgentEvent } from '@ramu/shared/types'
import type { ChatBlock } from '@ramu/shared/chat/chatFolding'
import type { TranscriptContext, Turn } from '../src/views/agent/types'
import { TranscriptTurn } from '../src/views/agent/components/TranscriptTurn'

vi.mock('../src/i18n', () => ({
  useLanguage: () => {},
  t: (text: string) => text,
  currentLanguage: () => 'en',
  formatLocale: () => 'en-US',
}))
vi.mock('../src/chat/GoalBar', () => ({ GoalDone: () => null, GoalNote: () => null }))
vi.mock('../src/chat/GoalDeploy', () => ({ GoalDeploy: () => null }))
vi.mock('../src/views/agent/components/ThinkingRow', () => ({
  ThinkingRow: ({ text }: { text: string }) => createElement('div', {}, text),
}))
vi.mock('../src/Changes', () => ({ TurnChanges: () => null }))
vi.mock('../src/views/agent/components/AdvisorActivity', () => ({ AdvisorActivity: () => null }))
vi.mock('../src/views/agent/components/AgentGroup', () => ({ AgentGroup: () => null }))
vi.mock('../src/views/agent/components/AgentTaskCard', () => ({ AgentTaskCard: () => null }))
vi.mock('../src/views/agent/components/ToolGroup', () => ({ ToolGroup: () => createElement('div', {}, 'Tool work') }))
vi.mock('../src/views/agent/components/TurnSummary', () => ({
  TurnSummary: ({ children }: PropsWithChildren) => createElement('details', {}, children),
}))
vi.mock('../src/views/agent/components/EventRow', () => ({
  EventRow: ({ event, assistantActions }: { event: AgentEvent; assistantActions: boolean }) =>
    createElement(
      'div',
      {},
      event.kind === 'text' || event.kind === 'user' ? event.text : null,
      event.kind === 'text' && assistantActions ? createElement('footer', {}, `Actions: ${event.text}`) : null,
      event.kind === 'user' ? createElement('footer', {}, 'User actions') : null,
    ),
}))

const progress: ChatBlock = { kind: 'event', event: { kind: 'text', text: 'I will check the files.' } }
const answer: ChatBlock = { kind: 'event', event: { kind: 'text', text: 'The files are fixed.' } }
const tools: ChatBlock = {
  kind: 'tools',
  tools: [{ kind: 'tool-use', toolUseId: 'tool', name: 'Bash', summary: 'git status' }],
}
const user: ChatBlock = { kind: 'event', event: { kind: 'user', text: 'Fix the files' } }
const render = ({ ended = false, working = true, needsInput = false, isLast = true } = {}) => {
  const turn: Turn = { key: 0, user, items: [progress, tools, answer], ended }
  const ctx: TranscriptContext = {
    sessionId: 'session',
    cwd: '/project',
    taskId: 'task',
    blocks: [user, ...turn.items],
    results: new Map(),
    outcomes: new Map(),
    questionStates: new Map(),
    interactive: { revisions: new Map(), updates: new Map() },
    goalNotes: new Map(),
    liveText: null,
    live: true,
    working,
    needsInput,
    busyAgent: working || needsInput,
    statusGroup: tools,
    stopped: false,
    elapsed: 1000,
    latestAssistant: answer,
    hasSourceSeq: false,
    eventSequences: new Map(),
    onBackground: undefined,
    onOpenAgent: () => {},
    onStopTask: () => {},
    onOpenQuestion: () => {},
    onReviewAccess: () => {},
    onEditMessage: () => {},
  }
  return renderToStaticMarkup(
    createElement(TranscriptTurn, {
      turn,
      isLast,
      ctx,
      dateSeparator: undefined,
      dateNow: Date.now(),
      reviews: undefined,
      completedGoals: undefined,
    }),
  )
}

it('hides agent footers while tools run even after text streaming has stopped, preserving user actions', () => {
  const html = render()
  expect(html).toContain('I will check the files.')
  expect(html).not.toContain('Actions:')
  expect(html).toContain('User actions')
})

it('hides agent footers while the turn waits for user input', () => {
  expect(render({ working: false, needsInput: true })).not.toContain('Actions:')
})

it.each([{ ended: true }, { working: false }, { isLast: false }])(
  'shows only the final answer footer once the turn is complete: %j',
  (state) => {
    const html = render(state)
    expect(html).toContain('Actions: The files are fixed.')
    expect(html).not.toContain('Actions: I will check the files.')
  },
)
