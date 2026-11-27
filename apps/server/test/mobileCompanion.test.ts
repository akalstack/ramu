import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HostFolders } from '../src/remote/hostFolders'
import { MobilePush } from '../src/remote/mobilePush'
import type { ChatGoal } from '@ramu/shared/types'
let dir: string | undefined
const previousRoots = process.env.RAMU_BROWSE_ROOTS
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  if (previousRoots === undefined) delete process.env.RAMU_BROWSE_ROOTS
  else process.env.RAMU_BROWSE_ROOTS = previousRoots
  vi.restoreAllMocks()
})
it('host browsing rejects path and symlink escapes and creates only a child folder', async () => {
  dir = mkdtempSync(join(tmpdir(), 'ramu-phone-folders-'))
  const root = join(dir, 'allowed'),
    outside = join(dir, 'outside')
  mkdirSync(root)
  mkdirSync(outside)
  process.env.RAMU_BROWSE_ROOTS = root
  symlinkSync(outside, join(root, 'escape'))
  const folders = new HostFolders(() => [])
  expect((await folders.list(root)).folders).toEqual([])
  await expect(folders.list(outside)).rejects.toThrow('outside')
  await expect(folders.list(join(root, 'escape'))).rejects.toThrow('outside')
  await expect(folders.create(root, '../unsafe')).rejects.toThrow('single folder')
  await folders.create(root, 'repo')
  expect((await folders.list(root)).folders[0]?.name).toBe('repo')
  await expect(folders.clone(root, 'clone', 'https://user:secret@host/repo')).rejects.toThrow('credentials')
})
it('push respects each phone category switches and treats scheduled threads as their own category', async () => {
  dir = mkdtempSync(join(tmpdir(), 'ramu-phone-push-'))
  const sent: { to: string; data: { kind: string } }[] = []
  const request = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
    sent.push(JSON.parse(String(options?.body)))
    return new Response(JSON.stringify({ data: { status: 'ok', id: 'ticket' } }))
  }) as unknown as typeof fetch
  const push = new MobilePush(
    join(dir, 'push.json'),
    () => [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    request,
    (id) => id.startsWith('sched'),
  )
  push.register('a', 'ExpoPushToken[abcdefghijk11111]', 'host') // every choice at its default: everything on
  push.register('b', 'ExpoPushToken[abcdefghijk22222]', 'host', ['input', 'failed', 'bogus'])
  push.register('c', 'ExpoPushToken[abcdefghijk33333]', 'host', ['scheduled'])
  const tokens = () => sent.splice(0).map((message) => message.to.slice(-6, -1))
  await push.deliver({ id: 'plain', taskId: 't' } as any, 'done')
  expect(tokens()).toEqual(['11111'])
  await push.deliver({ id: 'plain', taskId: 't' } as any, 'failed')
  expect(tokens()).toEqual(['11111', '22222'])
  await push.deliver({ id: 'plain', taskId: 't' } as any, 'input')
  expect(tokens()).toEqual(['11111', '22222'])
  // A scheduled thread finishing or failing is "scheduled"; needing input is still "input".
  await push.deliver({ id: 'sched-1', taskId: 't' } as any, 'done')
  expect(tokens()).toEqual(['11111', '33333'])
  await push.deliver({ id: 'sched-1', taskId: 't' } as any, 'failed')
  expect(tokens()).toEqual(['11111', '33333'])
  await push.deliver({ id: 'sched-1', taskId: 't' } as any, 'input')
  expect(tokens()).toEqual(['11111', '22222'])
  // The routing kind the phone receives stays the original one, and an empty selection mutes everything.
  push.register('c', 'ExpoPushToken[abcdefghijk33333]', 'host', [])
  await push.deliver({ id: 'sched-1', taskId: 't' } as any, 'failed')
  expect(sent.map((m) => m.data.kind)).toEqual(['failed'])
  expect(
    JSON.parse(readFileSync(join(dir, 'push.json'), 'utf8')).find((r: any) => r.deviceId === 'b').categories,
  ).toEqual(['input', 'failed'])
})
it('a scheduled run that never got a thread is generic, and a category an older phone lists is ignored', async () => {
  dir = mkdtempSync(join(tmpdir(), 'ramu-phone-push-'))
  const sent: { to: string; body: string; data: Record<string, unknown> }[] = []
  const request = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
    sent.push(JSON.parse(String(options?.body)))
    return new Response(JSON.stringify({ data: { status: 'ok', id: 'ticket' } }))
  }) as unknown as typeof fetch
  const push = new MobilePush(join(dir, 'push.json'), () => [{ id: 'a' }, { id: 'b' }, { id: 'c' }], request)
  push.register('a', 'ExpoPushToken[abcdefghijk11111]', 'host')
  push.register('b', 'ExpoPushToken[abcdefghijk22222]', 'host', ['input', 'failed', 'done', 'scheduled', 'digest'])
  push.register('c', 'ExpoPushToken[abcdefghijk33333]', 'host', ['input', 'failed', 'done'])
  await push.deliverScheduleFailure()
  expect(sent.map((message) => message.data)).toEqual([
    { computerId: 'host', kind: 'scheduled', target: 'schedules' },
    { computerId: 'host', kind: 'scheduled', target: 'schedules' },
  ])
  expect(sent.map((message) => message.to.slice(-6, -1))).toEqual(['11111', '22222'])
  for (const message of sent) {
    expect(Object.keys(message.data)).not.toContain('taskId')
    expect(message.body).toBe('A scheduled run could not start.')
  }
  expect(
    JSON.parse(readFileSync(join(dir, 'push.json'), 'utf8')).find((r: any) => r.deviceId === 'b').categories,
  ).toEqual(['input', 'failed', 'done', 'scheduled'])
})
it('push keeps transcript content private, removes invalid tokens, and drops revoked devices', async () => {
  dir = mkdtempSync(join(tmpdir(), 'ramu-phone-push-'))
  let devices = [{ id: 'a' }, { id: 'b' }]
  const requests: { url: string; value: any }[] = []
  const request = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    requests.push({ url: String(url), value: JSON.parse(String(options?.body)) })
    return new Response(JSON.stringify({ data: { status: 'error', details: { error: 'DeviceNotRegistered' } } }))
  }) as unknown as typeof fetch
  const push = new MobilePush(join(dir, 'push.json'), () => devices, request)
  push.register('a', 'ExpoPushToken[abcdefghijk12345]', 'phone-a')
  push.register('b', 'ExpoPushToken[abcdefghijk67890]', 'phone-b')
  devices = [{ id: 'a' }]
  await push.deliver({ id: 'session', taskId: 'task', title: 'PRIVATE USER PROMPT' } as any, 'input')
  expect(requests).toHaveLength(1)
  expect(JSON.stringify(requests)).not.toContain('PRIVATE USER PROMPT')
  expect(requests[0]?.value.data).toMatchObject({ computerId: 'phone-a', taskId: 'task', sessionId: 'session' })
  expect(JSON.parse(readFileSync(join(dir, 'push.json'), 'utf8'))).toEqual([])
  expect(() => push.register('revoked', 'ExpoPushToken[abcdefghijk12345]', 'phone')).toThrow('Pair')
})
it('a finished turn pushes "done" unless its goal continues, which includes a goal held at a usage limit', async () => {
  dir = mkdtempSync(join(tmpdir(), 'ramu-phone-goal-push-'))
  const sent: unknown[] = []
  const request = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
    sent.push(JSON.parse(String(options?.body)))
    return new Response(JSON.stringify({ data: { status: 'ok', id: 'ticket' } }))
  }) as unknown as typeof fetch
  const push = new MobilePush(
    join(dir, 'push.json'),
    () => [{ id: 'a' }],
    request,
    () => false,
  )
  push.register('a', 'ExpoPushToken[abcdefghijk11111]', 'host')
  const finish = async (goal: Partial<ChatGoal> | null) => {
    sent.length = 0
    const session = { id: 's', taskId: 't', parentId: null } as never
    const full = goal && ({ id: 'g', objective: 'x', turns: 1, reason: '', updatedAt: 1, ...goal } as ChatGoal)
    push.observe(session, { kind: 'state', state: 'running' }, full)
    push.observe(session, { kind: 'state', state: 'idle' }, full)
    await new Promise((resolve) => setTimeout(resolve, 0))
    return sent.length
  }
  expect(await finish(null)).toBe(1)
  // A user pause is a real stop, so the phone is told. A goal held at a limit, new shape or old, keeps going.
  expect(await finish({ status: 'paused', pausedBy: 'user' })).toBe(1)
  expect(await finish({ status: 'paused' })).toBe(1)
  expect(await finish({ status: 'paused', pausedBy: 'provider-limit' })).toBe(0)
  expect(await finish({ status: 'paused', pausedBy: 'provider-limit' })).toBe(0)
  expect(await finish({ status: 'active' })).toBe(0)
})
it('sends no push about a thread someone is looking at, on the phone or a desktop, until they look away', async () => {
  dir = mkdtempSync(join(tmpdir(), 'ramu-phone-push-'))
  const sent: { to: string }[] = []
  const request = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
    sent.push(JSON.parse(String(options?.body)))
    return new Response(JSON.stringify({ data: { status: 'ok', id: 'ticket' } }))
  }) as unknown as typeof fetch
  const push = new MobilePush(join(dir, 'push.json'), () => [{ id: 'a' }], request)
  push.register('a', 'ExpoPushToken[abcdefghijk11111]', 'host')
  const deliver = async (id: string) => {
    sent.length = 0
    await push.deliver({ id, taskId: 't' } as any, 'done')
    return sent.length
  }
  push.viewing('a', ['open'])
  expect(await deliver('open')).toBe(0)
  // Another thread still reaches the phone.
  expect(await deliver('other')).toBe(1)
  // The phone went to the background; the desktop shows the thread now.
  push.viewing('a', [])
  push.viewing('local', ['open'])
  expect(await deliver('open')).toBe(0)
  push.viewing('local', [])
  expect(await deliver('open')).toBe(1)
  // Someone using a desktop app sees every thread's news there: nothing reaches the phone until they stop.
  push.viewing('local', [], true)
  expect(await deliver('other')).toBe(0)
  push.viewing('local', [], false)
  expect(await deliver('other')).toBe(1)
  // A device that went away without saying so stops counting once it has not repeated itself.
  push.viewing('a', ['open'])
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_000)
  expect(await deliver('open')).toBe(1)
})
