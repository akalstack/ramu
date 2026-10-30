import { expect, it } from 'vitest'
import { currentStep, elapsedText, turnStartedAt } from '../src/chat/agentActivity'
import type { AgentEvent } from '../src/types'

const user = (at: number) => ({ kind: 'user', text: 'go', at }) as AgentEvent
const use = (id: string, name: string, summary: string) =>
  ({ kind: 'tool-use', toolUseId: id, name, summary }) as AgentEvent
const result = (id: string, running = false) =>
  ({ kind: 'tool-result', toolUseId: id, isError: false, summary: '', running }) as AgentEvent

it('names the running tool and what it runs on, and falls back to what the agent is writing', () => {
  expect(currentStep('running', [user(1), use('a', 'Bash', 'pnpm test')])).toEqual({
    label: 'Running',
    detail: 'pnpm test',
  })
  expect(
    currentStep('running', [user(1), use('a', 'Read', 'src/App.tsx'), result('a'), use('b', 'Edit', 'src/App.tsx')]),
  ).toEqual({ label: 'Editing', detail: 'src/App.tsx' })
  // A result still streaming means the command is still running.
  expect(currentStep('running', [user(1), use('a', 'Bash', 'pnpm build'), result('a', true)])?.label).toBe('Running')
  expect(
    currentStep('running', [
      user(1),
      use('a', 'Bash', 'ls'),
      result('a'),
      { kind: 'text', text: 'Done' } as AgentEvent,
    ]),
  ).toEqual({ label: 'Writing…' })
  expect(currentStep('starting', [])).toEqual({ label: 'Starting…' })
  expect(currentStep('idle', [user(1)])).toBeNull()
})

it('times the whole turn from the person’s latest message', () => {
  expect(turnStartedAt([user(10), use('a', 'Bash', 'ls'), user(50), result('a')])).toBe(50)
  expect(turnStartedAt([])).toBeNull()
  expect(elapsedText(12_400)).toBe('12s')
  expect(elapsedText(65_000)).toBe('1m 05s')
  expect(elapsedText(3_720_000)).toBe('1h 02m')
})
