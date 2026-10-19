import { useState } from 'react'
import { notifyError } from '../../chat/Notifications'
import { errorText } from '../../workspace/TaskPane'
import { useWorkspace } from '../../workspace/workspace'
import { useAddProject } from '../../workspace/addProject'
import { useHost } from '../../workspace/HostProvider'

const hasFiles = (event: React.DragEvent) => event.dataTransfer.types.includes('Files')

/** Project reordering (the sortable list itself lives in ProjectsPanel), plus dropping folders from Finder to add them as projects. */
export function useProjectsDragDrop() {
  const ws = useWorkspace()
  const { invoke } = useHost()
  const addProject = useAddProject()
  const reorder = async (ids: string[]) => {
    try {
      await invoke('projects.reorder', ids)
      await ws.refresh()
    } catch (e) {
      notifyError(errorText(e), 'Projects')
    }
  }
  // Finder drops are OS drags, which dnd-kit's pointer sensors never see, so they stay on the native events.
  const [folderOver, setFolderOver] = useState(false)
  const onDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event) || addProject.busy) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setFolderOver(true)
  }
  const onDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFolderOver(false)
  }
  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    setFolderOver(false)
    void addProject.addDropped([...event.dataTransfer.files])
  }
  return { reorder, folderOver, onDragOver, onDragLeave, onDrop }
}
