import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HostFolders } from '../src/remote/hostFolders'
import { MobilePush } from '../src/remote/mobilePush'
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
