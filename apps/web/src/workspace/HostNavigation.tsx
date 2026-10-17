import { useEffect, useRef, useState } from 'react'
import type { HostDestination } from '@ramu/shared/hostOverview'
import { ramu } from '../ipc'
import { useWorkspace } from './workspace'
import { useAddProject } from './addProject'
import { openSummary } from '../summaries/openSummary'
import { notifyError } from '../chat/Notifications'
import { errorText } from '../lib/errors'
import { t } from '../i18n'

/** The destination is delivered only to the renderer owned by that host. */
export function HostNavigation() {
  const ws = useWorkspace()
  const addProject = useAddProject()
  const add = useRef(addProject.add)
  add.current = addProject.add
  const latest = useRef(ws)
  latest.current = ws
  const [destination, setDestination] = useState<HostDestination | null>(null)
  useEffect(() => {
    let sequence = 0
    const off = ramu.on('computers:navigate', (next) => {
      const request = ++sequence
      // A hidden workspace may not yet know a task created on another device.
      void (async () => {
        try {
          if (next.kind === 'task' || next.kind === 'project') await latest.current.refresh()
          if (request === sequence) setDestination(next)
        } catch (error) {
          notifyError(errorText(error), t('Hosts'))
        }
      })()
    })
    void ramu.invoke('computers.navigation.ready').catch(() => {})
    return () => {
      sequence++
      off()
    }
  }, [])
  useEffect(() => {
    if (!destination) return
    setDestination(null)
    switch (destination.kind) {
      case 'task':
        if (!ws.tasks.some((task) => task.id === destination.taskId)) {
          notifyError(t('Thread not found'))
          break
        }
        ws.openTask(destination.taskId)
        if (destination.sessionId) ws.openView(destination.taskId, { kind: 'agent', sessionId: destination.sessionId })
        break
      case 'project':
        ws.setSidebar('projects')
        ws.openProject(destination.projectId)
        break
      case 'new':
        ws.newTask(destination.projectId)
        break
      case 'summary':
        openSummary(destination.summaryId)
        break
      case 'inbox':
        ws.setSidebar('inbox')
        break
      case 'add-project':
        void add.current()
        break
    }
  }, [destination, ws])
  return null
}
