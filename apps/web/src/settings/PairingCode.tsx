import type { PairingOffer } from '@ramu/shared/types'
import { cn } from 'cn'
import { t } from '../i18n'
import { countdown, pairQrText } from './pairingOffer'
import { useQrImage } from './usePairingOffer'

/**
 * A pairing code as a phone reads it: a QR code its own camera opens (Ramu with the code filled in, or the app's store
 * page first) beside the code to type, with how long it lasts. A new code replaces it when it runs out.
 */
export function PairingCode({
  offer,
  now,
  url,
  name,
  className,
}: {
  offer: PairingOffer
  now: number
  url: string | undefined
  name?: string
  className?: string
}) {
  const qr = useQrImage(url ? pairQrText(offer, url, name) : null, 360)
  return (
    <div className={cn('flex items-center gap-5 rounded-(--radius-m) bg-fill p-4', className)}>
      {/* The image carries its own white margin, which cameras need to find the code in a dark theme too. */}
      <div className="grid size-[148px] flex-none place-items-center overflow-hidden rounded-(--radius-s)">
        {qr ? (
          <img src={qr} width={148} height={148} alt={t('Pairing QR code. Scan it with your phone’s camera.')} />
        ) : (
          <span className="text-center text-caption text-muted-foreground">
            {url ? t('Making the code…') : t('No address yet')}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-caption text-muted-foreground">{t('Pairing code')}</span>
        <span className="font-mono text-[24px] font-semibold tracking-[0.12em]">{offer.code}</span>
        <span className="text-caption text-muted-foreground">
          {t('Works once · a new one in {0}', { 0: countdown(offer.expiresAt, now) })}
        </span>
        <span className="mt-1 text-caption leading-[18px] text-muted-foreground">
          {t('Scan with your phone’s camera. It opens Ramu, or the App Store or Google Play first.')}
        </span>
      </div>
    </div>
  )
}
