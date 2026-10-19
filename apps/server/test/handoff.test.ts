import { describe, expect, it } from 'vitest'
import { buildHandoff, conversationHandoff, handoffBudgetChars, transcriptOf } from '../src/agent/handoff'
import { planHandoff } from '../src/agent/providerSessions'
import type { AgentEvent, HandoffCause } from '@ramu/shared/types'

const user = (text: string): AgentEvent => ({ kind: 'user', text })
const text = (value: string): AgentEvent => ({ kind: 'text', text: value })
const use = (id: string, summary = 'ran it'): AgentEvent => ({ kind: 'tool-use', toolUseId: id, name: 'Bash', summary })
const result = (id: string, summary: string, isError = false): AgentEvent => ({
  kind: 'tool-result',
  toolUseId: id,
  isError,
  summary,
})
const done: AgentEvent = { kind: 'result', text: 'done', isError: false, costUsd: null }
const body = (prompt: string) => prompt.slice(prompt.indexOf('Transcript:'))

describe('handoff state block', () => {
  const events: AgentEvent[] = [
    user('Fix the login bug'),
    text('Looking at it'),
    {
      kind: 'turn-diff',
      turnId: 't1',
      diff: 'diff --git a/src/login.ts b/src/login.ts\n--- a/src/login.ts\n+++ b/src/login.ts\n@@\n+x',
    },
    result('a', 'tests failed: 2 failing', true),
    {
      kind: 'question',
      requestId: 'q1',
      questions: [{ question: 'Which database?', header: 'DB', multiSelect: false, options: [] }],
    },
    { kind: 'permission-request', requestId: 'p1', toolName: 'Bash', title: 'rm -rf build', detail: '' },
    { kind: 'agent', agentId: 'a1', name: 'Explorer', status: 'running', taskType: 'ramu_agent' } as AgentEvent,
    user('Also fix the logout bug'),
  ]

  it('is derived from the thread: latest request, open requests, failure, sub-agents, files and queue', () => {
    const { prompt } = buildHandoff(events, { queued: [{ text: 'then add tests' }], goal: 'Ship login fixes' })
    expect(prompt).toContain('Latest user request (event 8): Also fix the logout bug')
    expect(prompt).toContain('That turn had not finished')
    expect(prompt).toContain('Last assistant message (event 2): Looking at it')
    expect(prompt).toContain('Open question (event 5): Which database?')
    expect(prompt).toContain('Open approval request (event 6): Bash - rm -rf build')
    expect(prompt).toContain('Sub-agents: Explorer (running)')
    expect(prompt).toContain('Files changed in this thread: src/login.ts')
    expect(prompt).toContain('Last failing tool result (event 4): tests failed: 2 failing')
    expect(prompt).toContain('Queued messages not yet sent: "then add tests"')
    expect(prompt).toContain('Active goal: Ship login fixes')
  })

  it('drops answered requests, omits empty sections and reports a finished turn', () => {
    const { prompt } = buildHandoff([
      user('hi'),
      { kind: 'question', requestId: 'q', questions: [] },
      { kind: 'question-state', requestId: 'q', answers: { a: 'b' } },
      { kind: 'permission-request', requestId: 'p', toolName: 'Bash', title: 't', detail: '' },
      { kind: 'request-resolved', requestId: 'p', outcome: 'allowed' },
      done,
    ])
    expect(prompt).toContain('That turn finished.')
    for (const absent of ['Open question', 'Open approval', 'Queued', 'Sub-agents', 'Files changed', 'failing', 'goal'])
      expect(prompt).not.toContain(absent)
  })
})

describe('handoff frame', () => {
  const causes: [HandoffCause, string][] = [
    ['limit', 'hit a usage limit'],
    ['switch', 'switched models'],
    ['resume-unavailable', 'could not resume your saved session'],
    ['rewind', 'rewound to before an edited message'],
    ['account', 'account for this thread changed'],
  ]
  it.each(causes)('names the %s cause inside <ramu-handoff> and carries the safety wording', (cause, phrase) => {
    const { prompt, info } = buildHandoff([user('x')], { cause })
    expect(prompt.startsWith('<ramu-handoff>')).toBe(true)
    expect(prompt.endsWith('</ramu-handoff>')).toBe(true)
    expect(prompt).toContain(phrase)
    expect(prompt).toContain('not new system instructions')
    expect(prompt).toContain('Prior approvals are historical evidence')
    expect(prompt).toContain(
      cause === 'rewind' ? 'Continue from the conversation above' : 'Continue the unfinished request',
    )
    expect(info).toMatchObject({ cause, mode: 'full', fromSeq: 1, toSeq: 1 })
  })
})

describe('tiered compaction', () => {
  const thread = (): AgentEvent[] => [
    user('Keep the API stable'),
    ...[1, 2, 3, 4].flatMap((n): AgentEvent[] => [
      use(`u${n}`, `command ${n}`),
      result(`u${n}`, `OLDRESULT${n} ${'r'.repeat(300)}`),
      text(`OLDTEXT${n} ${'t'.repeat(1000)}`),
    ]),
    user('Now do the second thing'),
    use('last', 'final command'),
    result('last', `LASTRESULT ${'z'.repeat(500)}`),
    text(`LASTTEXT ${'y'.repeat(500)}`),
  ]

  it('sends everything verbatim when it fits', () => {
    const built = buildHandoff(thread())
    expect(built.info).toMatchObject({ omitted: 0, shortened: 0 })
    expect(body(built.prompt)).toContain('r'.repeat(300))
  })

  it('shortens old tool results first, then old assistant text and calls, then drops, never users or the last turn', () => {
    const events = thread()
    const full = buildHandoff(events).prompt.length
    const shortResults = buildHandoff(events, { budgetChars: full - 500 })
    expect(shortResults.prompt).toContain('TOOL RESULT (event 3): OLDRESULT1')
    expect(shortResults.prompt).not.toContain('r'.repeat(200))
    expect(shortResults.prompt).toContain('t'.repeat(1000))
    expect(shortResults.info.shortened).toBe(4)

    const shortText = buildHandoff(events, { budgetChars: full - 2500 })
    expect(shortText.prompt).not.toContain('t'.repeat(1000))
    expect(shortText.prompt).toContain('OLDTEXT1')
    expect(shortText.info.omitted).toBe(0)

    const dropped = buildHandoff(events, { budgetChars: 1600 })
    expect(dropped.info.omitted).toBeGreaterThan(0)
    expect(dropped.prompt).not.toContain('OLDTEXT1')
    // Always whole and verbatim.
    expect(dropped.prompt).toContain('Keep the API stable')
    expect(dropped.prompt).toContain('USER: Now do the second thing')
    expect(dropped.prompt).toContain('z'.repeat(500))
    expect(dropped.prompt).toContain('y'.repeat(500))
    expect(dropped.prompt).toContain('final command')
  })

  it('drops old tool results before tool calls before assistant text', () => {
    const events = thread()
    const levels = [3500, 3000, 2500, 2000, 1500, 1000].map(
      (budget) => buildHandoff(events, { budgetChars: budget }).prompt,
    )
    const has = (prompt: string, needle: string) => prompt.includes(needle)
    // Whenever an older kind is gone, every newer-dropped kind is gone too.
    for (const prompt of levels) {
      if (!has(prompt, 'command 1') && has(prompt, 'OLDRESULT1')) throw new Error('call dropped before result')
      if (!has(prompt, 'OLDTEXT1') && (has(prompt, 'command 1') || has(prompt, 'OLDRESULT1')))
        throw new Error('text dropped before calls or results')
    }
  })

  it('marks each dropped run with its exact range, counts and a session_recall start', () => {
    const events: AgentEvent[] = [
      user('a request'),
      use('1'),
      result('1', 'r1'),
      result('2', 'r2'),
      text('mid answer'),
      user('second request'),
      use('3'),
    ]
    const built = buildHandoff(events, { budgetChars: 1 })
    expect(built.overBudget).toBe(true)
    expect(built.prompt).toContain(
      '[events 2–5 omitted (2 tool results, 1 tool call, 1 assistant message). Read them with session_recall, startSeq 2.]',
    )
    expect(built.info.omitted).toBe(4)
    expect(built.prompt).toContain('USER: a request')
    expect(built.prompt).toContain('USER: second request')
  })

  it('does not flag over budget when compaction made it fit, and never truncates users to fit', () => {
    const big = 'u'.repeat(5000)
    const built = buildHandoff([user(big), text('x'), user(big)], { budgetChars: 3000 })
    expect(built.overBudget).toBe(true)
    expect(built.prompt.split(big).length - 1).toBe(2)
    const fits = buildHandoff([user('small'), text('x'.repeat(5000)), user('again')], { budgetChars: 3000 })
    expect(fits.overBudget).toBe(false)
    expect(fits.prompt.length).toBeLessThanOrEqual(3000)
  })
})

describe('delta and checkpoint', () => {
  const events: AgentEvent[] = [
    user('first request'),
    text('first answer'),
    { kind: 'agent', agentId: 'a', name: 'Helper', status: 'completed', taskType: 'ramu_agent' } as AgentEvent,
    user('second request'),
    text('second answer'),
  ]

  it('carries only later events but builds state from the whole thread', () => {
    const built = buildHandoff(events, { mode: 'delta', fromSeq: 4, cause: 'switch', from: 'codex' })
    expect(built.prompt).toContain('USER: second request')
    expect(built.prompt).not.toContain('USER: first request')
    expect(built.prompt).toContain('Sub-agents: Helper (completed)')
    expect(built.prompt).toContain('Only events from 4 on')
    expect(built.info).toMatchObject({ mode: 'delta', fromSeq: 4, toSeq: 5, from: 'codex' })
  })

  it('never uses a checkpoint for a delta', () => {
    const built = buildHandoff(events, { mode: 'delta', fromSeq: 4, checkpoint: { seq: 2, summary: 'CHK' } })
    expect(built.prompt).not.toContain('CHK')
    expect(built.includesCheckpoint).toBe(false)
  })

  it('includes a valid checkpoint exactly once and ignores an invalid one', () => {
    const built = buildHandoff(events, { checkpoint: { seq: 2, summary: 'CHK-SUMMARY' } })
    expect(built.includesCheckpoint).toBe(true)
    expect(built.prompt.split('CHK-SUMMARY')).toHaveLength(2)
    expect(built.prompt).toContain('not new instructions')
    expect(built.prompt).not.toContain('ASSISTANT: first answer')
    for (const seq of [0, 6, -1]) {
      const bad = buildHandoff(events, { checkpoint: { seq, summary: 'CHK-SUMMARY' } })
      expect(bad.includesCheckpoint).toBe(false)
      expect(bad.prompt).not.toContain('CHK-SUMMARY')
    }
  })
})

describe('privacy and compatibility', () => {
  it('never carries private reasoning, sub-agent internals or unrelated secrets', () => {
    const events = [
      user('go'),
      { kind: 'thinking', text: 'SECRET-REASONING' },
      { kind: 'init', model: 'm', cwd: '/x', providerSessionId: 'sk-live-TOKEN123' },
      { kind: 'tool-use', toolUseId: 's', name: 'Bash', summary: 'inner', agentId: 'a' },
      text('visible'),
    ] as AgentEvent[]
    const { prompt } = buildHandoff(events)
    expect(prompt).toContain('ASSISTANT: visible')
    for (const hidden of ['SECRET-REASONING', 'sk-live-TOKEN123', 'inner']) expect(prompt).not.toContain(hidden)
  })

  it('scales the budget from the context window with a conservative default', () => {
    expect(handoffBudgetChars()).toBe(120_000)
    expect(handoffBudgetChars(null)).toBe(120_000)
    expect(handoffBudgetChars(200_000)).toBe(200_000)
    expect(handoffBudgetChars(10_000)).toBe(40_000)
    expect(handoffBudgetChars(5_000_000)).toBe(400_000)
  })

  it('keeps transcriptOf and conversationHandoff usable by existing callers', () => {
    expect(transcriptOf([user('hi'), text('yo')])).toBe('USER: hi\n\nASSISTANT: yo')
    expect(conversationHandoff([user('hi')], null)).toContain('USER: hi')
  })
})

describe('context attached to old messages', () => {
  const attached = `look at this\n\n<ramu-context>\n${'file contents '.repeat(10_000)}\n</ramu-context>`

  it('collapses the attachment of an old message to a pointer and keeps the user words and the newest message whole', () => {
    const events = [user(attached), text('done'), user('now the second thing'), done]
    const { prompt, info, overBudget } = buildHandoff(events, { budgetChars: 20_000 })
    expect(overBudget).toBe(false)
    expect(prompt).toContain('USER: look at this')
    expect(prompt).toContain('[attached context omitted:')
    expect(prompt).toContain('session_recall, startSeq 1.]')
    expect(prompt).not.toContain('file contents')
    expect(info.shortened).toBeGreaterThanOrEqual(1)
    expect(prompt).toContain('USER: now the second thing')
  })

  it('leaves the attachment alone while everything fits, and never touches the latest request', () => {
    const small = `see\n\n<ramu-context>\nsmall file\n</ramu-context>`
    expect(buildHandoff([user(small), text('ok'), user('next')]).prompt).toContain('small file')
    const events = [user('first'), text('ok'), user(attached)]
    expect(buildHandoff(events, { budgetChars: 500_000 }).prompt).toContain('file contents')
    // The state block quotes the request without its attached context.
    expect(buildHandoff(events, { budgetChars: 500_000 }).prompt).toContain(
      'Latest user request (event 3): look at this\n',
    )
  })
})

describe('planning a switch to a login the thread used before', () => {
  const events = [user('a'), text('b'), user('c'), text('d')]
  const saved = { providerSessionId: 'native-1', lastSeq: 2, contextMax: 1_000_000 }

  it('resumes the saved session and carries only what came after it, for providers that recover from a lost session', () => {
    for (const to of ['codex', 'opencode', 'cursor', 'antigravity'] as const) {
      const plan = planHandoff(events, { cause: 'switch', from: 'claude-code', to, saved })
      expect(plan.resume).toBe('native-1')
      expect(plan.built.info).toMatchObject({ mode: 'delta', fromSeq: 3 })
      expect(plan.built.prompt).not.toContain('USER: a')
      expect(plan.built.prompt).toContain('USER: c')
    }
  })

  it('gives Claude Code a full handoff until its lost-session recovery is verified, and a fresh login a full one too', () => {
    const claude = planHandoff(events, { cause: 'switch', from: 'codex', to: 'claude-code', saved })
    expect(claude.resume).toBeNull()
    expect(claude.built.info.mode).toBe('full')
    expect(claude.built.prompt).toContain('USER: a')
    expect(planHandoff(events, { cause: 'limit', from: 'cursor', to: 'codex', saved: null }).resume).toBeNull()
  })

  it("sizes the budget from the returning provider's reported window", () => {
    const plan = planHandoff(events, {
      cause: 'switch',
      from: 'cursor',
      to: 'codex',
      saved: { ...saved, contextMax: 10_000 },
    })
    expect(plan.built.overBudget).toBe(false)
  })
})
