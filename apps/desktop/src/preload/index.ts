/// <reference lib="dom" />
// Exposes a narrow bridge; the renderer never sees ipcRenderer or Node APIs.
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { PushEvents, RamuBridge } from '@ramu/shared/api'
import { HOST_PUSH_CHANNELS, WINDOW_PUSH_CHANNELS } from '@ramu/shared/pushChannels'

const PUSH_EVENTS = new Set<string>([...HOST_PUSH_CHANNELS, ...WINDOW_PUSH_CHANNELS])

let controlsInset = process.platform === 'darwin' ? 84 : 0
const applyWindowChrome = () =>
  document.documentElement?.style.setProperty('--window-controls-inset', `${controlsInset}px`)
window.addEventListener('DOMContentLoaded', applyWindowChrome, { once: true })
ipcRenderer.on('ramu:window-chrome', (_event, chrome: { controlsInset: number }) => {
  controlsInset = chrome.controlsInset
  applyWindowChrome()
})

const deviceState = (() => {
  try {
    const value = ipcRenderer.sendSync('ramu:device-state') as unknown
    return value && typeof value === 'object' ? (value as Record<string, string>) : {}
  } catch {
    return {}
  }
})()

// Electron wraps handler failures as "Error invoking remote method '...': Error: <message>"; people should only see the message.
const call = (method: string, args: unknown[], host?: string): Promise<any> =>
  (host === undefined
    ? ipcRenderer.invoke('ramu:invoke', method, args)
    : ipcRenderer.invoke('ramu:invoke', method, args, host)
  ).catch((error: unknown) => {
    throw new Error(
      (error instanceof Error ? error.message : String(error)).replace(
        /^Error invoking remote method '[^']+': (Error: )?/,
        '',
      ),
    )
  })

// Import before application modules can read drafts or unread state. Existing shell values always win.
if (!process.argv.includes('--ramu-storage-migration')) {
  try {
    const hosts = ipcRenderer.sendSync('ramu:legacy-storage') as Record<string, Record<string, string>>
    for (const [host, entries] of Object.entries(hosts ?? {})) {
      try {
        for (const [key, value] of Object.entries(entries))
          if (localStorage.getItem(key) === null) localStorage.setItem(key, value)
        ipcRenderer.send('ramu:legacy-storage:imported', host)
      } catch {
        /* Retry this host on the next launch if storage is full or unavailable. */
      }
    }
  } catch {
    /* Older main processes have no partition migration. */
  }
}

const bridge: RamuBridge = {
  hostId: 'local',
  invoke: (method, ...args) => call(method, args),
  invokeOn: (host, method, ...args) => call(method, args, host),
  on(event, listener) {
    if (!PUSH_EVENTS.has(event)) throw new Error(`Unknown event ${event}`)
    // The host follows the payload so one shell can route every host independently.
    const wrapped = (_e: IpcRendererEvent, payload: PushEvents[typeof event], host?: string) => listener(payload, host)
    ipcRenderer.on(event, wrapped)
    return () => ipcRenderer.removeListener(event, wrapped)
  },
  deviceState,
  setDeviceState: (key, value) => ipcRenderer.send('ramu:device-state:set', key, value),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
}

contextBridge.exposeInMainWorld('ramu', bridge)
