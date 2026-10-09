import { useState } from 'react'
import { invoke } from './ipc'
import { notifyError } from './Notifications'
import { errorText } from './TaskPane'
import { useWorkspace } from './workspace'

/** Every "Add project" entry point: the native folder browser, then the new project opens on its files. */
export function useAddProject() {
  const ws = useWorkspace()
  const [busy, setBusy] = useState(false)
  const add = async () => {
    if (busy) return
    setBusy(true)
    try {
      const dir = await invoke('repos.pick', 'project')
      if (!dir) return
      const { project } = await invoke('projects.addFolder', dir)
      await ws.refresh()
      ws.openProject(project.id)
      ws.setSidebar('explorer')
    } catch (e) {
      notifyError(errorText(e), 'Add project')
    } finally {
      setBusy(false)
    }
  }
  return { add, busy }
}
