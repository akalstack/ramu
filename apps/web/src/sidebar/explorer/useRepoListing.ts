import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useQueries } from '@tanstack/react-query'
import type { DirEntry, RepositoryBinding } from '@ramu/shared/types'
import { ipcQueryKey } from '../../dataQueries'
import { invoke, ramu } from '../../ipc'
import { parentOf } from './paths'

/** Expanded folders and their listings for one repository tree, kept fresh and revealing the selected file. */
export function useRepoListing(
  taskId: string,
  binding: RepositoryBinding,
  selectedPath: string | null,
  selectedRow: RefObject<HTMLButtonElement | null>,
) {
  const [open, setOpen] = useState<Set<string>>(new Set(['']))
  const directories = [...open]
  const listings = useQueries({
    queries: directories.map((dir) => ({
      queryKey: ipcQueryKey('files.list', taskId, binding.repoId, dir),
      queryFn: () => ramu.invoke('files.list', taskId, binding.repoId, dir),
    })),
  })
  const children: Record<string, DirEntry[]> = {}
  directories.forEach((dir, index) => {
    const data = listings[index]?.data
    if (data) children[dir] = data
  })
  const pendingReveal = useRef<string | null>(null)

  const load = useCallback(
    async (dir: string) => {
      await invoke('files.list', taskId, binding.repoId, dir).catch(() => [])
    },
    [taskId, binding.repoId],
  )

  useEffect(() => {
    if (!selectedPath) void load('')
  }, [load, selectedPath])

  // Reveal the active file without changing which activity sidebar the user chose.
  useEffect(() => {
    if (!selectedPath) return
    pendingReveal.current = selectedPath
    const parts = selectedPath.split('/')
    const ancestors = ['', ...parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'))]
    setOpen((current) => new Set([...current, ...ancestors]))
    void Promise.all(ancestors.map(load))
  }, [selectedPath, load])

  useEffect(() => {
    if (!selectedPath || pendingReveal.current !== selectedPath || !selectedRow.current) return
    selectedRow.current.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    pendingReveal.current = null
  }, [children, open, selectedPath, selectedRow])

  // Re-list expanded directories when something inside them changes on disk.
  useEffect(
    () =>
      ramu.on('fs:changed', ({ cwd, path }) => {
        if (cwd !== binding.cwd || path.startsWith('.git/')) return
        if (open.has(parentOf(path))) void load(parentOf(path))
      }),
    [binding.cwd, open, load],
  )

  const toggle = (dir: string) => {
    setOpen((s) => {
      const next = new Set(s)
      if (next.has(dir)) next.delete(dir)
      else {
        next.add(dir)
        if (!children[dir]) void load(dir)
      }
      return next
    })
  }

  useEffect(() => {
    const refresh = () => {
      void Promise.all([...open].map(load))
    }
    const collapse = () => setOpen(new Set(['']))
    window.addEventListener('ramu:refresh-explorer', refresh)
    window.addEventListener('ramu:collapse-explorer', collapse)
    return () => {
      window.removeEventListener('ramu:refresh-explorer', refresh)
      window.removeEventListener('ramu:collapse-explorer', collapse)
    }
  }, [open, load])

  const reloadAll = async () => {
    await Promise.all([...open].map(load))
  }
  return { open, setOpen, children, load, toggle, reloadAll }
}
