import type { ReactNode } from 'react'
import type { PairingOffer } from '@ramu/shared/types'
import { cn } from 'cn'
import { t } from '../i18n'
import { countdown, pairQrText } from '@ramu/shared/pairingOffer'
import { useQrImage } from './usePairingOffer'

const QR_SIZE = 184

/**
 * A pairing code as a phone reads it: a large QR code its own camera opens (Ramu with the code filled in, or the app's
 * store page first) beside the code to type and when a new one replaces it. `children` sits under the code, for what
 * the screen lets a person change about it. Without an offer it keeps its place while the next code is made, so a
 * control in `children` keeps focus across a new code.
 */
export function PairingCode({
  offer,
  now,
  url,
  name,
  className,
  children,
}: {
  offer: PairingOffer | null
  now: number
  url: string | undefined
  name?: string
  className?: string
  children?: ReactNode
}) {
  const qr = useQrImage(offer && url ? pairQrText(offer, url, name) : null, QR_SIZE * 2)
  return (
    <div className={cn('flex flex-wrap items-center justify-center gap-5 rounded-(--radius-m) bg-fill p-4', className)}>
      {/* The image carries its own white margin, which cameras need to find the code in a dark theme too. */}
      <div className="grid size-[184px] flex-none place-items-center overflow-hidden rounded-(--radius-s)">
        {qr ? (
          <img
            src={qr}
            width={QR_SIZE}
            height={QR_SIZE}
            alt={t('Pairing QR code. Scan it with your phone’s camera.')}
          />
        ) : (
          <span className="text-center text-caption text-muted-foreground" role="status">
            {offer && !url ? t('No address yet') : t('Making the code…')}
          </span>
        )}
      </div>
      <div className="flex min-w-[200px] flex-1 flex-col gap-1">
        <span className="text-caption text-muted-foreground">{t('Pairing code')}</span>
        <span className="font-mono text-[24px] font-semibold tracking-[0.12em] select-all">{offer?.code ?? '—'}</span>
        <span className="text-caption text-muted-foreground tabular-nums">
          {offer ? t('New code in {0}', { 0: countdown(offer.expiresAt, now) }) : ' '}
        </span>
        {children}
      </div>
    </div>
  )
}
