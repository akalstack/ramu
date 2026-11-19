import { useState } from 'react'
import { Rocket } from 'lucide-react'
import { NO_PROJECT } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { t } from '../i18n'
import { useWorkspace } from '../workspace/workspace'
import { DeployDialog } from '../sidebar/projects/DeployDialog'

/**
 * Once a thread's goal is met in a project with a repository, the next step is usually putting it online: Deploy…
 * opens the project's deploy sheet right where the goal finished, on the thread's own host.
 */
export function GoalDeploy({ taskId }: { taskId: string | undefined }) {
  const ws = useWorkspace()
  const [open, setOpen] = useState(false)
  const projectId = taskId ? ws.task(taskId)?.projectId : undefined
  const project =
    projectId && projectId !== NO_PROJECT ? ws.projects.find((entry) => entry.id === projectId) : undefined
  const repos = project ? (ws.repos[project.id] ?? []) : []
  if (!project || !repos.length) return null
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="self-start"
        title={t('Put {0} online, or see where it is deployed', { 0: project.name })}
        onClick={() => setOpen(true)}
      >
        <Rocket size={13} /> {t('Deploy…')}
      </Button>
      {open && <DeployDialog project={project} repos={repos} onClose={() => setOpen(false)} />}
    </>
  )
}
