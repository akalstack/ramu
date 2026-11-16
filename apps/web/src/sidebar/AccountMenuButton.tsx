import { CircleUserRound, Settings } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { formatKeys } from '../commands'
import { t, useLanguage } from '../i18n'
import { Menu } from '../Menu'
import { AccountAvatar, useOwnAccount } from '../settings/AccountProfile'
import type { SettingsSection } from '../settings/SettingsPage'

const RAIL_BUTTON =
  'mt-auto size-9 flex-none justify-center border-transparent bg-transparent p-0 text-muted-foreground hover:bg-hover hover:text-foreground'

/**
 * The foot of the rail: the signed-in account's picture, opening a menu with who it is, Settings and the account; a
 * plain Settings button when signed out, since the account is optional.
 */
export function AccountMenuButton({ onOpen }: { onOpen: (section: SettingsSection) => void }) {
  useLanguage()
  const account = useOwnAccount()
  const user = account?.signedIn ? account.user : null
  const settingsTitle = `${t('Settings')} (${formatKeys('mod+,')})`
  if (!user)
    return (
      <Button
        variant="ghost"
        size="icon-sm"
        className={RAIL_BUTTON}
        aria-label={t('Settings')}
        title={settingsTitle}
        onClick={() => onOpen('appearance')}
      >
        <Settings size={18} />
      </Button>
    )
  return (
    <Menu
      label={t('Account and settings')}
      className={`${RAIL_BUTTON} aria-expanded:bg-hover`}
      icon={<AccountAvatar user={user} size={24} />}
      header={
        <div className="flex min-w-0 items-center gap-2.5 p-[6px_8px_8px]">
          <AccountAvatar user={user} size={32} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-control font-medium text-foreground">{user.name || user.email}</span>
            {user.name && <span className="truncate text-caption text-muted-foreground">{user.email}</span>}
          </div>
        </div>
      }
      items={[
        { key: 'sep', separator: true },
        {
          key: 'settings',
          label: (
            <>
              <Settings />
              {t('Settings')}
              <span className="muted">{formatKeys('mod+,')}</span>
            </>
          ),
          onSelect: () => onOpen('appearance'),
        },
        {
          key: 'account',
          label: (
            <>
              <CircleUserRound />
              {t('Ramu account')}
            </>
          ),
          onSelect: () => onOpen('account'),
        },
      ]}
    />
  )
}
