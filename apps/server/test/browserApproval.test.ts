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
  const once = s.requests.requestPermission('session', 'linear: create_issue', 'Arguments: {}', undefined, { always })
  expect(s.events[0]).toMatchObject({ approvalOnceOnly: true, approvalAlways: 'linear: create_issue' })
  s.requests.replyPermission('session', s.requestId(), true)
  expect(await once).toBe(true)
  expect(always).not.toHaveBeenCalled()
  const remembered = s.requests.requestPermission('session', 'linear: create_issue', 'Arguments: {}', undefined, {
    always,
  })
  s.requests.replyPermission('session', s.requestId(), true, undefined, 'user')
  expect(await remembered).toBe(true)
  expect(always).toHaveBeenCalledOnce()
})
it('lets Ship deploy to production without the card once it may, still migrating first, and counts only the person’s own Allow', async () => {
  const s = setup()
  const migrate = vi.fn(async () => 'Ran npm run migrate against production first.')
  s.requests.beforeProduction = migrate
  let may = false
  const allowed = vi.fn()
  s.requests.shipDeploys = { may: () => may, allowed }
  // The project's first production deploy asks, and the person's Allow is what puts it behind the project.
  const first = s.requests.approveProductionDeploy('session', 'Platform CLI', 'Run fly deploy')
  expect(s.events.at(-1)).toMatchObject({ productionDeploy: true })
  s.requests.replyPermission('session', s.requestId(), true)
  expect(await first).toContain('Ran')
  expect(allowed).toHaveBeenCalledWith('session')
  // Later ones in a shipping thread run without asking; the migrations still go first.
  may = true
  const asked = s.events.length
  expect(await s.requests.approveProductionDeploy('session', 'Platform CLI', 'Run fly deploy')).toContain('Ran')
  expect(s.events.length).toBe(asked)
  expect(migrate).toHaveBeenCalledTimes(2)
  expect(allowed).toHaveBeenCalledOnce()
})
it('asks before a production deploy until the thread allows them, migrating first, and never offers a lasting allow', async () => {
  const s = setup()
  const migrate = vi.fn(async () => 'Ran npm run migrate against production first.')
  s.requests.beforeProduction = migrate
  const first = s.requests.approveProductionDeploy('session', 'vercel: deploy_to_vercel', 'Arguments: {}')
  expect(s.events.at(-1)).toMatchObject({ productionDeploy: true, approvalOnceOnly: true })
  expect(s.events.at(-1)).not.toHaveProperty('approvalAlways')
  expect(() => s.requests.replyPermission('session', s.requestId(), true, undefined, 'user')).toThrow(
    'only be approved once',
  )
  s.requests.replyPermission('session', s.requestId(), true, undefined, 'thread')
  expect(await first).toBe('Ran npm run migrate against production first.')
  const asked = s.events.length
  expect(await s.requests.approveProductionDeploy('session', 'Platform CLI', 'Run fly deploy')).toContain('Ran')
  expect(s.events.length).toBe(asked)
  expect(migrate).toHaveBeenCalledTimes(2)
  migrate.mockRejectedValueOnce(new Error('The migration (npm run migrate) failed.'))
  await expect(s.requests.approveProductionDeploy('session', 'Platform CLI', 'Run fly deploy')).rejects.toThrow(
    'Nothing was deployed',
  )
  // Without a production deploy, a thread scope is refused like any once-only request.
  void s.requests.requestPermission('session', 'Browser', 'Read a page')
  expect(() => s.requests.replyPermission('session', s.requestId(), true, undefined, 'thread')).toThrow(
    'only be approved once',
  )
})
