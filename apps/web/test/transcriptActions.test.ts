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
// The live clock's hook listens for the window hiding, which a server render has no document for.
vi.mock('../src/workspace/workspaceLifetime', () => ({
  onWorkspaceVisibility: () => () => {},
  workspaceVisible: () => true,
}))
vi.mock('../src/chat/GoalBar', () => ({ GoalDone: () => null, GoalNote: () => null }))
vi.mock('../src/views/agent/components/ThinkingRow', () => ({
  ThinkingRow: ({ text }: { text: string }) => createElement('div', {}, text),
}))
vi.mock('../src/Changes', () => ({ TurnChanges: () => createElement('aside', {}, 'Changes card') }))
vi.mock('../src/learning/TurnLearning', () => ({ TurnLearning: () => null }))
vi.mock('../src/views/agent/components/AdvisorActivity', () => ({ AdvisorActivity: () => null }))
vi.mock('../src/views/agent/components/AgentGroup', () => ({ AgentGroup: () => null }))
vi.mock('../src/views/agent/components/AgentTaskCard', () => ({ AgentTaskCard: () => null }))
vi.mock('../src/views/agent/components/ToolGroup', () => ({ ToolGroup: () => createElement('div', {}, 'Tool work') }))
vi.mock('../src/views/agent/components/TurnSummary', () => ({
  TurnSummary: ({ label, children }: PropsWithChildren<{ label: string }>) =>
    createElement('details', {}, createElement('summary', {}, label), children),
  TurnRunning: ({ label }: { label: string }) => createElement('div', {}, label),
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
const render = ({
  ended = false,
  working = true,
  needsInput = false,
  isLast = true,
  helpersWorking = false,
  stopped = false,
  clock = {} as Partial<Turn>,
} = {}) => {
  const turn: Turn = { key: 0, user, items: [progress, tools, answer], ended, ...clock }
  const ctx: TranscriptContext = {
    sessionId: 'session',
    cwd: '/project',
    taskId: 'task',
    blocks: [user, ...turn.items],
    results: new Map(),
    outcomes: new Map(),
    questionStates: new Map(),
    askedQuestions: new Map(),
    interactive: { revisions: new Map(), updates: new Map() },
    goalNotes: new Map(),
    liveText: null,
    live: true,
    working,
    needsInput,
    busyAgent: working || needsInput,
    statusGroup: tools,
    stopped,
    helpersWorking,
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

const summary = (html: string) => /<summary>(.*?)<\/summary>/.exec(html)?.[1]
const clock = { startedAt: 1_000, endedAt: 31_000 }

it('says "Worked for" only once the thread has stopped working', () => {
  expect(summary(render({ ended: true, working: false, clock }))).toBe('Worked for {0}')
  // The agent picked the work up again after its result and has shown nothing new yet.
  expect(summary(render({ ended: true, working: true, clock }))).toBe('Working for {0}')
  // Sub-agents the turn started are still running after the main agent's result.
  expect(summary(render({ ended: true, working: false, helpersWorking: true, clock }))).toBe('Working for {0}')
  // An earlier turn is done whatever the thread is doing now.
  expect(summary(render({ ended: true, working: true, isLast: false, clock }))).toBe('Worked for {0}')
})

it('keeps a stopped turn stopped while sub-agents wind down, and one that failed never reads as working', () => {
  expect(summary(render({ ended: true, working: false, helpersWorking: true, stopped: true, clock }))).toBe(
    'Stopped after {0}',
  )
  expect(summary(render({ ended: true, working: true, clock: { ...clock, interrupted: true } }))).toBe(
    'Stopped after {0}',
  )
  // No result arrived: the session failed or was stopped under the turn.
  expect(summary(render({ ended: false, working: false, clock }))).toBe('Stopped after {0}')
})

it('reads work the agent picked up by itself, as after a background command, as its own Worked for', () => {
  expect(summary(render({ ended: true, working: false, clock }))).toBe('Worked for {0}')
  expect(summary(render({ ended: true, working: false, helpersWorking: true, clock }))).toBe('Working for {0}')
})

it('keeps a changes card where its work ended, before a message steered in after it', () => {
  const steer: ChatBlock = { kind: 'event', event: { kind: 'user', text: 'Also fix the tests', steered: true } }
  const turn: Turn = { key: 0, user, items: [progress, steer, answer], ended: true }
  const html = renderToStaticMarkup(
    createElement(TranscriptTurn, {
      turn,
      isLast: true,
      ctx: {
        sessionId: 'session',
        cwd: '/project',
        taskId: 'task',
        blocks: [user, ...turn.items],
        results: new Map(),
        outcomes: new Map(),
        questionStates: new Map(),
        askedQuestions: new Map(),
        interactive: { revisions: new Map(), updates: new Map() },
        goalNotes: new Map(),
        liveText: null,
        live: true,
        working: false,
        needsInput: false,
        busyAgent: false,
        statusGroup: undefined,
        stopped: false,
        helpersWorking: false,
        latestAssistant: answer,
        hasSourceSeq: false,
        eventSequences: new Map([[steer.kind === 'event' ? steer.event : null!, 10]]),
        onBackground: undefined,
        onOpenAgent: () => {},
        onStopTask: () => {},
        onOpenQuestion: () => {},
        onReviewAccess: () => {},
        onEditMessage: () => {},
      } as TranscriptContext,
      dateSeparator: undefined,
      dateNow: Date.now(),
      reviews: [{ id: 'review', endSeq: 5 }] as never,
      completedGoals: undefined,
    }),
  )
  expect(html.indexOf('Changes card')).toBeGreaterThan(-1)
  expect(html.indexOf('Changes card')).toBeLessThan(html.indexOf('Also fix the tests'))
})

it('counts a running turn at its top, where its Worked-for line will be, with the steps under it', () => {
  const html = render({ clock: { startedAt: Date.now() - 3000 } })
  expect(html).toContain('Working for {0}')
  expect(html.indexOf('Working for {0}')).toBeLessThan(html.indexOf('I will check the files.'))
  // A turn that has ended folds under "Worked for" instead.
  expect(render({ ended: true, working: false, clock: { startedAt: 1, endedAt: 3000 } })).not.toContain('Working for')
})
