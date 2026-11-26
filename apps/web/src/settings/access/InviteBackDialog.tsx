import { useEffect, useRef, useState } from 'react'
import type { Computer } from '@ramu/shared/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/desktop-button'
import { invokeOn } from '../../ipc'
import { ownHostId } from '../../hosts'
import { errorText } from '../../lib/errors'
import { t, useLanguage } from '../../i18n'

/**
 * Invites a host to connect back to this computer, so each can open the other. This computer makes a full-access code
 * and hands it to that host, whose owner connects with one tap; nobody types it, and nothing connects until they do.
 */
export function InviteBackDialog({
  computer,
  from,
  onClose,
}: {
  computer: Computer
  from: string
  onClose: () => void
}) {
  useLanguage()
  const own = ownHostId()
  const [reachable, setReachable] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const owner = useRef(crypto.randomUUID()).current
  useEffect(() => {
    void invokeOn(own, 'network.status').then(
      (status) => setReachable(status.reachable),
      () => setReachable(false),
    )
  }, [own])
  const send = async () => {
    setBusy(true)
    setError(null)
    try {
      const offer = await invokeOn(own, 'network.pair', 'owner', owner)
      if (!offer.urls.length) throw new Error(t('This computer has no address another host can reach yet.'))
      await invokeOn(computer.id, 'device.inviteBack', {
        name: from,
        urls: offer.urls.map((entry) => entry.url),
        code: offer.code,
        expiresAt: offer.expiresAt,
      })
      setSent(true)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            {sent
              ? t('Invitation sent to {0}', { 0: computer.name })
              : t('Let {0} connect here?', { 0: computer.name })}
          </DialogTitle>
          <DialogDescription>
            {sent
              ? t('Ramu asks on {0}. Once its owner connects, it appears under Devices, where you can remove it.', {
                  0: computer.name,
                })
              : t(
                  '{0} will be able to open this computer’s threads, files and terminals, with full access. Ramu asks on {0} first, and nothing connects until its owner accepts.',
                  { 0: computer.name },
                )}
          </DialogDescription>
        </DialogHeader>
        {reachable === false && !sent && (
          <p role="status" className="m-0 text-caption text-muted-foreground">
            {t('Choose This network or Anywhere under Reachable from first, so {0} can reach this computer.', {
              0: computer.name,
            })}
          </p>
        )}
        {error && (
          <p role="alert" className="m-0 text-caption text-bad">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant={sent ? 'default' : 'secondary'} disabled={busy} onClick={onClose}>
            {sent ? t('Done') : t('Cancel')}
          </Button>
          {!sent && (
            <Button variant="default" disabled={busy || !reachable} onClick={() => void send()}>
              {busy ? t('Sending…') : t('Send invitation')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
