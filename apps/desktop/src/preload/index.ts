/// <reference lib="dom" />
// Exposes a narrow bridge; the renderer never sees ipcRenderer or Node APIs.
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { PushEvents, RamuBridge, RamuMethods } from '@ramu/shared/api'
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
const call = (method: string, args: unknown[], host?: string, operationKey?: string): Promise<unknown> =>
  (operationKey !== undefined
    ? ipcRenderer.invoke('ramu:invoke', method, args, host, operationKey)
    : host === undefined
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

/** The one place a host's answer takes its method's declared type; the host validated the call and built the result. */
const typed = <M extends keyof RamuMethods>(method: M, args: unknown[], host?: string, operationKey?: string) =>
  call(method, args, host, operationKey) as Promise<Awaited<ReturnType<RamuMethods[M]>>>

const bridge: RamuBridge = {
  hostId: 'local',
  invoke: (method, ...args) => typed(method, args),
  invokeOn: (host, method, ...args) => typed(method, args, host),
  invokeOnce: (operationKey, host, method, ...args) => typed(method, args, host, operationKey),
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

// Dictation: the shell captures audio only after a person's action and holds a token main issued. Errors keep their
// `voice:<reason>` message so the page can tell a denied microphone from an unavailable recognizer.
const voice: NonNullable<RamuBridge['voice']> = {
  capability: (language) => ipcRenderer.invoke('ramu:voice:capability', language),
  begin: (language) => ipcRenderer.invoke('ramu:voice:begin', language),
  transcribe: (token, pcm, language) => ipcRenderer.invoke('ramu:voice:transcribe', token, pcm, language),
  cancel: (token) => ipcRenderer.invoke('ramu:voice:cancel', token),
  openSettings: () => ipcRenderer.invoke('ramu:voice:settings'),
}

contextBridge.exposeInMainWorld('ramu', { ...bridge, voice })
