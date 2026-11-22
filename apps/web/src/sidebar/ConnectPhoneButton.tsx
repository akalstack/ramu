import { Smartphone } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { t, useLanguage } from '../i18n'

/** Opens pairing from anywhere in the app: a QR code the phone's camera opens, without a trip through Settings. */
export function ConnectPhoneButton() {
  useLanguage()
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="mt-auto size-10 flex-none justify-center border-transparent bg-transparent p-0 text-muted-foreground hover:bg-hover hover:text-foreground"
      aria-label={t('Connect a phone')}
      title={t('Connect a phone')}
      onClick={() => window.dispatchEvent(new Event('ramu:connect-phone'))}
    >
      <Smartphone size={19} />
    </Button>
  )
}
