import { useState } from 'react'
import { invoke } from '../../ipc'
import type { Confirmation, GitRun } from './types'

/** State and execution of the repository confirmation dialog. */
export function useConfirmation({
  taskId,
  repoId,
  busy,
  run,
  requireSaved,
  onUndone,
}: {
  taskId: string
  repoId: string
  busy: boolean
  run: GitRun
  requireSaved: () => void
  /** Called with the undone commit's message so it can be edited and recommitted. */
  onUndone: (message: string) => void
}) {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [operationName, setOperationName] = useState('')
  /** Opens a confirmation that asks for a name (branch or stash message). */
  const ask = (next: Confirmation) => {
    setOperationName('')
    setConfirmation(next)
  }
  const cancel = () => {
    if (!busy) setConfirmation(null)
  }
  const confirm = () => {
    if (!confirmation) return
    void run(async () => {
      requireSaved()
      if (confirmation.kind === 'discard') await invoke('git.discard', taskId, repoId, confirmation.paths)
      else if (confirmation.kind === 'undo') onUndone(await invoke('git.undoCommit', taskId, repoId, confirmation.oid))
      else if (confirmation.kind === 'branch') await invoke('git.createBranch', taskId, repoId, operationName.trim())
      else if (confirmation.kind === 'stash')
        await invoke('git.stash', taskId, repoId, operationName.trim(), confirmation.staged)
      else if (confirmation.kind === 'delete-branch')
        await invoke('git.deleteBranch', taskId, repoId, confirmation.name)
      else await invoke('git.dropStash', taskId, repoId, confirmation.oid)
      setConfirmation(null)
    })
  }
  return { confirmation, request: setConfirmation, ask, cancel, confirm, operationName, setOperationName }
}
