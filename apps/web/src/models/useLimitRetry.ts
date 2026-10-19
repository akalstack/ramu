import { useCallback, useEffect, useState } from 'react'
import type { ProviderWaitState } from '@ramu/shared/chat/providerWait'
import { useHost } from '../workspace/HostProvider'

/** "Try again" for a thread at a usage limit, shared by the tray button and the composer's play button. */
export interface LimitRetry {
  busy: boolean
  /** The last try found the provider still limited; the tray then reads "Still limited". */
  stillLimited: boolean
  /** The wait as last reported, including a reset time a failed try just learned. */
  wait: ProviderWaitState | null
  tryNow: () => void
}

export function useLimitRetry(
  sessionId: string,
  wait: ProviderWaitState | null,
  onError: (reason: unknown) => void,
): LimitRetry {
  const { invoke } = useHost()
  const [busy, setBusy] = useState(false)
  const [stillLimited, setStillLimited] = useState(false)
  const [latest, setLatest] = useState<{ retryAt: number; guessed: boolean } | null>(null)
  // A new wait, another limit or a changed reset, starts fresh.
  useEffect(() => {
    setStillLimited(false)
    setLatest(null)
  }, [sessionId, wait?.retryAt, wait?.guessed])
  const tryNow = useCallback(() => {
    setBusy(true)
    invoke('agent.retryLimitNow', sessionId)
      .then((result) => {
        if (result.resumed) return
        setStillLimited(true)
        if (result.retryAt) setLatest({ retryAt: result.retryAt, guessed: result.guessed })
      })
      .catch(onError)
      .finally(() => setBusy(false))
  }, [sessionId, onError, invoke])
  return { busy, stillLimited, wait: wait && latest ? { ...wait, ...latest } : wait, tryNow }
}
