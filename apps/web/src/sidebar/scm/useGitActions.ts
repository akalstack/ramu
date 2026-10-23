import { useState } from 'react'
import { syncRepositories } from '../../git/syncRepositories'
import type { GitStash, PullMode, RepositoryBinding } from '@ramu/shared/types'
import { errorText } from '../../workspace/TaskPane'
import { withGitBusy } from '../../git/gitBusy'
import { useWorkspace } from '../../workspace/workspace'
import type { GitRun } from './types'
import { useHost } from '../../workspace/HostProvider'

/** Repository-level Git actions; each runs under the busy flag, then refreshes. */
export function useGitActions({
  taskId,
  binding,
  load,
  reportError,
}: {
  taskId: string
  binding: RepositoryBinding
  load: () => Promise<void>
  reportError: (message: string) => void
}) {
  const ws = useWorkspace()
  const { invoke } = useHost()
  const run: GitRun = async (fn) => {
    try {
      await withGitBusy(taskId, binding.repoId, fn)
    } catch (e) {
      reportError(errorText(e))
    } finally {
      void load()
      window.dispatchEvent(new Event('ramu:git-updated'))
    }
  }
  const requireSaved = () => {
    if (Object.values(ws.dirty).some(Boolean))
      throw new Error('Save or close unsaved editor buffers before changing files or branches.')
  }
  const stagePaths = (paths: string[], stage: boolean) =>
    void run(() => invoke(stage ? 'git.stage' : 'git.unstage', taskId, binding.repoId, paths))
  const fetchRepo = () => void run(() => invoke('git.fetch', taskId, binding.repoId))
  // Several remotes with no clear destination: the person picks one, and nothing is pushed before that.
  const [remoteChoices, setRemoteChoices] = useState<string[] | null>(null)
  const pushRepo = () =>
    void run(async () => {
      const choices = await invoke('git.remoteChoices', taskId, binding.repoId)
      if (choices) setRemoteChoices(choices)
      else await invoke('git.push', taskId, binding.repoId)
    })
  const pushTo = (remote: string) => {
    setRemoteChoices(null)
    void run(() => invoke('git.push', taskId, binding.repoId, undefined, remote))
  }
  const sync = () =>
    void run(async () => {
      requireSaved()
      await syncRepositories(invoke, taskId, [binding])
    })
  const pull = (mode?: PullMode) =>
    void run(async () => {
      requireSaved()
      await invoke('git.pull', taskId, binding.repoId, mode)
    })
  const popStash = (stash: GitStash) =>
    run(async () => {
      requireSaved()
      await invoke('git.popStash', taskId, binding.repoId, stash.oid)
    })
  const applyStash = (stash: GitStash) =>
    run(async () => {
      requireSaved()
      await invoke('git.applyStash', taskId, binding.repoId, stash.oid)
    })
  return {
    run,
    requireSaved,
    stagePaths,
    fetchRepo,
    pushRepo,
    pushTo,
    remoteChoices,
    cancelRemoteChoice: () => setRemoteChoices(null),
    sync,
    pull,
    popStash,
    applyStash,
  }
}

export type GitActions = ReturnType<typeof useGitActions>
