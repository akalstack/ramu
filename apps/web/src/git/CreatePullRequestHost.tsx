import { useEffect, useState } from 'react'
import { CreatePullRequestDialog } from '../sidebar/scm/CreatePullRequestDialog'

type Request = { taskId: string; repoId: string; resolve: (created: boolean) => void }
let active: Request | null = null
let listener: ((request: Request | null) => void) | null = null

/** Opens the pull request dialog from anywhere (Source Control, the commit popup, the header button). */
export function openCreatePullRequest(taskId: string, repoId: string): Promise<boolean> {
  if (active || !listener) return Promise.resolve(false)
  return new Promise((resolve) => {
    active = { taskId, repoId, resolve }
    listener!(active)
  })
}

export function CreatePullRequestHost() {
  const [request, setRequest] = useState<Request | null>(null)
  useEffect(() => {
    listener = setRequest
    return () => {
      listener = null
      active?.resolve(false)
      active = null
    }
  }, [])
  if (!request) return null
  return (
    <CreatePullRequestDialog
      taskId={request.taskId}
      repoId={request.repoId}
      onDone={(created) => {
        active?.resolve(created)
        active = null
        setRequest(null)
      }}
    />
  )
}
