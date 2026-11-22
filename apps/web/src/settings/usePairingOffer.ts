import QRCode from 'qrcode'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PairingOffer } from '@ramu/shared/types'
import type { invoke as Invoke } from '../ipc'
import { errorText } from '../lib/errors'

export interface PairedDevice {
  name: string
  role: 'owner' | 'viewer'
}

/**
 * A one-time pairing code while `active`: made at once, replaced as soon as it expires, watched until a device uses
 * it, and withdrawn when the code is no longer shown. Pairing happens on the other device, so polling is how this
 * screen learns it finished.
 */
export function usePairingOffer(invoke: typeof Invoke, role: 'owner' | 'viewer', active = true) {
  const [offer, setOffer] = useState<PairingOffer | null>(null),
    [now, setNow] = useState(Date.now()),
    [error, setError] = useState<string | null>(null),
    [joined, setJoined] = useState<PairedDevice | null>(null)
  const request = useRef(0)
  // One owner per screen: its next code (or a change of access) replaces its unused one on the host.
  const owner = useRef(crypto.randomUUID()).current
  const create = useCallback(() => {
    const id = ++request.current
    setError(null)
    setJoined(null)
    setOffer(null)
    invoke('network.pair', role, owner).then(
      (next) => {
        if (id === request.current) setOffer(next)
      },
      (e) => {
        if (id === request.current) setError(errorText(e))
      },
    )
  }, [invoke, role, owner])
  useEffect(() => {
    if (!active) return
    create()
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- a counter that invalidates in-flight work; it is not a DOM ref
      ++request.current
      setOffer(null)
    }
  }, [create, active])
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [active])
  const expired = !!offer && offer.expiresAt <= now
  // A code that runs out while it is on screen is replaced, so a slow phone never meets a dead one.
  useEffect(() => {
    if (active && expired && !joined) create()
  }, [active, expired, joined, create])
  const offerId = offer?.offerId
  useEffect(() => {
    if (!offerId || joined) return
    let live = true
    const check = () =>
      invoke('network.offer', offerId).then(
        (result) => {
          if (live && result.state === 'redeemed' && result.device)
            setJoined({ name: result.device.name, role: result.device.role ?? 'owner' })
        },
        () => {},
      )
    const id = window.setInterval(() => void check(), 1500)
    return () => {
      live = false
      window.clearInterval(id)
    }
  }, [invoke, offerId, joined])
  // Withdraws an unused code once it is no longer shown; a crash still relies on its expiry.
  useEffect(() => {
    if (!offerId) return
    return () => {
      void Promise.resolve(invoke('network.cancelOffer', offerId)).catch(() => {})
    }
  }, [invoke, offerId])
  return { offer, now, expired, error, joined, renew: create }
}

/** The QR code image for `text`, or '' while it renders. */
export function useQrImage(text: string | null, width = 240): string {
  const [image, setImage] = useState('')
  useEffect(() => {
    let alive = true
    setImage('')
    if (text)
      void QRCode.toDataURL(text, { width, margin: 2 }).then(
        (value) => {
          if (alive) setImage(value)
        },
        () => {},
      )
    return () => {
      alive = false
    }
  }, [text, width])
  return image
}
