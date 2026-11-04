import { useEffect, useState } from 'react'
import type { PairBackInvite } from '@ramu/shared/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/desktop-button'
import { invoke, ramu } from '../ipc'
import { errorText } from '../lib/errors'
import { t, useLanguage } from '../i18n'

/**
 * A computer paired with this host invites it to connect back, so each can open the other. Connecting is the answer:
 * this computer pairs with the code that computer made, over the first of its addresses that works. Closing asks again
 * next time Ramu opens, until the code lapses.
 */
export function PairBackDialog() {
  useLanguage()
  const [invites, setInvites] = useState<PairBackInvite[]>([])
  const [later, setLater] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void Promise.resolve(invoke('network.pairBackInvites')).then(
      (next) => alive && setInvites(next ?? []),
      () => {},
    )
    const off = ramu.on('pairBack:invites', ({ invites: next }) => setInvites(next))
    return () => {
      alive = false
      off()
    }
  }, [])
  const invite = invites.find((entry) => !later.includes(entry.id) && entry.expiresAt > Date.now())
  const inviteId = invite?.id
  useEffect(() => {
    setError(null)
    setBusy(false)
  }, [inviteId])
  if (!invite) return null
  const dismiss = () => {
    setInvites((current) => current.filter((entry) => entry.id !== invite.id))
    void Promise.resolve(invoke('network.dismissPairBack', invite.id)).catch(() => {})
  }
  const connect = async () => {
    setBusy(true)
    setError(null)
    let failure: unknown = null
    for (const url of invite.urls) {
      try {
        await invoke('computers.pair', url, invite.code, invite.name)
        dismiss()
        return
      } catch (reason) {
        failure = reason
      }
    }
    setBusy(false)
    setError(errorText(failure))
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && setLater((ids) => [...ids, invite.id])}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Connect to {0}?', { 0: invite.name })}</DialogTitle>
          <DialogDescription>
            {t(
              '{0} invites this computer to connect back, so you can open its threads, files and terminals from here too. It joins Hosts you use; you can forget it any time.',
              { 0: invite.name },
            )}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="m-0 text-caption text-bad">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="secondary" disabled={busy} onClick={dismiss}>
            {t('Not now')}
          </Button>
          <Button variant="default" disabled={busy} onClick={() => void connect()}>
            {busy ? t('Connecting…') : t('Connect')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
