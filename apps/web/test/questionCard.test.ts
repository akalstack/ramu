import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import type { QuestionRequest, QuestionState } from '@ramu/shared/chat/questions'
import { QuestionDock, QuestionRow } from '../src/chat/QuestionCard'

vi.mock('../src/i18n', () => ({
  useLanguage: () => {},
  t: (text: string, values?: Record<string, string | number>) =>
    text.replace(/\{(\w+)\}/g, (_, key: string) => String(values?.[key] ?? `{${key}}`)),
}))
vi.mock('../src/workspace/HostProvider', () => ({ useHost: () => ({ invoke: vi.fn() }) }))
vi.mock('../src/workspace/TaskPane', () => ({ errorText: String }))

const state = vi.hoisted(() => ({ expanded: false }))
vi.mock('@/components/ui/collapsible', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/components/ui/collapsible')>()
  return {
    ...actual,
    Collapsible: (props: React.ComponentProps<typeof actual.Collapsible>) =>
      createElement(actual.Collapsible, { ...props, defaultOpen: state.expanded }),
  }
})
beforeEach(() => {
  state.expanded = false
})

const request: QuestionRequest = {
  kind: 'question',
  requestId: 'jira',
  responseMode: 'message',
  questions: [
    {
      id: 'target',
      header: 'Jira target',
      question: 'Which Jira target?',
      multiSelect: false,
      options: [
        { label: 'Create under a Story', description: 'Use the existing story.' },
        { label: 'Create a new Epic', description: 'Group the drafts in a new epic.' },
      ],
    },
  ],
} as QuestionRequest
const render = (answer?: string, multiSelect = false) => {
  const status: QuestionState = {
    answers: answer ? { target: answer } : {},
    drafts: { target: 'Create a new Epic' },
    waiting: false,
    outcome: answer ? 'answered' : 'dismissed',
  }
  return renderToStaticMarkup(
    createElement(QuestionRow, {
      request: { ...request, questions: request.questions.map((q) => ({ ...q, multiSelect })) },
      status,
      pending: false,
    }),
  )
}

it('keeps all offered options and descriptions with the chosen option checked and the answer below', () => {
  state.expanded = true
  const html = render('Create under a Story')
  expect(html).toContain('Use the existing story.')
  expect(html).toContain('Group the drafts in a new epic.')
  expect(html).toMatch(/checked=""[^>]*\/><span[^>]*>Create under a Story/)
  expect(html).toMatch(/<input[^>]+type="radio"(?![^>]*checked)[^>]*\/><span[^>]*>Create a new Epic/)
  expect(html.indexOf('>Answer</span>')).toBeGreaterThan(html.indexOf('</ul>'))
  expect(html).toMatch(/font-semibold text-foreground[^>]*>Create under a Story<\/p>/)
  expect(html).not.toContain('grid-template-columns')
})

it('marks each selected option in a multiple-choice answer', () => {
  state.expanded = true
  const html = render('Create under a Story, Create a new Epic', true)
  expect(html.match(/checked=""/g)).toHaveLength(2)
  expect(html.match(/type="checkbox"/g)).toHaveLength(2)
})

it('retains offered options for a typed answer without marking any as chosen', () => {
  state.expanded = true
  const html = render('Use PROJ-25293 directly')
  expect(html).toContain('Create under a Story')
  expect(html).toContain('Create a new Epic')
  expect(html).toMatch(/font-semibold text-foreground[^>]*>Use PROJ-25293 directly<\/p>/)
  expect(html).not.toContain('checked=""')
})

it('does not present an unsent draft as the user’s submitted choice', () => {
  const html = render()
  expect(html).toContain('No answer')
  expect(html).not.toContain('checked=""')
  expect(html).not.toContain('>Answer</span>')
})

it('starts collapsed with the question and submitted answer visible and an accessible expansion control', () => {
  const html = render('Create under a Story')
  expect(html).toContain('Which Jira target?')
  expect(html).toMatch(/font-semibold text-foreground[^>]*>Create under a Story<\/p>/)
  expect(html).toContain('aria-expanded="false"')
  expect(html).not.toContain('Use the existing story.')
  expect(html).not.toContain('Create a new Epic')
})

it('keeps a custom answer visible while the offered options are collapsed', () => {
  const html = render('Use PROJ-25293 directly')
  expect(html).toContain('Use PROJ-25293 directly')
  expect(html).not.toContain('Create under a Story')
  expect(html).not.toContain('Create a new Epic')
})

it.each(['', '   ', 'The app closed instead of saving.'])(
  'renders a free-text-only question with explicit submission for draft %j',
  (draft) => {
    const freeText: QuestionRequest = {
      ...request,
      responseMode: 'ramu',
      questions: [{ id: 'details', header: 'Details', question: 'What happened?', options: [], multiSelect: false }],
    }
    const html = renderToStaticMarkup(
      createElement(QuestionDock, {
        sessionId: 'session',
        requests: [freeText],
        states: new Map([[freeText.requestId, { answers: {}, drafts: { details: draft }, waiting: true }]]),
        open: true,
        onOpenChange() {},
        focus: null,
      }),
    )
    expect(html).toContain('The agent is waiting for your answer')
    expect(html).toContain('placeholder="Type your answer"')
    expect(html).toContain('aria-label="Answer: What happened?"')
    expect(html).not.toMatch(/type="(?:radio|checkbox)"/)
    expect(html).toContain('Send answer')
    const sendButton = html.match(/<button[^>]*>Send answer<\/button>/)?.[0]
    expect(sendButton).toBeDefined()
    expect(/\sdisabled(?:=|\s|>)/.test(sendButton!)).toBe(!draft.trim())
  },
)
