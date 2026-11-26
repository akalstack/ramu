import { useEffect, useState } from 'react'
import type { NetworkStatus } from '@ramu/shared/types'
import { deviceChangeText } from '@ramu/shared/deviceChanges'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/desktop-button'
import { notify } from '@/components/app-toaster'
import { TOAST_MS } from '../chat/notificationCenter'
import { Dropdown } from '../Menu'
import { invoke, ramu } from '../ipc'
import { errorText } from '../lib/errors'
import { t, useLanguage } from '../i18n'

type Request = NetworkStatus['requests'][number]

const countdown = (expiresAt: number, now: number) => {
  const left = Math.max(0, Math.round((expiresAt - now) / 1000))
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
}

/**
 * A nearby device asking to pair with this host. It interrupts on purpose: the person compares a six-digit number
 * with the other screen and decides, and the request lapses in a few minutes. Shown for this window's own host only.
 */
export function PairingRequestDialog() {
  useLanguage()
  const [requests, setRequests] = useState<Request[]>([])
  const [role, setRole] = useState<'owner' | 'viewer'>('owner')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    let alive = true
    void Promise.resolve(invoke('network.status')).then(
      (status) => alive && setRequests(status.requests ?? []),
      () => {},
    )
    const off = ramu.on('pairing:requests', ({ requests: next }) => setRequests(next))
    return () => {
      alive = false
      off()
    }
  }, [])
  // A device signed in to this host's Ramu account paired on its own, as the person chose: say so, with a way back.
  useEffect(
    () =>
      ramu.on('pairing:joined', ({ deviceId, name, role, email }) =>
        notify.add({
          type: 'info',
          timeout: TOAST_MS.input,
          title: t('{0} connected', { 0: name || t('A device') }),
          description: t(
            role === 'owner'
              ? 'Signed in to your Ramu account {0}, so it paired with full access.'
              : 'Signed in to your Ramu account {0}, so it paired with view-only access.',
            { 0: email },
          ),
          actionProps: {
            children: t('Remove'),
            onClick: () =>
              void Promise.resolve(invoke('network.revoke', deviceId)).catch((cause) =>
                notify.add({ type: 'error', title: errorText(cause), timeout: TOAST_MS.error }),
              ),
          },
        }),
      ),
    [],
  )
  // A paired device changed the devices here (from a phone, say): the person at this host hears of it at once.
  useEffect(
    () =>
      ramu.on('devices:changed', (change) =>
        notify.add({
          type: 'info',
          timeout: TOAST_MS.input,
          title: deviceChangeText(change, t),
          description: t('Review it under Devices in Settings → Devices & access.'),
        }),
      ),
    [],
  )
  const request = requests.find((entry) => entry.expiresAt > now)
  const requestId = request?.id
  useEffect(() => {
    setRole('owner')
    setError(null)
    setBusy(false)
    setNow(Date.now())
  }, [requestId])
  useEffect(() => {
    if (!requestId) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [requestId])
  if (!request) return null
  const answer = (allow: boolean) => {
    setBusy(true)
    setError(null)
    const done = allow ? invoke('network.approveRequest', request.id, role) : invoke('network.denyRequest', request.id)
    void Promise.resolve(done).then(
      () => setRequests((current) => current.filter((entry) => entry.id !== request.id)),
      (e) => {
        setBusy(false)
        setError(errorText(e))
      },
    )
  }
  const name = request.name || t('A device')
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // Dismissing an unexpected request is a no.
        if (!open && !busy) answer(false)
      }}
    >
      <DialogContent className="sm:max-w-[440px]" aria-describedby="pairing-request-help">
        <DialogHeader>
          <DialogTitle>{t('{0} wants to pair', { 0: name })}</DialogTitle>
          <DialogDescription id="pairing-request-help">
            {t('Allow it only if it shows this number. From {0}.', { 0: request.address })}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-1 rounded-(--radius-m) bg-fill py-4">
          <div className="font-mono text-[32px] font-semibold tracking-[0.18em]" aria-live="polite">
            {request.code}
          </div>
          <div className="muted text-muted-foreground small text-caption">
            {t('Expires in {0}', { 0: countdown(request.expiresAt, now) })}
          </div>
        </div>
        <Dropdown
          label={t('Device access')}
          value={role}
          options={[
            { value: 'owner', label: t('Full access') },
            { value: 'viewer', label: t('View threads and answer requests') },
          ]}
          onChange={(value) => setRole(value as 'owner' | 'viewer')}
        />
        {error && (
          <p className="text-bad small text-caption" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => answer(false)}>
            {t('Deny')}
          </Button>
          <Button disabled={busy} onClick={() => answer(true)}>
            {t('Allow')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
