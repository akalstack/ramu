import { useEffect, useRef, useState, type RefObject } from 'react'
import { interactiveHtml, type InteractiveNetwork, type InteractiveState } from '@ramu/shared/interactive'
import { ramu } from '../ipc'

/** Native document ownership shared by transcript cards and the local theme preview. */
export function useContentDocument(
  html: string | undefined,
  instance: string,
  active: boolean,
  state: RefObject<InteractiveState | null>,
  network?: InteractiveNetwork,
) {
  // A refetch reconstructs this object; only a policy change should replace the document/frame.
  const networkKey = JSON.stringify(network ?? null)
  const policy = useRef({ key: networkKey, value: network })
  if (policy.current.key !== networkKey) policy.current = { key: networkKey, value: network }
  const stableNetwork = policy.current.value
  const identity = useRef({ html, instance, active, networkKey, epoch: 0 })
  if (
    identity.current.html !== html ||
    identity.current.instance !== instance ||
    identity.current.active !== active ||
    identity.current.networkKey !== networkKey
  )
    identity.current = { html, instance, active, networkKey, epoch: identity.current.epoch + 1 }
  const epoch = identity.current.epoch
  const [result, setResult] = useState({ epoch, url: '', error: '' })
  useEffect(() => {
    if (!active || !html) return
    let cancelled = false,
      mounted = ''
    setResult({ epoch, url: '', error: '' })
    void ramu
      .invoke('app.content.mount', interactiveHtml(html, instance, state.current, undefined, stableNetwork))
      .then(
        (url) => {
          mounted = url
          if (cancelled) void ramu.invoke('app.content.release', url).catch(() => {})
          else setResult({ epoch, url, error: '' })
        },
        (error) => {
          if (!cancelled) setResult({ epoch, url: '', error: String(error) })
        },
      )
    return () => {
      cancelled = true
      if (mounted) void ramu.invoke('app.content.release', mounted).catch(() => {})
    }
  }, [html, instance, active, state, epoch, stableNetwork])
  return active && result.epoch === epoch ? result : { url: '', error: '' }
}
