import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { UserRound } from 'lucide-react'
import type { AccountProvider, AccountStatus, AccountUser } from '@ramu/shared/account'
import { BrandIcon } from '@/components/brand-icon'
import { RowButton } from '@/components/row-button'
import { CommentAvatar } from '../git/CommentAvatar'
import { ownHostId } from '../hosts'
import { t, useLanguage } from '../i18n'
import { invoke, ramu } from '../ipc'

const PROVIDER_NAMES: Record<AccountProvider, string> = { github: 'GitHub', google: 'Google' }

/** "Signed in with GitHub" for the provider the account was made with, or null before the host knows it. */
function signedInWith(providers: readonly AccountProvider[]): string | null {
  const first = providers[0]
  return first ? t('Signed in with {provider}', { provider: PROVIDER_NAMES[first] }) : null
}

/**
 * This host's Ramu account, refreshed when the host says it changed. Null while loading, and for a device that may
 * not read it, which then shows the signed-out controls.
 */
export function useOwnAccount(): AccountStatus | null {
  const client = useQueryClient()
  const host = ownHostId()
  const status = useQuery({
    queryKey: ['ipc', host, 'account.status'],
    queryFn: () => invoke('account.status'),
    retry: false,
  })
  useEffect(
    () =>
      ramu.on('account:changed', () => void client.invalidateQueries({ queryKey: ['ipc', host, 'account.status'] })),
    [client, host],
  )
  return status.data ?? null
}

/** The account's picture, fetched through the host, or its initials. */
export function AccountAvatar({ user, size }: { user: AccountUser; size: number }) {
  return <CommentAvatar name={user.name || user.email} url={user.image ?? undefined} size={size} />
}

/** Who is signed in: picture, name, email and the provider used, for the Account section. */
export function AccountProfileHeader({ user, providers }: { user: AccountUser; providers: AccountProvider[] }) {
  useLanguage()
  const via = signedInWith(providers)
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <AccountAvatar user={user} size={40} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <strong className="truncate text-control font-medium">{user.name || user.email}</strong>
        {user.name && <span className="truncate text-caption text-muted-foreground">{user.email}</span>}
        {via && (
          <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
            {providers[0] && <BrandIcon brand={providers[0]} size={12} />}
            {via}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * The account at the top of the Settings menu, opening the Account section: who is signed in, or a quiet offer to
 * sign in, since the account is optional. Nothing while the host has not said, or for a device that may not read it.
 */
export function SettingsAccountRow({ disabled, onOpen }: { disabled: boolean; onOpen: () => void }) {
  useLanguage()
  const account = useOwnAccount()
  if (!account) return null
  const user = account.signedIn ? account.user : null
  return (
    <RowButton
      size="lg"
      className="settings-account mb-3 rounded-(--radius-s) px-2"
      title={t('Ramu account')}
      disabled={disabled}
      onClick={onOpen}
    >
      {user ? (
        <AccountAvatar user={user} size={28} />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-7 flex-none items-center justify-center rounded-full bg-fill text-muted-foreground"
        >
          <UserRound size={16} />
        </span>
      )}
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-control font-medium text-foreground">
          {user ? user.name || user.email : t('Sign in to Ramu')}
        </span>
        {user ? (
          user.name && <span className="truncate text-caption text-muted-foreground">{user.email}</span>
        ) : (
          <span className="truncate text-caption text-muted-foreground">{t('Back up settings, reach your hosts')}</span>
        )}
      </span>
    </RowButton>
  )
}
