import { useEffect, useMemo, useState } from 'react'
import type { ArtifactInfo } from '@ramu/shared/artifacts'
import { useHost } from '../workspace/HostProvider'
import { useHostRuntime } from '../workspace/workspace'

type Index = { pages: Map<string, ArtifactInfo>; listeners: Set<() => void>; loading: boolean; loaded: boolean }
const indexes = new Map<string, Index>()

/**
 * The host's pages by id, read once per host and shared by every thread card, so a transcript with many documents
 * asks the host one question instead of one per card.
 */
export function usePageIndex(): { pages: Map<string, ArtifactInfo>; loaded: boolean } {
  const { id, invoke } = useHost()
  const { on } = useHostRuntime()
  const index = useMemo(() => {
    const existing = indexes.get(id) ?? {
      pages: new Map(),
      listeners: new Set<() => void>(),
      loading: false,
      loaded: false,
    }
    indexes.set(id, existing)
    return existing
  }, [id])
  const [, setTick] = useState(0)
  useEffect(() => {
    const listener = () => setTick((n) => n + 1)
    index.listeners.add(listener)
    const load = () => {
      if (index.loading) return
      index.loading = true
      void invoke('artifacts.list')
        .then((list) => {
          index.pages = new Map(list.map((page) => [page.id, page]))
          index.loaded = true
        })
        .catch(() => {})
        .finally(() => {
          index.loading = false
          for (const notify of index.listeners) notify()
        })
    }
    if (!index.loaded) load()
    const off = on('artifacts:changed', (payload) => {
      if (!payload.run) load()
    })
    return () => {
      index.listeners.delete(listener)
      off()
    }
  }, [index, invoke, on])
  return { pages: index.pages, loaded: index.loaded }
}
