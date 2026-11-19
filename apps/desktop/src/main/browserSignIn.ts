import { BrowserWindow } from 'electron'
import { BrowserRuntime, allowedGuestUrl } from './browserRuntime'
import { ElectronGuestFactory } from './electronGuest'
import type { BrowserProfiles } from './browserProfiles'

/** User-only website sign-in, using the same sandboxed guest/runtime as thread browsing. No provider or task is started. */
export class BrowserSignInWindows {
  private readonly windows = new Map<string, { window: BrowserWindow; runtime: BrowserRuntime }>()
  constructor(
    private readonly profiles: BrowserProfiles,
    private readonly runtimes: Set<BrowserRuntime>,
    private readonly changed: () => void,
  ) {}

  async open(id: string, address: string): Promise<void> {
    const profile = this.profiles.catalog().profiles.find((entry) => entry.id === id && !entry.temporary)
    if (!profile) throw new Error('Choose an available persistent browser profile.')
    if (this.profiles.isBusy(id)) throw new Error('This browser profile is already being changed.')
    const url = allowedGuestUrl(address)
    if (!url) throw new Error('Enter an http or https website address.')
    const existing = this.windows.get(id)
    if (existing && !existing.window.isDestroyed()) {
      existing.window.show()
      existing.window.focus()
      return
    }
    if (this.windows.size >= 3) throw new Error('Close a sign-in window before opening another.')
    const window = new BrowserWindow({
      width: 1000,
      height: 760,
      show: false,
      title: profile.name,
      webPreferences: {
        partition: 'ramu-browser-sign-in-shell',
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    })
    window.setMenu(null)
    let ready = false
    const place = () => {
      if (!ready || window.isDestroyed()) return
      const tabs = runtime.list()
      if (!tabs.length) {
        window.close()
        return
      }
      const tab = tabs.at(-1)!
      for (const other of tabs) if (other.id !== tab.id) runtime.hide(other.id)
      const { width, height } = window.getContentBounds()
      runtime.show(tab.id, { x: 0, y: 0, width, height })
      window.setTitle(`${profile.name} — ${tab.title || tab.url}`)
    }
    const runtime = new BrowserRuntime(
      new ElectronGuestFactory(() => (window.isDestroyed() ? null : window)),
      () => this.profiles.ids(),
      () => {
        place()
        this.changed()
      },
      (profileId) => !this.profiles.isBusy(profileId),
    )
    this.windows.set(id, { window, runtime })
    this.runtimes.add(runtime)
    window.on('resize', place)
    window.on('closed', () => {
      if (this.windows.get(id)?.window === window) this.windows.delete(id)
      this.runtimes.delete(runtime)
      runtime.closeAll()
      this.changed()
    })
    try {
      await runtime.open({ hostId: 'local', threadId: `profile-sign-in:${id}` }, url.toString(), id)
      ready = true
      place()
      if (!window.isDestroyed()) window.show()
    } catch (error) {
      if (!window.isDestroyed()) window.close()
      throw error
    }
  }

  closeAll() {
    for (const { window } of this.windows.values()) if (!window.isDestroyed()) window.close()
  }
}
