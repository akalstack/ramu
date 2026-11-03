import { useEffect, useState } from 'react'
import type { NetworkStatus } from '@ramu/shared/types'
import {
  DURATION_LABEL,
  PERMISSION_DURATIONS,
  PERMISSION_HELP,
  PERMISSION_LABEL,
  type PermissionDuration,
} from '@ramu/shared/devicePermissions'
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

type Request = NetworkStatus['permissionRequests'][number]

/**
 * A paired device asking this host for a permission (Computer use, Browser, Terminals…), answered where the person is
 * instead of only in Settings. Closing it is not an answer: the request waits in Remote access until it lapses.
 * Shown for this window's own host only, which is the only place the decision can be made.
 */
export function PermissionRequestDialog() {
  useLanguage()
  const [requests, setRequests] = useState<Request[]>([])
  const [later, setLater] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void Promise.resolve(invoke('network.status')).then(
      (status) => alive && setRequests(status.permissionRequests ?? []),
      () => {},
    )
    const off = ramu.on('permission:requests', ({ requests: next }) => setRequests(next))
    return () => {
      alive = false
      off()
    }
  }, [])
  const request = requests.find((entry) => !later.includes(entry.id))
  const requestId = request?.id
  useEffect(() => {
    setError(null)
    setBusy(false)
  }, [requestId])
  if (!request) return null
  const decide = (duration: PermissionDuration | 'deny' | 'never') => {
    setBusy(true)
    setError(null)
    void Promise.resolve(invoke('network.decidePermission', request.id, duration)).then(
      () => setRequests((current) => current.filter((entry) => entry.id !== request.id)),
      (reason) => {
        setBusy(false)
        setError(errorText(reason))
      },
    )
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && setLater((ids) => [...ids, request.id])}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('{0} asks for {1}', { 0: request.deviceName, 1: t(PERMISSION_LABEL[request.permission]) })}
          </DialogTitle>
          <DialogDescription>{t(PERMISSION_HELP[request.permission])}</DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="m-0 text-caption text-bad">
            {error}
          </p>
        )}
        <DialogFooter className="flex-wrap">
          <Button variant="ghost" disabled={busy} onClick={() => decide('never')}>
            {t('Never')}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => decide('deny')}>
            {t('Deny')}
          </Button>
          {PERMISSION_DURATIONS.map((duration) => (
            <Button
              key={duration}
              variant={duration === 'once' ? 'default' : 'secondary'}
              disabled={busy}
              onClick={() => decide(duration)}
            >
              {t(DURATION_LABEL[duration])}
            </Button>
          ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
