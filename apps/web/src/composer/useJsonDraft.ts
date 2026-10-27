import { useCallback, useEffect, useState } from 'react'
import { loadJsonDraft, saveJsonDraft } from './drafts'

/**
 * State that survives switching chats and restarting, like the message text: loaded when `key` changes and saved
 * as it changes. `key` is `draftKey`-style; `host` is the host the chat belongs to.
 */
export function useJsonDraft<T>(
  key: string,
  host: string,
  empty: T,
  valid: (value: unknown) => value is T,
  isEmpty: (value: T) => boolean,
) {
  const load = () => loadJsonDraft(key, host, valid, empty)
  const [state, setState] = useState(() => ({ key, host, value: load() }))
  const stale = state.key !== key || state.host !== host
  const current = stale ? { key, host, value: load() } : state
  if (stale) setState(current)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs only when the listed dependencies change; other values are read as of that change
  useEffect(() => saveJsonDraft(key, host, current.value, isEmpty), [key, host, current.value])
  const set = useCallback(
    (update: T | ((current: T) => T)) =>
      setState((previous) => {
        const base = previous.key === key && previous.host === host ? previous : { key, host, value: load() }
        return { key, host, value: typeof update === 'function' ? (update as (current: T) => T)(base.value) : update }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, host],
  )
  return [current.value, set] as const
}
