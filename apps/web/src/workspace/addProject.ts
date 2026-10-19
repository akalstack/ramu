import { useState } from 'react'
import { invoke, invokerFor, ramu } from '../ipc'
import { LOCAL_HOST } from '../hosts'
import { notifyError } from '../chat/Notifications'
import { errorText } from './TaskPane'
import { useWorkspace, useWorkspaceOf } from './workspace'
import { useHost } from './HostProvider'
import { useHostSelection } from './HostSelection'

export type RepoChoice = { name: string; repos: string[]; resolve: (repos: string[] | null) => void }
const choiceListeners = new Set<(choice: RepoChoice) => void>()
/** The dialog subscribes here; it answers with the repositories to keep, or null when the user cancels. */
export function onRepoChoice(listener: (choice: RepoChoice) => void) {
  choiceListeners.add(listener)
  return () => {
    choiceListeners.delete(listener)
  }
}
const chooseRepos = (name: string, repos: string[]) =>
  new Promise<string[] | null>((resolve) => {
    if (!choiceListeners.size) return resolve(repos)
    choiceListeners.forEach((listener) => listener({ name, repos, resolve }))
  })

export type FolderPick = { host: string; resolve: (dir: string | null) => void }
const pickListeners = new Set<(pick: FolderPick) => void>()
/** The host folder browser subscribes here; it answers with the chosen folder on the host, or null when cancelled. */
export function onFolderPick(listener: (pick: FolderPick) => void) {
  pickListeners.add(listener)
  return () => {
    pickListeners.delete(listener)
  }
}
export const pickHostFolder = (host: string) =>
  new Promise<string | null>((resolve) => {
    if (!pickListeners.size) return resolve(null)
    pickListeners.forEach((listener) => listener({ host, resolve }))
  })

/**
 * Every "Add project" entry point: the native folder browser (or an in-app browser for a remote host), then the new
 * project opens on its files. `host` defaults to the store's host (`useHost()`); the sidebar passes each host group's,
 * so a project can be added to another host without switching to it first.
 */
export function useAddProject(host?: string) {
  const current = useHost()
  const target = host ?? current.id
  const active = useWorkspace()
  const other = useWorkspaceOf(target)
  const { activeHost, select } = useHostSelection()
  const onScreen = target === activeHost
  const remote = target !== LOCAL_HOST
  const call = invokerFor(target)
  const [busy, setBusy] = useState(false)
  const open = async (dirs: string[]) => {
    const ws = onScreen ? active : other
    let last: string | null = null
    for (const dir of dirs) {
      try {
        const found = await call('projects.inspect', dir)
        let repos: string[] | undefined
        if (
          found.kind === 'workspace' &&
          found.repos.length > 1 &&
          !ws?.projects.some((project) => project.root === found.root)
        ) {
          const chosen = await chooseRepos(found.name, found.repos)
          if (!chosen) continue
          repos = chosen
        }
        last = (await call('projects.addFolder', dir, repos)).project.id
      } catch (e) {
        notifyError(errorText(e), 'Add project')
      }
    }
    if (!last) return
    if (!onScreen) {
      await ws?.refresh()
      select(target, { kind: 'project', projectId: last })
      return
    }
    await active.refresh()
    active.openProject(last)
    active.setSidebar('explorer')
  }
  const guarded = async (run: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try {
      await run()
    } catch (e) {
      notifyError(errorText(e), 'Add project')
    } finally {
      setBusy(false)
    }
  }
  const add = () =>
    guarded(async () => {
      // A native dialog would open on this machine, so a remote host is browsed in-app instead.
      const dir = remote ? await pickHostFolder(target) : await invoke('repos.pick', 'project')
      if (dir) await open([dir])
    })
  /** Folders dropped onto the project list; each becomes a project (a plain file reports that it holds no repository). */
  const addDropped = (files: File[]) =>
    guarded(async () => {
      if (remote) {
        const dir = await pickHostFolder(target)
        if (dir) await open([dir])
        return
      }
      await open(files.map((file) => ramu.pathForFile(file)).filter(Boolean))
    })
  return { add, addDropped, busy }
}
