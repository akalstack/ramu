import { Settings } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { formatKeys } from '../commands'
import { t, useLanguage } from '../i18n'
import { AccountAvatar, useOwnAccount } from '../settings/AccountProfile'
import type { SettingsSection } from '../settings/SettingsPage'

/**
 * The foot of the rail opens Settings in one click. Signed in, it is the account's picture with a small gear on its
 * corner, so who is signed in stays visible and the account lives at the top of Settings; signed out it is the gear,
 * since the account is optional.
 */
export function AccountMenuButton({ onOpen }: { onOpen: (section: SettingsSection) => void }) {
  useLanguage()
  const account = useOwnAccount()
  const user = account?.signedIn ? account.user : null
  const keys = formatKeys('mod+,')
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="mt-auto size-10 flex-none justify-center border-transparent bg-transparent p-0 text-muted-foreground hover:bg-hover hover:text-foreground"
      aria-label={t('Settings')}
      title={user ? `${t('Settings')} · ${user.name || user.email} (${keys})` : `${t('Settings')} (${keys})`}
      onClick={() => onOpen('appearance')}
    >
      {user ? (
        <span className="relative flex">
          <AccountAvatar user={user} size={28} />
          <span
            aria-hidden="true"
            data-gear-badge=""
            className="absolute -right-1 -bottom-1 flex size-3.5 items-center justify-center rounded-full bg-muted text-foreground ring-2 ring-(--sidebar)"
          >
            <Settings size={9} strokeWidth={2.5} />
          </span>
        </span>
      ) : (
        <Settings size={20} />
      )}
    </Button>
  )
}
