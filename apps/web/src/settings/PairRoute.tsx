import { useId, useState } from 'react'
import { Route } from 'lucide-react'
import type { PairingOffer } from '@ramu/shared/types'
import { hostOfUrl, networkName } from '@ramu/shared/networkLabel'
import { cn } from 'cn'
import { Button } from '@/components/desktop-button'
import { RowButton } from '@/components/row-button'
import { t } from '../i18n'
import { CopyButton } from './CopyAddressButton'
import { pairingUrls } from './pairingOffer'

type Address = PairingOffer['urls'][number]

const network = (entry: Address) => t(networkName(hostOfUrl(entry.url), entry.interface))

/** Which network an offered address is on: the tunnel by name, or a network and its interface (`Local network · en0`). */
const addressLabel = (entry: Address) =>
  entry.interface === 'tunnel' ? network(entry) : `${network(entry)} · ${entry.interface}`

/**
 * The address a pairing code carries, as one line naming its network, with **Change** opening this host's other
 * addresses to pick from or copy. Docker, VM and other virtual networks wait behind their own **Show more**, since a
 * phone almost never reaches a host through them.
 */
export function PairRoute({
  offer,
  url,
  onPick,
}: {
  offer: PairingOffer
  url: string | undefined
  onPick: (url: string) => void
}) {
  const [open, setOpen] = useState(false),
    [showOther, setShowOther] = useState(false)
  const listId = useId()
  const chosen = offer.urls.find((entry) => entry.url === url)
  if (!chosen)
    return (
      <p className="m-0 text-caption text-muted-foreground">
        {t('No network address found. Connect this host to a network or VPN.')}
      </p>
    )
  const { likely, other } = pairingUrls(offer.urls)
  const urls = showOther || !likely.length ? [...likely, ...other] : likely
  const hidden = likely.length + other.length - urls.length
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2.5">
        <Route size={14} className="flex-none text-muted-foreground" aria-hidden />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-control">{t('Phones reach this host through {0}', { 0: network(chosen) })}</span>
          <code className="truncate font-mono text-caption text-muted-foreground" title={chosen.url}>
            {chosen.url}
          </code>
        </div>
        {urls.length > 1 || hidden > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="flex-none"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen(!open)}
          >
            {open ? t('Done') : t('Change')}
          </Button>
        ) : (
          <CopyButton text={chosen.url} label={t('Copy address')} />
        )}
      </div>
      {open && (
        <div id={listId} className="flex flex-col gap-0.5 pl-6">
          <div role="radiogroup" aria-label={t('Address in the QR code')} className="flex flex-col gap-0.5">
            {urls.map((entry) => {
              const checked = entry.url === chosen.url
              return (
                <div key={entry.url} className="flex items-center gap-1">
                  <RowButton
                    size="sm"
                    role="radio"
                    aria-checked={checked}
                    className="flex-1"
                    onClick={() => onPick(entry.url)}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'grid size-3.5 flex-none place-items-center rounded-full border',
                        checked ? 'border-primary' : 'border-muted-foreground',
                      )}
                    >
                      {checked && <span className="size-1.5 rounded-full bg-primary" />}
                    </span>
                    <code className="min-w-0 flex-1 truncate font-mono text-foreground">{entry.url}</code>
                    <span className="flex-none text-caption text-muted-foreground">{addressLabel(entry)}</span>
                  </RowButton>
                  <CopyButton text={entry.url} label={t('Copy address')} />
                </div>
              )
            })}
          </div>
          {hidden > 0 && (
            <Button variant="ghost" size="sm" className="self-start" onClick={() => setShowOther(true)}>
              {t('Show {0} more (Docker, VM and other virtual networks)', { 0: hidden })}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
