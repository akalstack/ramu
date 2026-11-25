import { createHmac } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import type { RelayMessage } from '@ramu/shared/pullRequestEvents'
import { createPullRequestEvents, eventTarget, type Attachment, type EventSocket } from '../src/pullRequestEvents'

const SECRET = 'app-secret'
const socket = () => {
  let attached: Attachment | null = null
  const sent: RelayMessage[] = []
  const value: EventSocket & { sent: RelayMessage[]; closed: boolean } = {
    sent,
    closed: false,
    send: (text) => sent.push(JSON.parse(text) as RelayMessage),
    close: () => void (value.closed = true),
    attachment: () => attached,
    attach: (next) => void (attached = next),
  }
  return value
}
const setup = () => {
  const sockets: ReturnType<typeof socket>[] = []
  const installed = new Map<string, number>()
  const readable: Record<string, string[]> = { 'gh-alice': ['acme/app', 'acme/web'], 'gh-bob': ['bob/notes'] }
  const events = createPullRequestEvents({
    sockets: () => sockets,
    installed: {
      has: (repo) => installed.has(repo),
      add: (installation, repos) => repos.forEach((repo) => installed.set(repo, installation)),
      remove: (repos) => repos.forEach((repo) => installed.delete(repo)),
      dropInstallation: (installation) => {
        const repos = [...installed].filter(([, id]) => id === installation).map(([repo]) => repo)
        repos.forEach((repo) => installed.delete(repo))
        return repos
      },
    },
    account: async (bearer) => (bearer === 'ramu-alice' ? 'alice' : bearer === 'ramu-bob' ? 'bob' : null),
    canRead: vi.fn(async (repo: string, token: string) => readable[token]?.includes(repo) ?? false),
    secret: SECRET,
  })
  const connect = async (bearer: string) => {
    const s = socket()
    sockets.push(s)
    await events.message(s, JSON.stringify({ t: 'hello', bearer }))
    return s
  }
  const deliver = (event: string, payload: unknown, secret = SECRET) => {
    const text = JSON.stringify(payload)
    const body = new TextEncoder().encode(text).buffer as ArrayBuffer
    return events.github({
      event,
      signature: `sha256=${createHmac('sha256', secret).update(text).digest('hex')}`,
      body,
    })
  }
  return { events, connect, deliver, installed }
}

it('signs a host in with its Ramu session and refuses one without', async () => {
  const { connect } = setup()
  expect((await connect('ramu-alice')).sent).toEqual([{ t: 'ready' }])
  const stranger = await connect('nobody')
  expect(stranger.sent).toEqual([{ t: 'error', reason: 'signed-out' }])
  expect(stranger.closed).toBe(true)
})

it('watches only the repositories each token can read, and says which have the App', async () => {
  const { events, connect, installed } = setup()
  installed.set('acme/app', 1)
  const alice = await connect('ramu-alice')
  await events.message(
    alice,
    JSON.stringify({ t: 'watch', groups: [{ token: 'gh-alice', repos: ['Acme/App', 'acme/web', 'bob/notes'] }] }),
  )
  expect(alice.sent.at(-1)).toEqual({
    t: 'watching',
    repos: [
      { repo: 'acme/app', state: 'live' },
      { repo: 'acme/web', state: 'not-installed' },
      { repo: 'bob/notes', state: 'no-access' },
    ],
  })
  expect(alice.attachment()?.repos).toEqual(['acme/app', 'acme/web'])
})

it('passes on only that a watched repository changed, to the hosts that may read it, and only from GitHub', async () => {
  const { events, connect, deliver } = setup()
  const alice = await connect('ramu-alice')
  const bob = await connect('ramu-bob')
  await events.message(alice, JSON.stringify({ t: 'watch', groups: [{ token: 'gh-alice', repos: ['acme/app'] }] }))
  await events.message(bob, JSON.stringify({ t: 'watch', groups: [{ token: 'gh-bob', repos: ['bob/notes'] }] }))
  const sha = 'a'.repeat(40)
  const review = {
    action: 'submitted',
    installation: { id: 9 },
    repository: { full_name: 'acme/app' },
    pull_request: { number: 12, head: { sha }, title: 'Secret plan' },
    review: { body: 'private words' },
  }
  expect(await deliver('pull_request_review', review, 'wrong-secret')).toBe(401)
  expect(alice.sent.some((message) => message.t === 'event')).toBe(false)
  expect(await deliver('pull_request_review', review)).toBe(202)
  const event = alice.sent.find((message) => message.t === 'event')
  expect(event).toEqual({ t: 'event', repo: 'acme/app', kind: 'pull_request_review', number: 12, sha })
  expect(JSON.stringify(alice.sent)).not.toContain('private words')
  expect(bob.sent.some((message) => message.t === 'event')).toBe(false)
  // The delivery showed the App is on acme/app, which its watchers hear too.
  expect(alice.sent).toContainEqual({ t: 'installed', repos: ['acme/app'], installed: true })
})

it('follows the App being installed on and removed from repositories', async () => {
  const { events, connect, deliver, installed } = setup()
  const alice = await connect('ramu-alice')
  await events.message(alice, JSON.stringify({ t: 'watch', groups: [{ token: 'gh-alice', repos: ['acme/web'] }] }))
  await deliver('installation', {
    action: 'created',
    installation: { id: 4 },
    repositories: [{ full_name: 'acme/web' }],
  })
  expect(installed.get('acme/web')).toBe(4)
  expect(alice.sent.at(-1)).toEqual({ t: 'installed', repos: ['acme/web'], installed: true })
  await deliver('installation', { action: 'deleted', installation: { id: 4 } })
  expect(installed.has('acme/web')).toBe(false)
  expect(alice.sent.at(-1)).toEqual({ t: 'installed', repos: ['acme/web'], installed: false })
})

it('finds the pull request and commit a check names', () => {
  const sha = 'b'.repeat(40)
  expect(eventTarget({ check_run: { head_sha: sha, pull_requests: [{ number: 3 }] } })).toEqual({ number: 3, sha })
  expect(eventTarget({ issue: { number: 5, pull_request: {} } })).toEqual({ number: 5 })
  expect(eventTarget({ issue: { number: 5 } })).toEqual({})
  expect(eventTarget({ sha: 'not-a-sha' })).toEqual({})
})
