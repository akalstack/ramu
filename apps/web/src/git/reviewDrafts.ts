import { useHost } from '../workspace/HostProvider'
import { useState } from 'react'

/** Keep unfinished review text across file switches without selecting or sending it. */
export function useReviewDraft<T>(key: string, initial: T): [T, (value: T) => void] {
  const storageKey = `host:${useHost().id}:ramu.review-draft:${key}`
  const read = (): T => {
    try {
      const saved = sessionStorage.getItem(storageKey)
      return saved === null ? initial : JSON.parse(saved)
    } catch {
      return initial
    }
  }
  const [state, setState] = useState(() => ({ key, value: read() }))
  const value = state.key === key ? state.value : read()
  const set = (next: T) => {
    setState({ key, value: next })
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next))
    } catch {}
  }
  return [value, set]
}
