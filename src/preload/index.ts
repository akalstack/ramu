// Exposes a narrow bridge; the renderer never sees ipcRenderer or Node APIs.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { PushEvents, RamuBridge } from '../shared/api'

const PUSH_EVENTS = new Set<string>(['providers:updates', 'automation:changed', 'notify:inapp', 'notify:open', 'background:connection', 'agent:event', 'term:data', 'term:exit', 'fs:changed', 'lsp:diagnostics', 'lsp:status', 'completion:pull'])

const bridge: RamuBridge = {
  invoke: (method, ...args) => ipcRenderer.invoke('ramu:invoke', method, args),
  on(event, listener) {
    if (!PUSH_EVENTS.has(event)) throw new Error(`Unknown event ${event}`)
    const wrapped = (_e: IpcRendererEvent, payload: PushEvents[typeof event]) => listener(payload)
    ipcRenderer.on(event, wrapped)
    return () => ipcRenderer.removeListener(event, wrapped)
  },
}

contextBridge.exposeInMainWorld('ramu', bridge)
