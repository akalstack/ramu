import { beforeEach, expect, it, vi } from 'vitest'
import { BrowserProfiles } from '../src/main/browserProfiles'
import { BrowserSignInWindows } from '../src/main/browserSignIn'
import type { BrowserRuntime } from '../src/main/browserRuntime'

const state = vi.hoisted(() => ({ windows: [] as any[], pages: [] as any[], failLoad: false }))
vi.mock('electron', () => ({
  BrowserWindow: class {
    destroyed = false
    events = new Map<string, () => void>()
    show = vi.fn()
    focus = vi.fn()
    setMenu = vi.fn()
    setTitle = vi.fn()
    constructor(readonly options: unknown) {
      state.windows.push(this)
    }
    isDestroyed() {
      return this.destroyed
    }
    getContentBounds() {
      return { x: 0, y: 0, width: 1000, height: 760 }
    }
    on(name: string, callback: () => void) {
      this.events.set(name, callback)
    }
    close() {
      this.destroyed = true
      this.events.get('closed')?.()
    }
  },
}))
vi.mock('../src/main/electronGuest', () => ({
  ElectronGuestFactory: class {
    create(partition: string) {
      const page = {
        partition,
        url: () => 'https://example.com/',
        title: () => 'Sign in',
        load: vi.fn(async () => {
          if (state.failLoad) throw new Error('load failed')
        }),
        back() {},
        forward() {},
        reload() {},
        inspect: async () => ({
          url: 'https://example.com',
          title: 'Sign in',
          text: '',
          elements: [],
          truncated: false,
        }),
        act: async () => ({ ok: true }),
        setHumanInput: vi.fn(),
        show: vi.fn(),
        hide: vi.fn(),
        destroy: vi.fn(),
      }
      state.pages.push(page)
      return page
    }
    clearTemporary() {}
  },
}))
beforeEach(() => {
  state.windows = []
  state.pages = []
  state.failLoad = false
})
const setup = () => {
  const profiles = new BrowserProfiles('profiles', { read: () => '{"version":1,"profiles":[]}', write() {} })
  const work = profiles.create('Work')
  const runtimes = new Set<BrowserRuntime>()
  return { profiles, work, runtimes, service: new BrowserSignInWindows(profiles, runtimes, () => {}) }
}

it('opens a sandboxed user-only profile context without creating an agent or project thread', async () => {
  const { work, runtimes, service } = setup()
  await service.open(work.id, 'https://example.com/login')
  expect(runtimes.size).toBe(1)
  expect([...runtimes][0]!.list()[0]).toMatchObject({
    profileId: work.id,
    controller: 'human',
    threadId: `profile-sign-in:${work.id}`,
    runId: null,
  })
  expect(state.pages[0].partition).toBe(`persist:ramu-browser:${work.id}`)
  expect(state.windows[0].options.webPreferences).toMatchObject({
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    partition: 'ramu-browser-sign-in-shell',
  })
  expect(state.windows[0].options.webPreferences).not.toHaveProperty('preload')
  service.closeAll()
  expect(runtimes.size).toBe(0)
})

it('keeps an unfinished sign-in when asked to open the same identity again and closes it during profile cleanup', async () => {
  const { work, runtimes, service } = setup()
  await service.open(work.id, 'https://example.com/login')
  await service.open(work.id, 'https://other.example/login')
  expect(state.windows).toHaveLength(1)
  expect(state.pages[0].load).toHaveBeenCalledTimes(1)
  expect(state.windows[0].focus).toHaveBeenCalled()
  await [...runtimes][0]!.withClosedProfile(work.id, async () => {})
  expect(state.windows[0].destroyed).toBe(true)
  expect(runtimes.size).toBe(0)
})

it('refuses invalid or locked identities before creating a window and cleans up a failed load', async () => {
  const { profiles, work, runtimes, service } = setup()
  await expect(service.open(work.id, 'file:///private/file')).rejects.toThrow('http or https')
  await expect(service.open('temporary', 'https://example.com')).rejects.toThrow('persistent')
  await profiles.withLock(work.id, async () => {
    await expect(service.open(work.id, 'https://example.com')).rejects.toThrow('already being changed')
  })
  expect(state.windows).toEqual([])
  state.failLoad = true
  await expect(service.open(work.id, 'https://example.com')).rejects.toThrow('load failed')
  expect(state.windows[0].destroyed).toBe(true)
  expect(runtimes.size).toBe(0)
})
