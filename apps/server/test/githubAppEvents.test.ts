import { expect, it, vi } from 'vitest'
import type { HostMessage, RelayMessage } from '@ramu/shared/pullRequestEvents'
import { GithubAppEvents, type AppEventsHost } from '../src/background/githubAppEvents'

class FakeSocket extends EventTarget {
  readyState = 0
  sent: string[] = []
  constructor(readonly url: string) {
    super()
  }
  send(text: string) {
    this.sent.push(text)
  }
  close() {
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }
  open() {
    this.readyState = 1
    this.dispatchEvent(new Event('open'))
  }
  reply(message: RelayMessage | string) {
    const data = typeof message === 'string' ? message : JSON.stringify(message)
    this.dispatchEvent(Object.assign(new Event('message'), { data }))
  }
  messages() {
    return this.sent.filter((text) => text !== 'ping').map((text) => JSON.parse(text) as HostMessage)
  }
}

const setup = (bearer: string | null = 'ramu-session') => {
  const sockets: FakeSocket[] = []
  const host = {
    relay: () => 'https://ramu-link.akalstack.com',
    bearer: async () => bearer,
    watched: async () => [{ token: 'gh-token', repos: ['acme/app'] }],
    stateChanged: vi.fn(),
    changed: vi.fn(),
    resync: vi.fn(),
    socket: (url: string) => {
      const socket = new FakeSocket(url)
      sockets.push(socket)
      return socket as unknown as WebSocket
    },
  } satisfies AppEventsHost
  return { events: new GithubAppEvents(host), host, sockets }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

it('signs in, watches the repositories with their tokens, and reads everything again once connected', async () => {
  const { events, host, sockets } = setup()
  events.start()
  expect(sockets[0]!.url).toBe('wss://ramu-link.akalstack.com/v1/events')
  sockets[0]!.open()
  await settle()
  expect(sockets[0]!.messages()).toEqual([{ t: 'hello', bearer: 'ramu-session' }])
  sockets[0]!.reply({ t: 'ready' })
  await settle()
  expect(events.state()).toBe('connected')
  expect(host.resync).toHaveBeenCalledOnce()
  expect(sockets[0]!.messages().at(-1)).toEqual({ t: 'watch', groups: [{ token: 'gh-token', repos: ['acme/app'] }] })
  sockets[0]!.reply({ t: 'watching', repos: [{ repo: 'acme/app', state: 'live' }] })
  expect(events.repoState('Acme/App')).toBe('live')
  sockets[0]!.reply({ t: 'event', repo: 'acme/app', kind: 'check_run' })
  expect(host.changed).toHaveBeenCalledWith('acme/app')
  sockets[0]!.reply({ t: 'installed', repos: ['acme/app'], installed: false })
  expect(events.repoState('acme/app')).toBe('not-installed')
  events.stop()
  expect(events.state()).toBe('off')
})

it('says so when the host is signed out of its Ramu account', async () => {
  const { events, sockets } = setup(null)
  events.start()
  sockets[0]!.open()
  await settle()
  expect(events.state()).toBe('signed-out')
  expect(sockets[0]!.sent).toEqual([])
  events.stop()
})

it('reconnects after the relay drops the connection', async () => {
  vi.useFakeTimers()
  try {
    const { events, sockets } = setup()
    events.start()
    sockets[0]!.open()
    sockets[0]!.close()
    expect(events.state()).toBe('unavailable')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(sockets).toHaveLength(2)
    events.stop()
  } finally {
    vi.useRealTimers()
  }
})

it('watches again only when the repositories change, so the relay’s answer cannot start another round', async () => {
  const { events, host, sockets } = setup()
  events.start()
  sockets[0]!.open()
  await settle()
  sockets[0]!.reply({ t: 'ready' })
  await settle()
  const watches = () => sockets[0]!.messages().filter((message) => message.t === 'watch').length
  expect(watches()).toBe(1)
  sockets[0]!.reply({ t: 'watching', repos: [{ repo: 'acme/app', state: 'live' }] })
  const told = host.stateChanged.mock.calls.length
  // The host answers a state change by syncing, which starts the events again: nothing new goes out.
  events.start()
  await settle()
  sockets[0]!.reply({ t: 'watching', repos: [{ repo: 'acme/app', state: 'live' }] })
  expect(watches()).toBe(1)
  expect(host.stateChanged.mock.calls.length).toBe(told)
  // A dropped connection says nothing about any repository.
  sockets[0]!.close()
  expect(events.repoState('acme/app')).toBeUndefined()
  events.stop()
})
