import { useState } from 'react'
import { invoke, ramu } from '../ipc'
import { notifyError } from '../chat/Notifications'
import { errorText } from './TaskPane'
import { useWorkspace } from './workspace'
import { useComputers } from './computers'

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

export type FolderPick = { resolve: (dir: string | null) => void }
const pickListeners = new Set<(pick: FolderPick) => void>()
/** The host folder browser subscribes here; it answers with the chosen folder on the host, or null when cancelled. */
export function onFolderPick(listener: (pick: FolderPick) => void) {
  pickListeners.add(listener)
  return () => {
    pickListeners.delete(listener)
  }
}
const pickHostFolder = () =>
  new Promise<string | null>((resolve) => {
    if (!pickListeners.size) return resolve(null)
    pickListeners.forEach((listener) => listener({ resolve }))
  })

/** Every "Add project" entry point: the native folder browser (or an in-app browser for a remote host), then the new project opens on its files. */
export function useAddProject() {
  const ws = useWorkspace()
  const computers = useComputers()
  const remote = computers?.computers.find((c) => c.id === computers.current)?.local === false
  const [busy, setBusy] = useState(false)
  const open = async (dirs: string[]) => {
    let last: string | null = null
    for (const dir of dirs) {
      try {
        const found = await invoke('projects.inspect', dir)
        let repos: string[] | undefined
        if (
          found.kind === 'workspace' &&
          found.repos.length > 1 &&
          !ws.projects.some((project) => project.root === found.root)
        ) {
          const chosen = await chooseRepos(found.name, found.repos)
          if (!chosen) continue
          repos = chosen
        }
        last = (await invoke('projects.addFolder', dir, repos)).project.id
      } catch (e) {
        notifyError(errorText(e), 'Add project')
      }
    }
    if (!last) return
    await ws.refresh()
    ws.openProject(last)
    ws.setSidebar('explorer')
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
      // A native dialog would open on the host machine, so a remote host is browsed in-app instead.
      const dir = remote ? await pickHostFolder() : await invoke('repos.pick', 'project')
      if (dir) await open([dir])
    })
  /** Folders dropped onto the project list; each becomes a project (a plain file reports that it holds no repository). */
  const addDropped = (files: File[]) => guarded(() => open(files.map((file) => ramu.pathForFile(file)).filter(Boolean)))
  return { add, addDropped, busy }
}
