import { useCallback, useMemo, useState } from 'react'
import type { PullRequestFile } from '@ramu/shared/types'
import { storeForHost } from '../hostStorage'

// Files a person ticked as viewed while reading a commit, a comparison or a pull request, as GitHub and Bitbucket
// keep them. Kept on this device for the host, with the diff each was ticked at: a file that changed since is unticked
// again, so a tick always means "I read what is here now".
const PREFIX = 'ramu.viewed.'
const INDEX = 'ramu.viewed-index'
/** Reviews remembered per host; the least recently touched go first. */
const MAX_REVIEWS = 150

type Store = NonNullable<ReturnType<typeof storeForHost>>

/** A short fingerprint of a file's diff: enough to notice that it changed. */
export function diffSignature(file: Pick<PullRequestFile, 'patch' | 'additions' | 'deletions' | 'status'>): string {
  const text = file.patch ?? ''
  let hash = 5381
  for (let index = 0; index < text.length; index++) hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0
  return `${file.status}:${file.additions}:${file.deletions}:${text.length}:${hash >>> 0}`
}

function read(store: Store | null, scope: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(PREFIX + scope) ?? '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function write(store: Store | null, scope: string, viewed: Record<string, string>): void {
  if (!store) return
  try {
    const index = (JSON.parse(store.getItem(INDEX) ?? '[]') as string[]).filter((entry) => entry !== scope)
    if (Object.keys(viewed).length) {
      store.setItem(PREFIX + scope, JSON.stringify(viewed))
      index.push(scope)
    } else store.removeItem(PREFIX + scope)
    for (const old of index.splice(0, Math.max(0, index.length - MAX_REVIEWS))) store.removeItem(PREFIX + old)
    store.setItem(INDEX, JSON.stringify(index))
  } catch {
    // Storage that is full or unavailable only loses the ticks; the review itself is unaffected.
  }
}

/** The ticks of one review (`scope` names it: a commit, a comparison, a pull request) on `host`. */
export function useViewedFiles(host: string, scope: string) {
  const store = useMemo(() => storeForHost(host), [host])
  const [viewed, setViewed] = useState(() => ({ scope, files: read(store, scope) }))
  // Another review opened in the same view starts from its own ticks.
  const files = viewed.scope === scope ? viewed.files : read(store, scope)
  const isViewed = useCallback((file: PullRequestFile) => files[file.path] === diffSignature(file), [files])
  const setFile = useCallback(
    (file: PullRequestFile, value: boolean) => {
      const next = { ...read(store, scope) }
      if (value) next[file.path] = diffSignature(file)
      else delete next[file.path]
      write(store, scope, next)
      setViewed({ scope, files: next })
    },
    [store, scope],
  )
  return { isViewed, setFile }
}
