import { describe, expect, it, vi } from 'vitest'
import { BrowserProfiles } from '../src/main/browserProfiles'
import { browserProfileMethod } from '../src/main/browserProfileMethods'
import { executeBrowserBridge } from '../src/main/browserBridge'
import {
  BrowserError,
  BrowserRuntime,
  MAX_TABS_PER_THREAD,
  allowedGuestUrl,
  type GuestFactory,
  type GuestHandlers,
  type GuestPage,
} from '../src/main/browserRuntime'

function setup(profiles: string[] = ['work'], available: (id: string) => boolean = () => true) {
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
        inspect: vi.fn(async () => ({
          url: 'https://a.test/',
          title: 'Page',
          text: 'hello',
          elements: [],
          truncated: false,
        })),
        act: vi.fn(async () => ({ ok: true })),
        setHumanInput: vi.fn(),
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
  const runtime = new BrowserRuntime(factory, () => profiles, changed, available)
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

  it('a person-opened tab is human-controlled and an agent-run tab starts with agent control', async () => {
    const { runtime } = setup()
    const mine = await runtime.open(user, 'https://a.test')
    expect(mine.tab.controller).toBe('human')
    const agents = await runtime.open(run, 'https://b.test')
    expect(agents.tab.controller).toBe('agent')
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

describe('page observations and native input', () => {
  it('enables native input only for a human controller, after old agent work drains', async () => {
    const { runtime, created } = setup()
    const { tab } = await runtime.open(run, 'https://a.test')
    const page = created[0]!.page
    expect(page.setHumanInput).toHaveBeenLastCalledWith(false)
    const observation = await runtime.inspectForAgent(tab.id, run.runId, user)
    let finish!: (value: { ok: boolean }) => void
    page.act = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = runtime.actForAgent(tab.id, run.runId, user, {
      kind: 'click',
      ref: 1,
      snapshot: observation.snapshot,
    })
    expect(runtime.takeControl(tab.id, 'local', { local: true })).toMatchObject({
      controller: 'human',
      inputReady: false,
    })
    expect(page.setHumanInput).toHaveBeenLastCalledWith(false)
    expect(() => runtime.reload(tab.id)).toThrow('wait for the agent action')
    finish({ ok: true })
    await pending
    expect(runtime.list()[0]!.inputReady).toBe(true)
    expect(page.setHumanInput).toHaveBeenLastCalledWith(true)
    runtime.controllerDisconnected('local')
    expect(page.setHumanInput).toHaveBeenLastCalledWith(false)
  })

  it('consumes a snapshot once, even when the guest refuses the action', async () => {
    const { runtime, created } = setup()
    const { tab } = await runtime.open(run, 'https://a.test')
    const snapshot = await runtime.inspectForAgent(tab.id, run.runId, user)
    const action = { kind: 'click' as const, ref: 1, snapshot: snapshot.snapshot }
    created[0]!.page.act = vi.fn(async () => ({ ok: false, reason: 'covered' }))
    expect(await runtime.actForAgent(tab.id, run.runId, user, action)).toEqual({ ok: false, reason: 'covered' })
    await expect(runtime.actForAgent(tab.id, run.runId, user, action)).rejects.toMatchObject({ code: 'stale-snapshot' })
    expect(created[0]!.page.act).toHaveBeenCalledTimes(1)
  })

  it('refuses concurrent observation/action, then requires a new observation after navigation or handoff', async () => {
    const { runtime, created } = setup()
    const { tab } = await runtime.open(run, 'https://a.test')
    let finish!: (value: Awaited<ReturnType<GuestPage['inspect']>>) => void
    const result = { url: 'https://a.test/', title: 'A', text: 'read', elements: [], truncated: false }
    created[0]!.page.inspect = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const reading = runtime.inspectForAgent(tab.id, run.runId, user)
    await expect(runtime.inspectForAgent(tab.id, run.runId, user)).rejects.toMatchObject({ code: 'busy' })
    runtime.takeControl(tab.id, 'local', { local: true })
    finish(result)
    await expect(reading).rejects.toMatchObject({ code: 'stale-snapshot' })
    created[0]!.page.inspect = vi.fn(async () => result)
    runtime.giveToAgent(tab.id, 'local', run.runId)
    const fresh = await runtime.inspectForAgent(tab.id, run.runId, user)
    created[0]!.handlers.onNavigate('https://b.test')
    await expect(
      runtime.actForAgent(tab.id, run.runId, user, { kind: 'click', ref: 1, snapshot: fresh.snapshot }),
    ).rejects.toMatchObject({ code: 'stale-snapshot' })
  })

  it('never returns a closed tab observation or lets another owner inspect it', async () => {
    const { runtime, created } = setup()
    const { tab } = await runtime.open(run, 'https://a.test')
    await expect(runtime.inspectForAgent(tab.id, run.runId, { ...user, hostId: 'other' })).rejects.toMatchObject({
      code: 'wrong-owner',
    })
    expect(created[0]!.page.inspect).not.toHaveBeenCalled()
    let finish!: (value: Awaited<ReturnType<GuestPage['inspect']>>) => void
    created[0]!.page.inspect = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const pending = runtime.inspectForAgent(tab.id, run.runId, user)
    runtime.close(tab.id)
    finish({ url: 'https://a.test/', title: 'A', text: '', elements: [], truncated: false })
    await expect(pending).rejects.toMatchObject({ code: 'closed' })
  })
})

describe('private server browser bridge', () => {
  it('refuses expired or wrong-thread requests before touching a guest', async () => {
    const { runtime, created } = setup()
    const { tab } = await runtime.open(run, 'https://a.test')
    const request = {
      requestId: 'request',
      clientId: 'desktop',
      threadId: 't',
      runId: 'r1',
      expiresAt: Date.now() - 1,
      command: { kind: 'snapshot' as const, tabId: tab.id },
    }
    await expect(executeBrowserBridge(runtime, 'h', request)).rejects.toThrow('expired')
    await expect(
      executeBrowserBridge(runtime, 'h', { ...request, expiresAt: Date.now() + 10000, threadId: 'other' }),
    ).rejects.toThrow('another thread')
    expect(created[0]!.page.inspect).not.toHaveBeenCalled()
  })

  it('keeps human control authoritative and revokes agent control on disconnect', async () => {
    const { runtime, created } = setup()
    const { tab } = await runtime.open(run, 'https://a.test')
    const request = {
      requestId: 'request',
      clientId: 'desktop',
      threadId: 't',
      runId: 'r1',
      expiresAt: Date.now() + 10000,
    }
    const snapshot = await runtime.inspectForAgent(tab.id, 'r1', user)
    runtime.takeControl(tab.id, 'local')
    await expect(
      executeBrowserBridge(runtime, 'h', {
        ...request,
        command: { kind: 'navigate', tabId: tab.id, url: 'https://b.test' },
      }),
    ).rejects.toMatchObject({ code: 'human-controlled' })
    runtime.giveToAgent(tab.id, 'local', 'r1')
    runtime.pauseForDisconnect()
    await expect(
      executeBrowserBridge(runtime, 'h', {
        ...request,
        command: { kind: 'click', tabId: tab.id, ref: 1, snapshot: snapshot.snapshot },
      }),
    ).rejects.toBeInstanceOf(BrowserError)
    expect(created[0]!.page.act).not.toHaveBeenCalled()
    expect(created[0]!.page.setHumanInput).toHaveBeenLastCalledWith(false)
  })
})

it('keeps a human-controlled popup human-controlled from its first load', async () => {
  const { runtime, created } = setup()
  const { tab } = await runtime.open(run, 'https://a.test')
  runtime.takeControl(tab.id, 'local')
  created[0]!.handlers.onOpenWindow('https://login.test')
  await vi.waitFor(() => expect(created).toHaveLength(2))
  expect(created[1]!.page.setHumanInput).toHaveBeenNthCalledWith(1, true)
  expect(runtime.list().find((entry) => entry.id !== tab.id)?.controller).toBe('human')
})

describe('profile administration and replacement', () => {
  const catalog = () => new BrowserProfiles('profiles', { read: () => '{"version":1,"profiles":[]}', write() {} })
  it('reviews exact tabs, clears every context before deleting metadata and keeps other profiles open', async () => {
    const profiles = catalog(),
      work = profiles.create('Work')
    const first = setup([work.id], (id) => !profiles.isBusy(id)),
      second = setup([work.id], (id) => !profiles.isBusy(id))
    await first.runtime.open(user, 'https://a.test', work.id)
    await second.runtime.open(user, 'https://signin.test', work.id)
    await first.runtime.open(user, 'https://other.test', 'default')
    let finish!: () => void
    const clearing = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const resetting = vi.fn(async () => {})
    const confirm = vi.fn(async () => true)
    const pending = browserProfileMethod(
      profiles,
      first.runtime,
      {
        confirm,
        clearData: clearing,
        resetDefault: resetting,
        runtimes: () => [first.runtime, second.runtime],
        changed() {},
      },
      'browser.profiles.delete',
      ['local', work.id],
    )
    await vi.waitFor(() => expect(clearing).toHaveBeenCalledWith(work.id))
    expect(confirm).toHaveBeenCalledWith({ name: 'Work', deleteProfile: true, tabs: 2 })
    expect(first.runtime.list().map((tab) => tab.url)).toEqual(['https://other.test/'])
    expect(second.runtime.list()).toEqual([])
    await expect(first.runtime.open(user, 'https://race.test', work.id)).rejects.toMatchObject({ code: 'busy' })
    expect(profiles.ids()).toEqual([work.id])
    finish()
    await pending
    expect(resetting).toHaveBeenCalledWith(work.id)
    expect(profiles.ids()).toEqual([])
  })

  it('does not clear a cancelled or changed review, and retains metadata when data removal fails', async () => {
    const profiles = catalog(),
      work = profiles.create('Work')
    const { runtime } = setup([work.id])
    const clearData = vi.fn(async () => {
      throw new Error('locked storage')
    })
    const actions = { clearData, resetDefault: vi.fn(async () => {}), changed() {}, confirm: vi.fn(async () => false) }
    await runtime.open(user, 'https://a.test', work.id)
    expect(
      await browserProfileMethod(profiles, runtime, actions, 'browser.profiles.clear', ['local', work.id]),
    ).toEqual({ cancelled: true })
    expect(runtime.list()).toHaveLength(1)
    const changed = {
      ...actions,
      confirm: async () => {
        await runtime.open(user, 'https://new.test', work.id)
        return true
      },
    }
    await expect(
      browserProfileMethod(profiles, runtime, changed, 'browser.profiles.clear', ['local', work.id]),
    ).rejects.toThrow('tabs changed')
    expect(clearData).not.toHaveBeenCalled()
    await expect(
      browserProfileMethod(profiles, runtime, { ...actions, confirm: async () => true }, 'browser.profiles.delete', [
        'local',
        work.id,
      ]),
    ).rejects.toThrow('locked storage')
    expect(profiles.ids()).toEqual([work.id])
    expect(actions.resetDefault).not.toHaveBeenCalled()
  })

  it('keeps the old page on replacement failure, and refuses unknown profiles without loading Default', async () => {
    const { runtime, created } = setup()
    const original = await runtime.open(user, 'https://a.test')
    await expect(runtime.changeProfile(original.tab.id, 'deleted')).rejects.toThrow('no longer available')
    expect(created).toHaveLength(1)
    const factory = (runtime as unknown as { factory: GuestFactory }).factory
    const make = factory.create.bind(factory)
    factory.create = (partition, handlers) => {
      const page = make(partition, handlers)
      page.load = async () => {
        throw new Error('network failed')
      }
      return page
    }
    await expect(runtime.changeProfile(original.tab.id, 'work')).rejects.toThrow('network failed')
    expect(created[0]!.page.destroyed).toBe(false)
    expect(created[1]!.page.destroyed).toBe(true)
    expect(runtime.list()).toHaveLength(1)
    expect(runtime.list()[0]).toMatchObject({ profileId: 'default', inputReady: true })
  })
})

describe('extended browser operations', () => {
  it('answers a website dialog without deadlocking the click it blocks', async () => {
    const { runtime, created } = setup()
    const { tab } = await runtime.open(run, 'https://a.test')
    const observed = await runtime.inspectForAgent(tab.id, 'r1', user)
    let finish!: (value: { ok: boolean }) => void
    let dialog: import('@ramu/shared/browserBridge').BrowserDialog | null = {
      id: 'dialog',
      type: 'confirm',
      message: 'Continue?',
    }
    const page = created[0]!.page
    page.dialog = () => dialog
    page.handleDialog = vi.fn(async () => {
      dialog = null
      finish({ ok: true })
    })
    page.act = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const click = runtime.actForAgent(tab.id, 'r1', user, { kind: 'click', ref: 1, snapshot: observed.snapshot })
    await runtime.handleDialogForAgent(tab.id, 'r1', user, 'dialog', true)
    await click
    runtime.takeControl(tab.id, 'local')
    expect(runtime.list()[0]!.inputReady).toBe(true)
    await expect(runtime.handleDialogForAgent(tab.id, 'r1', user, 'dialog', true)).rejects.toMatchObject({
      code: 'stale-snapshot',
    })
  })

  it('lets a human answer while a taken-over click is draining, while refusing agent answers', async () => {
    const { runtime, created } = setup()
    const { tab } = await runtime.open(run, 'https://a.test')
    const observed = await runtime.inspectForAgent(tab.id, 'r1', user)
    let finish!: (value: { ok: boolean }) => void
    let dialog: import('@ramu/shared/browserBridge').BrowserDialog | null = {
      id: 'dialog',
      type: 'confirm',
      message: 'Continue?',
    }
    const page = created[0]!.page
    page.dialog = () => dialog
    page.handleDialog = vi.fn(async () => {
      dialog = null
      finish({ ok: true })
    })
    page.act = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const click = runtime.actForAgent(tab.id, 'r1', user, { kind: 'click', ref: 1, snapshot: observed.snapshot })
    runtime.takeControl(tab.id, 'local')
    expect(runtime.list()[0]!.inputReady).toBe(false)
    await expect(runtime.handleDialogForAgent(tab.id, 'r1', user, 'dialog', true)).rejects.toMatchObject({
      code: 'human-controlled',
    })
    await runtime.handleDialogAsHuman(tab.id, 'dialog', true)
    await click
    expect(runtime.list()[0]!.inputReady).toBe(true)
  })

  it('fences captures across takeover and uses bounded waits without replaying page actions', async () => {
    const { runtime, created } = setup()
    const { tab } = await runtime.open(run, 'https://a.test')
    const page = created[0]!.page
    let finish!: (image: import('@ramu/shared/browserBridge').BrowserScreenshot) => void
    page.screenshot = () =>
      new Promise((resolve) => {
        finish = resolve
      })
    const capture = runtime.screenshotForAgent(tab.id, 'r1', user)
    runtime.takeControl(tab.id, 'local')
    finish({ mimeType: 'image/jpeg', data: 'image', width: 100, height: 100 })
    await expect(capture).rejects.toMatchObject({ code: 'stale-snapshot' })
    runtime.giveToAgent(tab.id, 'local', 'r1')
    const missed = await runtime.waitForAgent(tab.id, 'r1', user, 'missing', 0)
    expect(missed.matched).toBe(false)
    const matched = await runtime.waitForAgent(tab.id, 'r1', user, 'hello', 0)
    expect(matched.matched).toBe(true)
    expect(page.act).not.toHaveBeenCalled()
  })
})

it('never reuses a closed Temporary partition while its site-data cleanup is still pending', async () => {
  const { runtime, created } = setup()
  const factory = (runtime as unknown as { factory: GuestFactory }).factory
  let finish!: () => void
  factory.clearTemporary = () =>
    new Promise<void>((resolve) => {
      finish = resolve
    })
  const first = await runtime.open(run, 'https://a.test', 'temporary')
  runtime.close(first.tab.id)
  await runtime.open(run, 'https://next.test', 'temporary')
  expect(created[1]!.partition).not.toBe(created[0]!.partition)
  finish()
})

it('retains a human replacement page at run end and reports failed Temporary cleanup without reusing it', async () => {
  const { runtime } = setup()
  const original = await runtime.open(run, 'https://a.test')
  runtime.takeControl(original.tab.id, 'local')
  const replacement = await runtime.changeProfile(original.tab.id, 'temporary')
  runtime.endRun(run)
  expect(runtime.list()).toEqual([expect.objectContaining({ id: replacement.id, runId: null, controller: 'human' })])
  const factory = (runtime as unknown as { factory: GuestFactory }).factory
  factory.clearTemporary = async () => {
    throw new Error('native storage locked')
  }
  runtime.close(replacement.id)
  await vi.waitFor(() => expect(runtime.warning()).toContain('will not be reused'))
})
