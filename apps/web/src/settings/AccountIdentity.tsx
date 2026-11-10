// Which identity an account belongs to, shown and changed where the account itself is connected (a provider login, a
// GitHub token, a deploy or media account, an MCP server, a plugin, a browser profile) instead of on a separate list.
// With fewer than two identities nothing here renders, so a person with one identity never sees the concept.
import { useContext } from 'react'
import { suggestedAccountIdentity, type Identity } from '@ramu/shared/identities'
import { ChevronDown, Users } from 'lucide-react'
import { cn } from 'cn'
import { Menu } from '../Menu'
import { ownHostId } from '../hosts'
import { t } from '../i18n'
import { refreshIdentities, useIdentities } from '../workspace/identities'
import { IdentityDot } from './IdentityChip'
import { SettingsScopeContext, useSettingsInvoke } from './SettingsScope'
import { useStaging } from './stagedChanges'

const stagingKey = (accountKey: string) => `identity:${accountKey}`

/** The settings host's identities, when it has two or more, and how its accounts are put in them. */
export function useAccountIdentities() {
  const scope = useContext(SettingsScopeContext)
  const hostId = scope?.primaryId || ownHostId()
  const snapshot = useIdentities(hostId)
  const invoke = useSettingsInvoke()
  const { valueOf, stage } = useStaging()
  const identities = snapshot && snapshot.settings.identities.length >= 2 ? snapshot.settings.identities : null
  const savedOwner = (accountKey: string) => {
    const owners = snapshot?.settings.accounts[accountKey] ?? []
    return owners.length === 1 ? owners[0]! : ''
  }
  const assign = async (accountKey: string, identityId: string) => {
    await invoke('identities.assign', accountKey, identityId ? [identityId] : [])
    await refreshIdentities(hostId)
  }
  return {
    identities,
    viewOnly: !!scope?.targets.find((target) => target.id === hostId)?.viewOnly,
    identity: (id: string | null | undefined) => identities?.find((entry) => entry.id === id) ?? null,
    /** The identity an account is in, as staged or saved; '' is every identity. */
    ownerOf: (accountKey: string) => valueOf(stagingKey(accountKey), savedOwner(accountKey)),
    /** Puts an account in one identity ('' for every identity) on Save changes, like any other setting. */
    setOwner: (accountKey: string, identityId: string) =>
      stage(stagingKey(accountKey), identityId, savedOwner(accountKey), (value) => assign(accountKey, value)),
    /** Puts an account just connected in its identity at once, as part of connecting it. */
    assign,
    /** The identity a new account of a kind is most likely for; '' is every identity. */
    suggestedFor: (kind: string) => (identities && snapshot ? suggestedAccountIdentity(snapshot.settings, kind) : ''),
  }
}

/** Where an account of this key is connected, so a guardrail card can send the person straight there. */
export function accountSection(accountKey: string): string {
  const kind = accountKey.slice(0, accountKey.indexOf(':'))
  const sections: Record<string, string> = {
    provider: 'providers',
    media: 'providers',
    forge: 'git',
    mcp: 'agent-setup',
    plugin: 'plugins',
    browser: 'browser',
  }
  return sections[kind] ?? 'identities'
}

/** An identity as a dot in its color and its name, for an account kept for that identity only. */
export function IdentityName({ identity }: { identity: Pick<Identity, 'name' | 'color'> }) {
  return (
    <span className="inline-flex flex-none items-center gap-1 text-caption text-muted-foreground">
      <IdentityDot color={identity.color} />
      {identity.name}
    </span>
  )
}

/**
 * The choice of identities as a small chip: the chosen identity's dot and name, or a muted users icon for All
 * identities. The same control on every account, so it reads the same wherever an account is connected.
 */
export function IdentityDropdown({
  identities,
  value,
  onChange,
  label,
  everyIdentity = true,
  disabled = false,
  caption,
}: {
  identities: Identity[]
  value: string
  onChange: (identityId: string) => void
  /** The accessible name and tooltip, such as "Identity for Vercel". */
  label: string
  /** Offer All identities first; off where the account must belong to one. */
  everyIdentity?: boolean
  disabled?: boolean
  /** A visible word before the chip, such as "For" in a form that adds an account. */
  caption?: string
}) {
  const chosen = identities.find((identity) => identity.id === value)
  const chip = (
    <Menu
      label={`${label} · ${chosen?.name ?? t('All identities')}`}
      align="end"
      disabled={disabled}
      className={cn(
        'h-6 min-h-6 max-w-[9rem] flex-none gap-1 rounded-(--radius-s) border-0 px-1.5 text-caption shadow-none hover:bg-hover! hover:text-foreground aria-expanded:bg-hover!',
        chosen ? 'bg-fill! text-foreground' : 'bg-transparent! text-muted-foreground',
      )}
      icon={
        chosen ? (
          <>
            <IdentityDot color={chosen.color} />
            <span className="truncate">{chosen.name}</span>
            <ChevronDown size={11} aria-hidden className="flex-none opacity-60" />
          </>
        ) : (
          <>
            <Users size={12} aria-hidden className="flex-none" />
            <span className="truncate">{t('All')}</span>
            <ChevronDown size={11} aria-hidden className="flex-none opacity-60" />
          </>
        )
      }
      items={[
        ...(everyIdentity
          ? [
              {
                key: '',
                label: (
                  <span className="inline-flex items-center gap-2">
                    <Users size={12} aria-hidden className="text-muted-foreground" />
                    {t('All identities')}
                  </span>
                ),
                selected: !chosen,
                onSelect: () => onChange(''),
              },
            ]
          : []),
        ...identities.map((identity) => ({
          key: identity.id,
          label: (
            <span className="inline-flex items-center gap-2">
              <IdentityDot color={identity.color} />
              {identity.name}
            </span>
          ),
          selected: identity.id === value,
          onSelect: () => onChange(identity.id),
        })),
      ]}
    />
  )
  if (!caption) return chip
  return (
    <span className="flex flex-none items-center gap-1 text-caption text-muted-foreground">
      {caption}
      {chip}
    </span>
  )
}

/** An account's identity on its own row, changed in place; nothing with fewer than two identities. */
export function AccountIdentityPicker({
  accountKey,
  name,
  disabled = false,
}: {
  accountKey: string
  /** The account as the row names it, for the control's accessible name. */
  name: string
  disabled?: boolean
}) {
  const { identities, viewOnly, ownerOf, setOwner } = useAccountIdentities()
  if (!identities) return null
  return (
    <IdentityDropdown
      identities={identities}
      label={t('Identity for {0}', { 0: name })}
      value={ownerOf(accountKey)}
      onChange={(identityId) => setOwner(accountKey, identityId)}
      disabled={disabled || viewOnly}
    />
  )
}
