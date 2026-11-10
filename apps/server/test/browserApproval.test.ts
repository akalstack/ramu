import { expect, it, vi } from 'vitest'
import { UserRequests, type UserRequestsHost } from '../src/agent/userRequests'
import type { Db } from '../src/db'
import type { AgentEvent, AgentSessionState } from '@ramu/shared/types'
function setup() {
  let state: AgentSessionState = 'running'
  const events: AgentEvent[] = []
  const runnerReply = vi.fn()
  const host = {
    get: () => ({ state, settings: { access: 'edits' } }),
    events: () => events,
    record: (_id: string, event: AgentEvent) => events.push(event),
    setState: (_id: string, next: AgentSessionState) => {
      state = next
    },
    shutdown: () => false,
    live: new Map(),
    runners: new Map([['session', { replyPermission: runnerReply }]]),
  } as unknown as UserRequestsHost
  const requests = new UserRequests(host, {} as Db)
  const requestId = () =>
    (events.findLast((e) => e.kind === 'permission-request') as Extract<AgentEvent, { kind: 'permission-request' }>)
      .requestId
  return { requests, events, runnerReply, requestId, state: () => state }
}
it('uses the existing once-only approval UI without forwarding app permissions to the provider runner', async () => {
  const s = setup()
  const waiting = s.requests.requestPermission(
    'session',
    'Ramu integrated browser',
    'Website sign-ins and scoped transfers',
  )
  expect(s.state()).toBe('needs-input')
  expect(s.events[0]).toMatchObject({ kind: 'permission-request', approvalOnceOnly: true })
  expect(() => s.requests.replyPermission('session', s.requestId(), true, undefined, 'user')).toThrow(
    'only be approved once',
  )
  s.requests.replyPermission('session', s.requestId(), true)
  expect(await waiting).toBe(true)
  expect(s.state()).toBe('running')
  expect(s.runnerReply).not.toHaveBeenCalled()
  expect(() => s.requests.replyPermission('session', s.requestId(), true)).toThrow('already closed')
})
it('resolves denial and cancels the approval on run stop or transport abort', async () => {
  const s = setup()
  const denied = s.requests.requestPermission('session', 'Browser', 'Read a page')
  s.requests.replyPermission('session', s.requestId(), false)
  expect(await denied).toBe(false)
  const controller = new AbortController()
  const aborted = s.requests.requestPermission('session', 'Browser', 'Read a page', controller.signal)
  controller.abort()
  await expect(aborted).rejects.toThrow('cancelled')
  const stopped = s.requests.requestPermission('session', 'Browser', 'Read a page')
  s.requests.cancelWaiters('session')
  await expect(stopped).rejects.toThrow('cancelled')
})
it('offers Always allow for an MCP tool that asks, which switches the tool to Allow instead of saving a rule', async () => {
  const s = setup()
  const always = vi.fn()
  const once = s.requests.requestPermission('session', 'linear: create_issue', 'Arguments: {}', undefined, always)
  expect(s.events[0]).toMatchObject({ approvalOnceOnly: true, approvalAlways: 'linear: create_issue' })
  s.requests.replyPermission('session', s.requestId(), true)
  expect(await once).toBe(true)
  expect(always).not.toHaveBeenCalled()
  const remembered = s.requests.requestPermission('session', 'linear: create_issue', 'Arguments: {}', undefined, always)
  s.requests.replyPermission('session', s.requestId(), true, undefined, 'user')
  expect(await remembered).toBe(true)
  expect(always).toHaveBeenCalledOnce()
})
