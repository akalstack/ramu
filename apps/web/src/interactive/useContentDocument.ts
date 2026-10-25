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
  const identity = useRef({ html, instance, active, epoch: 0 })
  if (identity.current.html !== html || identity.current.instance !== instance || identity.current.active !== active)
    identity.current = { html, instance, active, epoch: identity.current.epoch + 1 }
  const epoch = identity.current.epoch
  const [result, setResult] = useState({ epoch, url: '', error: '' })
  useEffect(() => {
    if (!active || !html) return
    let cancelled = false,
      mounted = ''
    setResult({ epoch, url: '', error: '' })
    void ramu.invoke('app.content.mount', interactiveHtml(html, instance, state.current, undefined, network)).then(
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
  }, [html, instance, active, state, epoch, network])
  return active && result.epoch === epoch ? result : { url: '', error: '' }
}
