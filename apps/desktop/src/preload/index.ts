/// <reference lib="dom" />
// Exposes a narrow bridge; the renderer never sees ipcRenderer or Node APIs.
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { PushEvents, RamuBridge } from '@ramu/shared/api'

const PUSH_EVENTS = new Set<string>([
  'settings:changed',
  'settings:models',
  'workspace:visibility',
  'workspace:checkpoint',
  'activity:changed',
  'menu:action',
  'pair:link',
  'updates:changed',
  'providers:updates',
  'automation:changed',
  'workspace:changed',
  'memory:changed',
  'summaries:changed',
  'notify:inapp',
  'notify:open',
  'background:connection',
  'computers:changed',
  'agent:event',
  'term:data',
  'term:exit',
  'term:changed',
  'notices:changed',
  'fs:changed',
  'usage:changed',
  'aside:changed',
  'context:changed',
])

let controlsInset = process.platform === 'darwin' ? 84 : 0
const applyWindowChrome = () =>
  document.documentElement?.style.setProperty('--window-controls-inset', `${controlsInset}px`)
window.addEventListener('DOMContentLoaded', applyWindowChrome, { once: true })
ipcRenderer.on('ramu:window-chrome', (_event, chrome: { controlsInset: number }) => {
  controlsInset = chrome.controlsInset
  applyWindowChrome()
})

const bridge: RamuBridge = {
  // Electron wraps handler failures as "Error invoking remote method '...': Error: <message>"; people should only see the message.
  invoke: (method, ...args) =>
    ipcRenderer.invoke('ramu:invoke', method, args).catch((error: unknown) => {
      throw new Error(
        (error instanceof Error ? error.message : String(error)).replace(
          /^Error invoking remote method '[^']+': (Error: )?/,
          '',
        ),
      )
    }),
  on(event, listener) {
    if (!PUSH_EVENTS.has(event)) throw new Error(`Unknown event ${event}`)
    const wrapped = (_e: IpcRendererEvent, payload: PushEvents[typeof event]) => listener(payload)
    ipcRenderer.on(event, wrapped)
    return () => ipcRenderer.removeListener(event, wrapped)
  },
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
}

contextBridge.exposeInMainWorld('ramu', bridge)
