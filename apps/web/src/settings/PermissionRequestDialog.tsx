import { useEffect, useState } from 'react'
import type { NetworkStatus } from '@ramu/shared/types'
import { PERMISSION_HELP, PERMISSION_LABEL, type PermissionAnswer } from '@ramu/shared/devicePermissions'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { RequestAnswers } from './DevicePermissions'
import { invoke, ramu } from '../ipc'
import { errorText } from '../lib/errors'
import { t, useLanguage } from '../i18n'

type Request = NetworkStatus['permissionRequests'][number]

/**
 * A paired device asking this host for a permission (Computer use, Browser, Terminals…), answered where the person is
 * instead of only in Settings. Closing it is not an answer: the request waits in Devices & access until it lapses.
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
    const load = () =>
      void Promise.resolve(invoke('network.status')).then(
        (status) => alive && setRequests(status.permissionRequests ?? []),
        () => {},
      )
    load()
    const off = ramu.on('permission:requests', ({ requests: next }) => setRequests(next))
    // A request made, answered or lapsed while the service was out of reach announced nothing.
    const reconnected = ramu.on('background:connection', ({ connected }) => {
      if (connected) load()
    })
    return () => {
      alive = false
      off()
      reconnected()
    }
  }, [])
  const request = requests.find((entry) => !later.includes(entry.id))
  const requestId = request?.id
  useEffect(() => {
    setError(null)
    setBusy(false)
  }, [requestId])
  if (!request) return null
  const decide = (answer: PermissionAnswer) => {
    setBusy(true)
    setError(null)
    void Promise.resolve(invoke('network.decidePermission', request.id, answer)).then(
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
          <RequestAnswers decide={decide} disabled={busy} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
