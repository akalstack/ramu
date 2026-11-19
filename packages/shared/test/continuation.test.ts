import { expect, it, vi } from 'vitest'
import {
  broughtBack,
  continuationGroup,
  continuedFrom,
  continueOnHost,
  latestReply,
  matchProject,
  rankHosts,
  startTargets,
  remoteKey,
} from '../src/continuation'

it('treats SSH and HTTPS forms of a remote as one repository', () => {
  expect(remoteKey('git@github.com:acme/app.git')).toBe(remoteKey('https://github.com/acme/app'))
})

it('matches by remote, and offers a same-named project only as a choice', () => {
  const repo = { remoteUrl: 'git@github.com:acme/app.git', repoName: 'app' }
  expect(
    matchProject(repo, [
      { id: 'a', name: 'app', remotes: ['https://github.com/other/app'] },
      { id: 'b', name: 'renamed', remotes: ['https://github.com/acme/app.git'] },
    ]),
  ).toEqual({ projectId: 'b', name: 'renamed', by: 'remote' })
  expect(matchProject(repo, [{ id: 'a', name: 'App', remotes: [] }])?.by).toBe('name')
  expect(matchProject(repo, [{ id: 'a', name: 'other', remotes: [] }])).toBeNull()
})

it('links a continued thread to its original through its group id', () => {
  expect(continuedFrom({ groupId: continuationGroup('h', 't', 'k') })).toEqual({ hostId: 'h', taskId: 't' })
  expect(continuedFrom({ groupId: 'plain' })).toBeNull()
  expect(continuedFrom(null)).toBeNull()
})

it('brings back the last visible reply, not a helper’s', () => {
  const events = [
    { event: { kind: 'text', text: 'first' } },
    { event: { kind: 'text', text: 'second' } },
    { event: { kind: 'text', text: 'helper', agentId: 'x' } },
  ] as never
  expect(latestReply(events)).toBe('second')
  expect(broughtBack('vps', 'done')).toContain('vps')
})

const start = {
  key: 'k',
  from: { hostId: 'a', hostName: 'Mac', taskId: 't', title: 'Fix' },
  projectId: 'p',
  branch: 'main',
  prompt: 'go',
  settings: {} as never,
}

it('labels the original once, and a failed label leaves the started thread standing', async () => {
  const calls: string[] = []
  let failures = 2
  const invoke = vi.fn(async (hostId: string, method: string) => {
    calls.push(`${hostId}:${method}`)
    if (method === 'threads.noteContinued' && failures-- > 0) throw new Error('offline')
    return { taskId: 'new' }
  })
  await expect(continueOnHost(invoke, { id: 'b', name: 'vps' }, start)).resolves.toEqual({ taskId: 'new' })
  expect(calls).toEqual(['b:threads.continueHere', 'a:threads.noteContinued', 'a:threads.noteContinued'])
})

it('reports a refused start and labels nothing', async () => {
  const invoke = vi.fn(async () => ({ taskId: '', error: 'No model' }))
  await expect(continueOnHost(invoke, { id: 'b', name: 'vps' }, start)).rejects.toThrow('No model')
  expect(invoke).toHaveBeenCalledTimes(1)
})

it('suggests a host whose platform the request names, then more memory free, and never one that reports nothing', () => {
  const host = (id: string, platform?: string, free = 0, low = false) => ({
    id,
    name: id,
    resources: platform
      ? { platform, memory: { totalBytes: 10, availableBytes: free }, low: low ? ({} as never) : null }
      : null,
  })
  const order = rankHosts(
    [host('mac', 'darwin', 9), host('vps', 'linux', 1, true), host('quiet')],
    'fails on Linux only',
  )
  expect(order.map((entry) => [entry.host.id, entry.suggested, entry.low])).toEqual([
    ['vps', true, true],
    ['mac', false, false],
    ['quiet', false, false],
  ])
})

it('starts on several hosts, and one failing leaves the others running', async () => {
  const invoke = vi.fn(async (hostId: string, method: string, ..._args: unknown[]) => {
    if (method === 'threads.continueHere' && hostId === 'bad') throw new Error('offline')
    return { taskId: `${hostId}-thread` }
  })
  const plan = { match: { projectId: 'p', name: 'app', by: 'remote' as const }, settings: {} as never, parent: '/' }
  const pack = {
    title: 'Fix',
    running: false,
    prompt: 'go',
    settings: {} as never,
    queued: 0,
    repo: { remoteUrl: 'u', repoName: 'app', branch: 'fix', commit: 'abc', dirtyFiles: 0, unpushed: 0, pushed: true },
    problem: null,
  }
  const target = (id: string) => ({ id, name: id, plan, useNamed: false, key: `${id}-key`, cloneId: `${id}-clone` })
  const outcomes = await startTargets(invoke, {
    pack,
    from: start.from,
    targets: [target('good'), target('bad')],
    note: '',
  })
  expect(outcomes).toEqual({ good: null, bad: 'offline' })
  const starts = invoke.mock.calls.filter(([, method]) => method === 'threads.continueHere')
  expect(starts.map(([, , input]) => (input as { key: string }).key)).toEqual(['good-key', 'bad-key'])
})

it('suggests a host whose description the request names', () => {
  const order = rankHosts(
    [
      { id: 'a', name: 'a', resources: { memory: null, low: null, platform: 'linux' } },
      { id: 'b', name: 'b', resources: { memory: null, low: null, platform: 'linux', description: 'GPU box' } },
    ],
    'train it on the gpu',
  )
  expect(order.map((entry) => [entry.host.id, entry.suggested])).toEqual([
    ['b', true],
    ['a', false],
  ])
})
