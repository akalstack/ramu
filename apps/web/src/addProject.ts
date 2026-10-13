import { useState } from 'react'
import { invoke, ramu } from './ipc'
import { notifyError } from './Notifications'
import { errorText } from './TaskPane'
import { useWorkspace } from './workspace'

/** Every "Add project" entry point: the native folder browser, then the new project opens on its files. */
export function useAddProject() {
  const ws = useWorkspace()
  const [busy, setBusy] = useState(false)
  const open = async (dirs: string[]) => {
    let last: string | null = null
    for (const dir of dirs) {
      try { last = (await invoke('projects.addFolder', dir)).project.id }
      catch (e) { notifyError(errorText(e), 'Add project') }
    }
    if (!last) return
    await ws.refresh()
    ws.openProject(last)
    ws.setSidebar('explorer')
  }
  const guarded = async (run: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try { await run() } catch (e) { notifyError(errorText(e), 'Add project') } finally { setBusy(false) }
  }
  const add = () => guarded(async () => { const dir = await invoke('repos.pick', 'project'); if (dir) await open([dir]) })
  /** Folders dropped onto the project list; each becomes a project (a plain file reports that it holds no repository). */
  const addDropped = (files: File[]) => guarded(() => open(files.map((file) => ramu.pathForFile(file)).filter(Boolean)))
  return { add, addDropped, busy }
}
