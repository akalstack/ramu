import { expect, it } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, type AgentEvent, type QueuedMessage } from '@ramu/shared/types'
import { openingLanded } from '../src/views/agent/lib/derive'
import { startingThreads, type StartingThread } from '../src/workspace/startingThreads'

const thread = (status: string): StartingThread => ({
  text: 'Fix the login page',
  attachments: [],
  sentAt: 1_000,
  status,
  settings: DEFAULT_AGENT_SETTINGS,
})

it('keeps drawing the first message until the host has it as a message or in its queue', () => {
  const user = { kind: 'user', text: 'Fix the login page', at: 2_000 } as AgentEvent
  const helper = { kind: 'user', text: 'Report', agentId: 'a1', at: 2_000 } as AgentEvent
  const queued = { id: 'q1', text: 'Fix the login page', mode: 'queue' } as QueuedMessage
  expect(openingLanded([], [])).toBe(false)
  // A helper's message is not the person's first message.
  expect(openingLanded([helper], [])).toBe(false)
  expect(openingLanded([user], [])).toBe(true)
  expect(openingLanded([], [queued])).toBe(true)
})

it('moves a starting thread on to what it is doing now, keeping its message and when it was sent', () => {
  startingThreads.set('t1', thread('Starting the agent…'))
  startingThreads.status('t1', 'Creating worktrees…')
  expect(startingThreads.get('t1')).toEqual(thread('Creating worktrees…'))
  startingThreads.delete('t1')
})

it('does not bring back a thread that already opened or failed when a late status arrives', () => {
  startingThreads.set('t2', thread('Starting the agent…'))
  startingThreads.delete('t2')
  startingThreads.status('t2', 'Starting the agent…')
  expect(startingThreads.get('t2')).toBeUndefined()
})
