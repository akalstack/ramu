import { useState } from 'react'
import { Link2, Wifi } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/desktop-button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { DIALOG_SCROLLS, DialogScrollBody } from '@/components/dialog-scroll-body'
import { errorText } from '../../lib/errors'
import { t } from '../../i18n'
import { CopyButton } from '../CopyAddressButton'
import { PairingCode } from '../PairingCode'
import { defaultPairUrl, pairingNetwork, pairQrText } from '../pairingOffer'
import { PairRoute } from '../PairRoute'
import { useSettingsInvoke } from '../SettingsScope'
import { usePairingOffer } from '../usePairingOffer'
import { AccessSection } from './AccessSection'
import { useNetworkStatus } from './useNetworkStatus'

/** The one way to add a phone or computer here: a button that opens the code, with the access it grants. */
export function ConnectDevice({ onClosed }: { onClosed: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <AccessSection
      title={t('Connect a device')}
      help={t(
        'Shows a QR code your phone’s camera opens, a link and a one-time code. With Discoverable on, nearby devices can ask instead, and you allow them here.',
      )}
      actions={
        <Button variant="secondary" className="bg-fill hover:bg-fill-hover" onClick={() => setOpen(true)}>
          <Link2 size={14} />
          {t('Connect a device…')}
        </Button>
      }
    >
      {open && (
        <PairDialog
          onClose={() => {
            setOpen(false)
            onClosed()
          }}
        />
      )}
    </AccessSection>
  )
}

/**
 * Pairs a phone or another computer: a large QR code its camera opens and a one-time code, renewed while the dialog is
 * open, with the access it grants and the address it carries beside it. With other devices not yet allowed, it says
 * so and allows them on this network in one step instead of sending the person to Reachable from. Opens from Devices &
 * access, the sidebar and the command palette.
 */
export function PairDialog({ onClose }: { onClose: () => void }) {
  const invoke = useSettingsInvoke()
  const [status, setStatus] = useNetworkStatus(2000)
  const [role, setRole] = useState<'owner' | 'viewer'>('owner')
  const [allowing, setAllowing] = useState(false),
    [allowError, setAllowError] = useState<string | null>(null)
  const ready = !!status?.reachable
  const { offer, now, error, joined } = usePairingOffer(invoke, role, ready)
  const [qrUrl, setQrUrl] = useState('')
  const change = status ? pairingNetwork(status) : null
  const allow = async () => {
    if (!change) return
    setAllowing(true)
    setAllowError(null)
    try {
      setStatus(await invoke('network.configure', change))
    } catch (e) {
      setAllowError(errorText(e))
    } finally {
      setAllowing(false)
    }
  }
  const url =
    (offer?.urls.some((entry) => entry.url === qrUrl) ? qrUrl : '') || (offer ? defaultPairUrl(offer.urls) : undefined)
  const name = status?.discovery?.name
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className={`${DIALOG_SCROLLS} sm:max-w-[520px]`} aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>
            {joined ? t('{0} is paired', { 0: joined.name }) : t('Connect a phone or computer')}
          </DialogTitle>
          {!joined && ready && (
            <DialogDescription>
              {t('Scan with your phone’s camera. It opens Ramu, or the App Store or Google Play first.')}
            </DialogDescription>
          )}
        </DialogHeader>
        <DialogScrollBody>
          {!status ? (
            <p className="muted text-muted-foreground small text-caption" role="status">
              {t('Checking this host…')}
            </p>
          ) : !ready ? (
            <div className="flex flex-col gap-3">
              <p className="m-0">
                {status.enabled
                  ? t('This host is starting to listen for other devices. The code appears in a moment.')
                  : change
                    ? t(
                        'Other devices can’t reach this host yet. Allow devices on this network, and the code appears here. Ramu does not encrypt this connection, so use it on a network or VPN you trust.',
                      )
                    : t('Set when Ramu was started with --listen. Change it there.')}
              </p>
              {status.error && (
                <p className="text-bad small text-caption" role="alert">
                  {status.error}
                </p>
              )}
              {allowError && (
                <p className="text-bad small text-caption" role="alert">
                  {allowError}
                </p>
              )}
              {change && !status.enabled && (
                <Button className="self-start" variant="default" disabled={allowing} onClick={() => void allow()}>
                  <Wifi size={14} />
                  {allowing ? t('Allowing…') : t('Allow devices on this network')}
                </Button>
              )}
            </div>
          ) : joined ? (
            <p className="muted text-muted-foreground">
              {t(joined.role === 'viewer' ? 'View threads and answer requests' : 'Full access')}
              {' · '}
              {t('It can now use this host. You can remove it any time under Devices in Settings → Devices & access.')}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {/* The code stays in place while a new one is made, so the access choice keeps focus when it changes. */}
              <PairingCode offer={offer} now={now} url={url} name={name}>
                <PairAccess role={role} onChange={setRole} />
              </PairingCode>
              {error && (
                <p className="m-0 text-bad text-caption" role="alert">
                  {error}
                </p>
              )}
              {offer && (
                <>
                  {url && (
                    <div className="flex flex-wrap items-center gap-2">
                      <CopyButton text={pairQrText(offer, url, name)} label={t('Copy link')} labelled />
                      <CopyButton text={offer.code} label={t('Copy code')} labelled />
                      <span className="text-caption text-muted-foreground">
                        {t('Paste the link on your phone to open it there.')}
                      </span>
                    </div>
                  )}
                  <PairRoute offer={offer} url={url} onPick={setQrUrl} />
                </>
              )}
              {status.discovery?.discoverable && (
                <p className="m-0 text-caption text-muted-foreground">
                  {t('Or pick this host under Nearby hosts on the phone, and allow it when both show the same number.')}
                </p>
              )}
            </div>
          )}
        </DialogScrollBody>
        <DialogFooter>
          <Button
            variant={joined ? 'default' : 'secondary'}
            className={joined ? undefined : 'bg-fill hover:bg-fill-hover'}
            onClick={onClose}
          >
            {joined ? t('Done') : t('Close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** What a paired device may do, as two choices beside the code and a line on what the chosen one means. */
function PairAccess({ role, onChange }: { role: 'owner' | 'viewer'; onChange: (role: 'owner' | 'viewer') => void }) {
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <ToggleGroup
        size="sm"
        variant="outline"
        spacing={0}
        aria-label={t('Device access')}
        value={[role]}
        onValueChange={(values) => {
          if (values[0] === 'owner' || values[0] === 'viewer') onChange(values[0])
        }}
      >
        <ToggleGroupItem value="owner" className="px-2.5">
          {t('Full access')}
        </ToggleGroupItem>
        <ToggleGroupItem value="viewer" className="px-2.5">
          {t('View only')}
        </ToggleGroupItem>
      </ToggleGroup>
      <span className="text-caption text-muted-foreground">
        {role === 'viewer'
          ? t('It can read threads and answer requests, but not start threads, change files or run commands.')
          : t('It can start threads and change files here, plus what this host allows new devices.')}
      </span>
    </div>
  )
}
