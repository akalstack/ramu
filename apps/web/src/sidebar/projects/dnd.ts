import { useState } from 'react'
import { invoke } from '../../ipc'
import { notifyError } from '../../Notifications'
import { errorText } from '../../TaskPane'
import { useWorkspace } from '../../workspace'
import { useAddProject } from '../../addProject'

export const PROJECT_DRAG_TYPE = 'application/x-ramu-project'

type DropTarget = { id: string; after: boolean }

export type ProjectDnd = {
  enabled: boolean
  dragging: string | null
  drop: DropTarget | null
  setDragging: (id: string | null) => void
  setDrop: (target: DropTarget | null) => void
  reorder: (projectId: string, target: DropTarget) => Promise<void>
}

const hasFiles = (event: React.DragEvent) => event.dataTransfer.types.includes('Files')

/** Project reordering by drag, plus dropping folders from Finder to add them as projects. */
export function useProjectsDragDrop() {
  const ws = useWorkspace()
  const addProject = useAddProject()
  // Drag a project by its row to put it somewhere else in the list.
  const [dragging, setDragging] = useState<string | null>(null)
  const [drop, setDrop] = useState<DropTarget | null>(null)
  const reorder = async (projectId: string, target: DropTarget) => {
    const ids = ws.projects.map((entry) => entry.id).filter((id) => id !== projectId)
    ids.splice(ids.indexOf(target.id) + (target.after ? 1 : 0), 0, projectId)
    try {
      await invoke('projects.reorder', ids)
      await ws.refresh()
    } catch (e) {
      notifyError(errorText(e), 'Projects')
    }
  }
  const dnd: ProjectDnd = { enabled: true, dragging, drop, setDragging, setDrop, reorder }
  // Dropping folders from Finder adds them as projects.
  const [folderOver, setFolderOver] = useState(false)

  const onDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (
      dragging &&
      event.dataTransfer.types.includes(PROJECT_DRAG_TYPE) &&
      !(event.target as HTMLElement).closest('.project-group')
    ) {
      // Over the gaps, headings or empty space: snap to the nearest end of the list.
      const groups = [...event.currentTarget.querySelectorAll<HTMLElement>('.project-group')]
      const first = groups[0],
        last = groups.at(-1)
      if (first && last) {
        event.preventDefault()
        const before = event.clientY < first.getBoundingClientRect().top
        const target = { id: ws.projects[before ? 0 : ws.projects.length - 1]!.id, after: !before }
        if (drop?.id !== target.id || drop.after !== target.after) setDrop(target)
      }
      return
    }
    if (!hasFiles(event) || addProject.busy) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setFolderOver(true)
  }
  const onDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFolderOver(false)
  }
  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (dragging && drop && !event.defaultPrevented && event.dataTransfer.types.includes(PROJECT_DRAG_TYPE)) {
      event.preventDefault()
      const dragged = event.dataTransfer.getData(PROJECT_DRAG_TYPE),
        target = drop
      setDragging(null)
      setDrop(null)
      if (dragged && dragged !== target.id) void reorder(dragged, target)
      return
    }
    if (!hasFiles(event)) return
    event.preventDefault()
    setFolderOver(false)
    void addProject.addDropped([...event.dataTransfer.files])
  }
  return { dnd, folderOver, onDragOver, onDragLeave, onDrop }
}
