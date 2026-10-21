import { describe, expect, it, vi } from 'vitest'
import {
  BrowserError,
  BrowserRuntime,
  MAX_TABS_PER_THREAD,
  allowedGuestUrl,
  type GuestFactory,
  type GuestHandlers,
  type GuestPage,
} from '../src/main/browserRuntime'

function setup(profiles: string[] = ['work']) {
  const created: {
    partition: string
    handlers: GuestHandlers
    page: GuestPage & { destroyed: boolean; loaded: string[] }
  }[] = []
  const cleared: string[] = []
  const factory: GuestFactory = {
    create(partition, handlers) {
      const loaded: string[] = []
      const page = {
        destroyed: false,
        loaded,
        load: vi.fn(async (url: string) => {
          loaded.push(url)
        }),
        url: () => loaded.at(-1) ?? '',
        title: () => 'Page',
        back: vi.fn(),
        forward: vi.fn(),
        reload: vi.fn(),
        show: vi.fn(),
        hide: vi.fn(),
        destroy() {
          page.destroyed = true
        },
      }
      created.push({ partition, handlers, page })
      return page
    },
    clearTemporary: (partition) => void cleared.push(partition),
  }
  const changed = vi.fn()
  const runtime = new BrowserRuntime(factory, () => profiles, changed)
  return { runtime, created, cleared, changed }
}
const user = { hostId: 'h', threadId: 't' }
const run = { hostId: 'h', threadId: 't', runId: 'r1' }

describe('urls', () => {
  it('allows only http(s) without embedded credentials', () => {
    expect(allowedGuestUrl('https://example.com/a?b=1')?.hostname).toBe('example.com')
    for (const bad of ['file:///etc/passwd', 'ramu://x', 'javascript:alert(1)', 'https://u:p@example.com', 'nope', ''])
      expect(allowedGuestUrl(bad)).toBeNull()
  })
})

describe('opening tabs', () => {
  it('refuses a bad address before creating any page', async () => {
    const { runtime, created } = setup()
    await expect(runtime.open(user, 'file:///etc/passwd')).rejects.toMatchObject({ code: 'bad-url' })
    expect(created).toHaveLength(0)
  })

  it('a person-opened tab is human-controlled and an agent-run tab waits for release', async () => {
    const { runtime } = setup()
    const mine = await runtime.open(user, 'https://a.test')
    expect(mine.tab.controller).toBe('human')
    const agents = await runtime.open(run, 'https://b.test')
    expect(agents.tab.controller).toBe('none')
  })

  it('shares one partition per persistent profile, and keeps temporary tabs private to their run', async () => {
    const { runtime, created } = setup()
    await runtime.open(user, 'https://a.test', 'work')
    await runtime.open({ ...user, threadId: 'other' }, 'https://b.test', 'work')
    expect(created[0]!.partition).toBe(created[1]!.partition)
    expect(created[0]!.partition).toBe('persist:ramu-browser:work')
    await runtime.open(run, 'https://c.test', 'temporary')
    await runtime.open({ ...run, runId: 'r2' }, 'https://d.test', 'temporary')
    expect(created[2]!.partition).not.toBe(created[3]!.partition)
    expect(created[2]!.partition.startsWith('persist:')).toBe(false)
  })

  it('falls back to Default for an unknown profile and says so', async () => {
    const { runtime, created } = setup()
    const out = await runtime.open(user, 'https://a.test', 'deleted')
    expect(out.profileFellBack).toBe(true)
    expect(out.tab.profileId).toBe('default')
    expect(created[0]!.partition).toBe('persist:ramu-browser:default')
  })

  it('bounds tabs per thread', async () => {
    const { runtime } = setup()
    for (let i = 0; i < MAX_TABS_PER_THREAD; i++) await runtime.open(user, `https://a${i}.test`)
    await expect(runtime.open(user, 'https://over.test')).rejects.toMatchObject({ code: 'too-many-tabs' })
    await expect(runtime.open({ ...user, threadId: 'other' }, 'https://ok.test')).resolves.toBeTruthy()
  })

  it('destroys a page whose first load fails', async () => {
    const { runtime, created } = setup()
    const failing = new Error('net down')
    const factory = (runtime as unknown as { factory: GuestFactory }).factory
    const make = factory.create.bind(factory)
    factory.create = (partition, handlers) => {
      const page = make(partition, handlers)
      page.load = async () => {
        throw failing
      }
      return page
    }
    await expect(runtime.open(user, 'https://a.test')).rejects.toBe(failing)
    expect(created[0]!.page.destroyed).toBe(true)
    expect(runtime.list()).toEqual([])
  })
})

describe('navigation rules', () => {
  it('blocks script or redirect navigation to non-web schemes and turns popups into tabs in the same profile', async () => {
    const { runtime, created } = setup()
    await runtime.open(user, 'https://a.test', 'work')
    const { handlers } = created[0]!
    expect(handlers.onNavigate('https://other.test')).toBe(true)
    expect(handlers.onNavigate('file:///etc/passwd')).toBe(false)
    handlers.onOpenWindow('javascript:alert(1)')
    handlers.onOpenWindow('https://popup.test')
    await vi.waitFor(() => expect(runtime.list()).toHaveLength(2))
    expect(created[1]!.partition).toBe('persist:ramu-browser:work')
    expect(runtime.list().some((tab) => tab.url === 'https://popup.test/')).toBe(true)
  })

  it('marks a crashed tab and notifies', async () => {
    const { runtime, created, changed } = setup()
    await runtime.open(user, 'https://a.test')
    created[0]!.handlers.onCrash()
    expect(runtime.list()[0]!.crashed).toBe(true)
    expect(changed).toHaveBeenCalled()
  })
})

describe('ownership and agent actions', () => {
  it("an agent acts only after release and observation, and only on its own thread's tab", async () => {
    const { runtime } = setup()
    const { tab } = await runtime.open(user, 'https://a.test')
    const act = vi.fn(async () => 'clicked')
    const released = runtime.giveToAgent(tab.id, 'local', 'r1')
    await expect(runtime.agentAction(tab.id, 'r1', released.generation, user, act)).rejects.toMatchObject({
      code: 'needs-observation',
    })
    runtime.observeForAgent(tab.id, 'r1')
    await expect(runtime.agentAction(tab.id, 'r1', released.generation, user, act)).resolves.toBe('clicked')
    await expect(
      runtime.agentAction(tab.id, 'r1', released.generation, { hostId: 'h', threadId: 'another' }, act),
    ).rejects.toMatchObject({ code: 'wrong-owner' })
    await expect(runtime.agentAction(tab.id, 'r1', released.generation - 1, user, act)).rejects.toBeInstanceOf(
      BrowserError,
    )
  })

  it('human takeover refuses the agent and waits for in-flight work, even when the action throws', async () => {
    const { runtime } = setup()
    const { tab } = await runtime.open(user, 'https://a.test')
    const released = runtime.giveToAgent(tab.id, 'local', 'r1')
    runtime.observeForAgent(tab.id, 'r1')
    let finish: (value: string) => void = () => {}
    const pending = runtime.agentAction(
      tab.id,
      'r1',
      released.generation,
      user,
      () => new Promise<string>((r) => (finish = r)),
    )
    runtime.takeControl(tab.id, 'local', { local: true })
    await expect(
      runtime.agentAction(tab.id, 'r1', released.generation, user, async () => 'late'),
    ).rejects.toMatchObject({ code: 'human-controlled' })
    finish('done')
    await expect(pending).resolves.toBe('done')
    const failing = runtime.giveToAgent(tab.id, 'local', 'r1')
    runtime.observeForAgent(tab.id, 'r1')
    await expect(
      runtime.agentAction(tab.id, 'r1', failing.generation, user, async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(runtime.takeControl(tab.id, 'local', { local: true }).controller).toBe('human')
  })

  it('a second device must be handed the tab, and a disconnect pauses it', async () => {
    const { runtime } = setup()
    const { tab } = await runtime.open({ ...user }, 'https://a.test')
    runtime.takeControl(tab.id, 'phone', { local: true })
    expect(() => runtime.takeControl(tab.id, 'desktop-b')).toThrow(BrowserError)
    runtime.controllerDisconnected('phone')
    await expect(runtime.agentAction(tab.id, 'r1', 0, user, async () => 1)).rejects.toBeInstanceOf(BrowserError)
  })
})

describe('run end and shutdown', () => {
  it('ending a run closes its temporary tabs, clears their data, and leaves user tabs open', async () => {
    const { runtime, created, cleared } = setup()
    await runtime.open(user, 'https://mine.test', 'work')
    await runtime.open(run, 'https://temp.test', 'temporary')
    runtime.endRun(run)
    expect(runtime.list().map((tab) => tab.url)).toEqual(['https://mine.test/'])
    expect(created[1]!.page.destroyed).toBe(true)
    expect(cleared).toEqual([created[1]!.partition])
  })

  it("revokes an ended run's lease on persistent tabs", async () => {
    const { runtime } = setup()
    const { tab } = await runtime.open(user, 'https://a.test', 'work')
    const released = runtime.giveToAgent(tab.id, 'local', 'r1')
    runtime.observeForAgent(tab.id, 'r1')
    runtime.endRun(run)
    await expect(runtime.agentAction(tab.id, 'r1', released.generation, user, async () => 1)).rejects.toBeInstanceOf(
      BrowserError,
    )
    expect(runtime.list()[0]!.controller).toBe('none')
  })

  it('closeAll destroys every page and refuses new tabs', async () => {
    const { runtime, created } = setup()
    await runtime.open(user, 'https://a.test')
    runtime.closeAll()
    expect(created[0]!.page.destroyed).toBe(true)
    await expect(runtime.open(user, 'https://b.test')).rejects.toMatchObject({ code: 'closed' })
  })
})
