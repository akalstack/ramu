// Exposes a narrow bridge; the renderer never sees ipcRenderer or Node APIs.
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { PushEvents, RamuBridge } from '../shared/api'

const PUSH_EVENTS = new Set<string>(['menu:action', 'updates:changed', 'providers:updates', 'automation:changed', 'notify:inapp', 'notify:open', 'background:connection', 'agent:event', 'term:data', 'term:exit', 'fs:changed', 'usage:changed', 'aside:changed', 'context:changed'])

const bridge: RamuBridge = {
  invoke: (method, ...args) => ipcRenderer.invoke('ramu:invoke', method, args),
  on(event, listener) {
    if (!PUSH_EVENTS.has(event)) throw new Error(`Unknown event ${event}`)
    const wrapped = (_e: IpcRendererEvent, payload: PushEvents[typeof event]) => listener(payload)
    ipcRenderer.on(event, wrapped)
    return () => ipcRenderer.removeListener(event, wrapped)
  },
  pathForFile: (file) => { try { return webUtils.getPathForFile(file) } catch { return '' } },
}

contextBridge.exposeInMainWorld('ramu', bridge)
