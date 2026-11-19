import { useEffect, useState } from 'react'
import { PublishRepositoryDialog } from '../sidebar/scm/PublishRepositoryDialog'

type Request = { taskId: string; repoId: string; repoName: string; resolve: (published: boolean) => void }
let active: Request | null = null
let listener: ((request: Request | null) => void) | null = null

/** Opens the Publish to GitHub dialog from anywhere (status bar, Source Control). */
export function openPublishRepository(taskId: string, repoId: string, repoName: string): Promise<boolean> {
  if (active || !listener) return Promise.resolve(false)
  return new Promise((resolve) => {
    active = { taskId, repoId, repoName, resolve }
    listener!(active)
  })
}

export function PublishRepositoryHost() {
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
    <PublishRepositoryDialog
      taskId={request.taskId}
      repoId={request.repoId}
      repoName={request.repoName}
      onDone={(published) => {
        active?.resolve(published)
        active = null
        setRequest(null)
      }}
    />
  )
}
