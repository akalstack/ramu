import { describe, expect, it } from 'vitest'
import { toolIsRunning, toolVerb } from '../src/chat/toolStatus'
import type { AgentEvent } from '../src/types'
const result = (running?: boolean, isError = false): Extract<AgentEvent, { kind: 'tool-result' }> => ({
  kind: 'tool-result',
  toolUseId: 'command',
  summary: 'output',
  isError,
  running,
})
describe('tool progress labels', () => {
  it('keeps streamed output running until a terminal result arrives', () => {
    expect(toolVerb('Ran', toolIsRunning(undefined, true))).toBe('Running')
    expect(toolVerb('Ran', toolIsRunning(result(true), true))).toBe('Running')
    expect(toolVerb('Ran', toolIsRunning(result(), true))).toBe('Ran')
    expect(toolVerb('Ran', toolIsRunning(result(false, true), true))).toBe('Ran')
  })
  it('does not revive unfinished tool results from a finished turn', () => {
    expect(toolIsRunning(undefined, false)).toBe(false)
    expect(toolIsRunning(result(true), false)).toBe(false)
  })
  it('uses the same progress tense for file and search actions', () => {
    expect(toolVerb('Edited', true)).toBe('Editing')
    expect(toolVerb('Read', true)).toBe('Reading')
    expect(toolVerb('Searched', true)).toBe('Searching')
    expect(toolVerb('Edited', false)).toBe('Edited')
  })
})
