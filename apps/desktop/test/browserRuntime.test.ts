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

function setup(profiles: string[] = ['work'], available: (id: string) => boolean = () => true, now?: () => number) {
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
  const runtime = new BrowserRuntime(factory, () => profiles, changed, available, undefined, now)
  return { runtime, created, cleared, changed }
}
const user = { hostId: 'h', threadId: 't' }
const run = { hostId: 'h', threadId: 't', runId: 'r1' }

describe('urls', () => {
  it('dispatches hover and drag to the snapshot-bound page actions', async () => {
    const { runtime, created } = setup()
    const opened = await runtime.open(run, 'https://a.test')
    for (const kind of ['hover', 'drag'] as const) {
      const snapshot = await runtime.inspectForAgent(opened.tab.id, run.runId, run)
      await executeBrowserBridge(runtime, run.hostId, {
        requestId: 'request',
        clientId: 'desktop',
        threadId: run.threadId,
        runId: run.runId,
        expiresAt: Date.now() + 1000,
        command:
          kind === 'drag'
            ? { kind, tabId: opened.tab.id, snapshot: snapshot.snapshot, ref: 1, toRef: 2 }
            : { kind, tabId: opened.tab.id, snapshot: snapshot.snapshot, ref: 1 },
      })
      expect(created[0]!.page.act).toHaveBeenLastCalledWith(expect.objectContaining({ kind }))
    }
    runtime.closeAll()
  })
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

  it('closes its own tab without a fresh observation, also after the run that opened it ended, but never a tab the person holds', async () => {
    const { runtime, created } = setup()
    const first = await runtime.open(user, 'https://a.test')
    runtime.giveToAgent(first.tab.id, 'local', 'r1')
    await runtime.closeForAgent(first.tab.id, 'r1', user)
    expect(created[0]!.page.destroyed).toBe(true)
    const left = await runtime.open(user, 'https://b.test')
    runtime.giveToAgent(left.tab.id, 'local', 'r1')
    runtime.endRun(run)
    await runtime.closeForAgent(left.tab.id, 'r2', user)
    expect(created[1]!.page.destroyed).toBe(true)
    const held = await runtime.open(user, 'https://c.test')
    await expect(runtime.closeForAgent(held.tab.id, 'r1', { hostId: 'h', threadId: 'another' })).rejects.toMatchObject({
      code: 'wrong-owner',
    })
    await expect(runtime.closeForAgent(held.tab.id, 'r1', user)).rejects.toMatchObject({ code: 'human-controlled' })
    expect(created[2]!.page.destroyed).toBe(false)
  })

  it("a tab handed back with no run active is taken over by the thread's next run, not lost", async () => {
    const { runtime } = setup()
    const { tab } = await runtime.open(user, 'https://a.test')
    runtime.takeControl(tab.id, 'local')
    const handed = runtime.releaseForNextRun(tab.id, 'local')
    expect(handed).toMatchObject({ controller: 'none', released: true })
    // Another thread's run cannot claim it.
    expect(() => runtime.adoptReleased(tab.id, 'r2', { hostId: 'h', threadId: 'another' })).toThrow(BrowserError)
    runtime.adoptReleased(tab.id, 'r2', user)
    const adopted = runtime.list(user)[0]!
    expect(adopted.controller).toBe('agent')
    expect(adopted.released).toBeUndefined()
    runtime.observeForAgent(tab.id, 'r2')
    await expect(runtime.agentAction(tab.id, 'r2', adopted.generation, user, async () => 'ok')).resolves.toBe('ok')
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
    runtime.takeControl(tab.id, 'local')
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
    expect(runtime.takeControl(tab.id, 'local').controller).toBe('human')
  })

  it('another device takes the tab at a new generation, and a disconnect pauses it', async () => {
    const { runtime } = setup()
    const { tab } = await runtime.open({ ...user }, 'https://a.test')
    const phone = runtime.takeControl(tab.id, 'phone')
    const desktop = runtime.takeControl(tab.id, 'desktop-b')
    expect(desktop.generation).toBeGreaterThan(phone.generation)
    runtime.takeControl(tab.id, 'phone')
    runtime.controllerDisconnected('phone')
    await expect(runtime.agentAction(tab.id, 'r1', 0, user, async () => 1)).rejects.toBeInstanceOf(BrowserError)
  })
})

describe('phone layout', () => {
  it('lays a page out for the controlling phone and restores it when control changes', async () => {
    const { runtime, created } = setup()
    const { tab } = await runtime.open({ ...user }, 'https://a.test')
    const fit = vi.fn(async () => {})
    Object.assign(created[0]!.page, { fit })
    await expect(runtime.fitToViewer(tab.id, 'phone', { width: 390, height: 700 }, user)).rejects.toBeInstanceOf(
      BrowserError,
    )
    runtime.takeControl(tab.id, 'phone')
    expect(await runtime.fitToViewer(tab.id, 'phone', { width: 390, height: 700 }, user)).toEqual({ fitted: true })
    expect(fit).toHaveBeenLastCalledWith({ width: 390, height: 700 })
    expect(runtime.list()[0]!.fitted).toBe(true)
    runtime.giveToAgent(tab.id, 'phone', 'r1')
    expect(fit).toHaveBeenLastCalledWith(null)
    expect(runtime.list()[0]!.fitted).toBeUndefined()
  })

  it('restores the layout when the fitted phone disconnects', async () => {
    const { runtime, created } = setup()
    const { tab } = await runtime.open({ ...user }, 'https://a.test')
    const fit = vi.fn(async () => {})
    Object.assign(created[0]!.page, { fit })
    runtime.takeControl(tab.id, 'phone')
    await runtime.fitToViewer(tab.id, 'phone', { width: 390, height: 700 }, user)
    runtime.controllerDisconnected('phone')
    expect(fit).toHaveBeenLastCalledWith(null)
  })

  it('tells only the controlling phone which kind of field has focus', async () => {
    const { runtime, created } = setup()
    const { tab } = await runtime.open({ ...user }, 'https://a.test')
    Object.assign(created[0]!.page, { focusedField: vi.fn(async () => ({ editable: true, kind: 'email' })) })
    await expect(runtime.focusedFieldForHuman(tab.id, 'phone', user)).rejects.toBeInstanceOf(BrowserError)
    runtime.takeControl(tab.id, 'phone')
    expect(await runtime.focusedFieldForHuman(tab.id, 'phone', user)).toEqual({ editable: true, kind: 'email' })
  })

  it('changes zoom and appearance only for the controlling device and reports them on the tab', async () => {
    const { runtime, created } = setup()
    const { tab } = await runtime.open({ ...user }, 'https://a.test')
    const adjust = vi.fn(async () => {})
    Object.assign(created[0]!.page, { adjust })
    await expect(runtime.adjustAsHuman(tab.id, 'phone', { zoom: 1.5 }, user)).rejects.toBeInstanceOf(BrowserError)
    runtime.takeControl(tab.id, 'phone')
    expect((await runtime.adjustAsHuman(tab.id, 'phone', { zoom: 1.5 }, user)).zoom).toBe(1.5)
    expect((await runtime.adjustAsHuman(tab.id, 'phone', { colorScheme: 'dark' }, user)).colorScheme).toBe('dark')
    const reset = await runtime.adjustAsHuman(tab.id, 'phone', { colorScheme: 'system' }, user)
    expect(reset.colorScheme).toBeUndefined()
    expect((await runtime.adjustAsHuman(tab.id, 'phone', { zoom: 1 }, user)).zoom).toBeUndefined()
    expect(adjust).toHaveBeenCalledWith({ zoom: 1.5 })
  })

  it('lets the controlling run switch a tab between light and dark mode, but not a tab the person holds', async () => {
    const { runtime, created } = setup()
    const { tab } = await runtime.open(run, 'https://a.test')
    const adjust = vi.fn(async () => {})
    Object.assign(created[0]!.page, { adjust })
    const appearance = (colorScheme: 'light' | 'dark' | 'system') =>
      executeBrowserBridge(runtime, run.hostId, {
        requestId: 'request',
        clientId: 'desktop',
        threadId: run.threadId,
        runId: run.runId,
        expiresAt: Date.now() + 1000,
        command: { kind: 'appearance', tabId: tab.id, colorScheme },
      }) as Promise<{ colorScheme?: string }>
    expect((await appearance('dark')).colorScheme).toBe('dark')
    expect(adjust).toHaveBeenLastCalledWith({ colorScheme: 'dark' })
    expect((await appearance('system')).colorScheme).toBeUndefined()
    runtime.takeControl(tab.id, 'phone')
    await expect(appearance('light')).rejects.toBeInstanceOf(BrowserError)
    expect(adjust).toHaveBeenCalledTimes(2)
  })

  it('lays a tab out at the size the run chose until a person takes control', async () => {
    const { runtime, created } = setup()
    const { tab } = await runtime.open(run, 'https://a.test')
    const emulate = vi.fn(async () => {})
    Object.assign(created[0]!.page, { emulate })
    const phone = { width: 390, height: 844, mobile: true }
    expect((await runtime.resizeForAgent(tab.id, run.runId, run, phone)).viewport).toEqual(phone)
    expect(emulate).toHaveBeenLastCalledWith(phone)
    await expect(
      runtime.resizeForAgent(tab.id, run.runId, run, { width: 10, height: 10, mobile: false }),
    ).rejects.toThrow('from 200 to 4000')
    runtime.takeControl(tab.id, 'phone')
    expect(emulate).toHaveBeenLastCalledWith(null)
    expect(runtime.list(user).find((entry) => entry.id === tab.id)?.viewport).toBeUndefined()
  })

  it('leaves a page shown on a desktop untouched', async () => {
    const { runtime } = setup()
    const { tab } = await runtime.open({ ...user }, 'https://a.test')
    runtime.takeControl(tab.id, 'phone')
    expect(await runtime.fitToViewer(tab.id, 'phone', { width: 390, height: 700 }, user)).toEqual({ fitted: false })
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

  it('forgets a tab and releases its temporary data even when its page fails to destroy', async () => {
    const { runtime, created, cleared } = setup()
    const { tab } = await runtime.open(user, 'https://a.test', 'temporary')
    created[0]!.page.destroy = () => {
      throw new Error('already destroyed')
    }
    runtime.closeAll()
    expect(runtime.list()).toEqual([])
    expect(cleared).toEqual([created[0]!.partition])
    expect(tab.id).toBeTruthy()
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
    expect(page.setHumanInput).toHaveBeenLastCalledWith(false, false)
    const observation = await runtime.inspectForAgent(tab.id, run.runId, user)
    let finish!: (value: { ok: boolean }) => void
    page.act = vi.fn(
      () =>
        new Promise<{ ok: boolean }>((resolve) => {
          finish = resolve
        }),
    )
    const pending = runtime.actForAgent(tab.id, run.runId, user, {
      kind: 'click',
      ref: 1,
      snapshot: observation.snapshot,
    })
    expect(runtime.takeControl(tab.id, 'local')).toMatchObject({
      controller: 'human',
      inputReady: false,
    })
    expect(page.setHumanInput).toHaveBeenLastCalledWith(false, false)
    await expect(runtime.reload(tab.id)).rejects.toThrow('wait for the agent action')
    finish({ ok: true })
    await pending
    expect(runtime.list()[0]!.inputReady).toBe(true)
    expect(page.setHumanInput).toHaveBeenLastCalledWith(true, true)
    runtime.controllerDisconnected('local')
    expect(page.setHumanInput).toHaveBeenLastCalledWith(false, false)
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
        new Promise<Awaited<ReturnType<GuestPage['inspect']>>>((resolve) => {
          finish = resolve
        }),
    )
    const reading = runtime.inspectForAgent(tab.id, run.runId, user)
    await expect(runtime.inspectForAgent(tab.id, run.runId, user)).rejects.toMatchObject({ code: 'busy' })
    runtime.takeControl(tab.id, 'local')
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
        new Promise<Awaited<ReturnType<GuestPage['inspect']>>>((resolve) => {
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
  it('applies a staged upload to one fresh file-input reference and clears it on takeover', async () => {
    const { runtime, created } = setup()
    const { tab } = await runtime.open(run, 'https://a.test')
    const snapshot = await runtime.inspectForAgent(tab.id, run.runId, user)
    const { uploadId } = runtime.beginUpload(tab.id, run.runId, user, 'report.txt', 5)
    runtime.uploadChunk(tab.id, run.runId, user, uploadId, 0, 'aGVsbG8=')
    await runtime.uploadForAgent(tab.id, run.runId, user, uploadId, snapshot.snapshot, 1)
    expect(created[0]!.page.act).toHaveBeenCalledWith({
      kind: 'upload',
      snapshot: snapshot.snapshot,
      ref: 1,
      name: 'report.txt',
      data: 'aGVsbG8=',
    })
    const next = await runtime.inspectForAgent(tab.id, run.runId, user)
    const staged = runtime.beginUpload(tab.id, run.runId, user, 'empty.txt', 0)
    runtime.takeControl(tab.id, 'person')
    await expect(runtime.uploadForAgent(tab.id, run.runId, user, staged.uploadId, next.snapshot, 1)).rejects.toThrow()
    expect(created[0]!.page.act).toHaveBeenCalledTimes(1)
    runtime.closeAll()
  })
  it('presents only an owned existing tab without navigating, reloading or transferring control', async () => {
    const { runtime, created } = setup()
    const { tab } = await runtime.open(run, 'https://a.test')
    runtime.takeControl(tab.id, 'person')
    const request = {
      requestId: 'present',
      clientId: 'desktop',
      threadId: 't',
      runId: 'r1',
      expiresAt: Date.now() + 10000,
      command: { kind: 'present' as const, tabId: tab.id },
    }
    const presented = await executeBrowserBridge(runtime, 'h', request)
    expect(presented).toMatchObject({ id: tab.id, controller: 'human' })
    expect(created[0]!.page.load).toHaveBeenCalledTimes(1)
    expect(created[0]!.page.reload).not.toHaveBeenCalled()
    expect(created[0]!.page.show).not.toHaveBeenCalled()
    await expect(executeBrowserBridge(runtime, 'h', { ...request, threadId: 'other' })).rejects.toThrow(
      'another thread',
    )
  })
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
    expect(created[0]!.page.setHumanInput).toHaveBeenLastCalledWith(false, false)
  })
})

it('keeps a human-controlled popup human-controlled from its first load', async () => {
  const { runtime, created } = setup()
  const { tab } = await runtime.open(run, 'https://a.test')
  runtime.takeControl(tab.id, 'local')
  created[0]!.handlers.onOpenWindow('https://login.test')
  await vi.waitFor(() => expect(created).toHaveLength(2))
  expect(created[1]!.page.setHumanInput).toHaveBeenNthCalledWith(1, true, true)
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
        new Promise<{ ok: boolean }>((resolve) => {
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
        new Promise<{ ok: boolean }>((resolve) => {
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

describe('idle tabs', () => {
  it('closes an idle agent-owned tab, keeps a person-controlled one, and counts use as activity', async () => {
    let clock = 1_000
    const { runtime, created, changed } = setup(
      ['work'],
      () => true,
      () => clock,
    )
    const agent = await runtime.open(run, 'https://a.test')
    const human = await runtime.open(user, 'https://b.test')
    const busy = await runtime.open({ ...run, runId: 'r2' }, 'https://c.test')
    clock += 29 * 60_000
    // Using a tab (here, showing it) counts as activity and restarts its clock.
    runtime.show(busy.tab.id, { x: 0, y: 0, width: 10, height: 10 })
    clock += 2 * 60_000
    changed.mockClear()
    expect(runtime.sweepIdle()).toBe(1)
    expect(created[0]!.page.destroyed).toBe(true)
    expect(created[1]!.page.destroyed).toBe(false)
    expect(created[2]!.page.destroyed).toBe(false)
    expect(
      runtime
        .list()
        .map((tab) => tab.id)
        .sort(),
    ).toEqual([human.tab.id, busy.tab.id].sort())
    expect(changed).toHaveBeenCalled()
    expect(agent.tab.id).not.toBe(human.tab.id)
    // Nothing left idle: a second sweep closes nothing and tells nobody.
    changed.mockClear()
    expect(runtime.sweepIdle()).toBe(0)
    expect(changed).not.toHaveBeenCalled()
    runtime.closeAll()
  })

  it('a person-controlled tab is never closed for being idle', async () => {
    let clock = 0
    const { runtime } = setup(
      ['work'],
      () => true,
      () => clock,
    )
    await runtime.open(user, 'https://a.test')
    clock += 24 * 60 * 60_000
    expect(runtime.sweepIdle()).toBe(0)
    runtime.closeAll()
  })
})

it('keeps a tab ready for the person while their own input runs, and runs it in order', async () => {
  const { runtime, created } = setup()
  const { tab } = await runtime.open(user, 'https://a.test', undefined, { kind: 'human', deviceId: 'phone' })
  const order: string[] = []
  let finish!: () => void
  created[0]!.page.input = vi.fn(async (input) => {
    order.push(`start ${input.kind}`)
    if (input.kind === 'click') await new Promise<void>((resolve) => (finish = resolve))
    order.push(`end ${input.kind}`)
  })
  const click = runtime.inputAsHuman(tab.id, 'phone', tab.generation, user, {
    kind: 'click',
    x: 0.5,
    y: 0.5,
    button: 'left',
    clickCount: 1,
  })
  await Promise.resolve()
  expect(runtime.list(user)[0]!.inputReady).toBe(true)
  const typing = runtime.inputAsHuman(tab.id, 'phone', tab.generation, user, { kind: 'text', text: 'hi' })
  await new Promise((resolve) => setTimeout(resolve, 0))
  finish()
  await Promise.all([click, typing])
  expect(order).toEqual(['start click', 'end click', 'start text', 'end text'])
  expect(runtime.list(user)[0]!.inputReady).toBe(true)
})

it('tells each device whether it is the one in control, and lets this computer use the page only while it is', async () => {
  const { runtime, created } = setup()
  const { tab } = await runtime.open(user, 'https://a.test')
  const page = created[0]!.page
  expect(runtime.list(user, 'local')[0]!.controlledHere).toBe(true)
  expect(page.setHumanInput).toHaveBeenLastCalledWith(true, true)
  runtime.takeControl(tab.id, 'phone')
  expect(runtime.list(user, 'local')[0]!.controlledHere).toBe(false)
  expect(runtime.list(user, 'phone')[0]!.controlledHere).toBe(true)
  // The phone drives the page; the mouse and keyboard at this computer do not.
  expect(page.setHumanInput).toHaveBeenLastCalledWith(true, false)
  expect(runtime.takeControl(tab.id, 'local').controlledHere).toBe(true)
  expect(runtime.list(user, 'phone')[0]!.controlledHere).toBe(false)
  expect(page.setHumanInput).toHaveBeenLastCalledWith(true, true)
})
