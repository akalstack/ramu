import { Check, ChevronRight, UserRound } from 'lucide-react'
import { accountName, providerAccountOrder, providerName } from '@ramu/shared/providers/providers'
import { loginUsage, loginUsageLine } from '@ramu/shared/providers/loginUsage'
import type { AgentSettings } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { currentLanguage, t, useLanguage } from '../i18n'
import { MenuItems, type MenuEntry } from '../Menu'
import { useAppSettings } from '../settings/AppSettings'
import { useAccountLogins, useAccountUsage } from '../settings/Usage'

/**
 * The provider's logins for the model panel: each one's name and how much room it has for this model. Null when the
 * provider has a single login, since there is nothing to choose.
 */
export function useLoginChoices(settings: AgentSettings) {
  const { preferences } = useAppSettings()
  const config = preferences.providerBinaries
  const order = providerAccountOrder(config, settings.provider)
  const several = order.length > 1
  const logins = useAccountLogins(several)[settings.provider] ?? {}
  const readings = useAccountUsage(several)
  if (!several) return null
  const current = settings.accountId && order.includes(settings.accountId) ? settings.accountId : order[0]!
  const usage = (id: string) => loginUsage(readings, settings.provider, id, settings.model)
  return {
    order,
    current,
    name: (id: string) => accountName(config, settings.provider, id, logins[id], t),
    usage,
    line: (id: string) => loginUsageLine(usage(id), currentLanguage()),
  }
}
type LoginChoices = NonNullable<ReturnType<typeof useLoginChoices>>

/**
 * The model panel's account row: which login the thread runs on, and whether it is at a limit. Usage limits still move a
 * thread to the next login by themselves; this lets a person choose one on purpose, such as a work login for work.
 */
export function AccountRow({
  choices,
  disabled,
  onOpen,
}: {
  choices: LoginChoices
  disabled: boolean
  onOpen: () => void
}) {
  useLanguage()
  const { current } = choices
  const limited = choices.usage(current)?.limited
  return (
    <Button
      variant="ghost"
      disabled={disabled}
      className="h-auto min-h-9 w-full justify-start gap-2 rounded-(--radius-s) px-2 py-1.5 text-left hover:bg-hover"
      aria-label={t('Account · {0}', { 0: choices.name(current) })}
      onClick={onOpen}
    >
      <UserRound size={14} className="flex-none text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-control text-foreground">{choices.name(current)}</span>
        {choices.line(current) && (
          <span className={`truncate text-caption ${limited ? 'text-warn' : 'text-muted-foreground'}`}>
            {choices.line(current)}
          </span>
        )}
      </span>
      <ChevronRight size={13} className="flex-none text-muted-foreground" />
    </Button>
  )
}

/** Every login of the provider, each with its room, so a person does not pick one that is also at its limit. */
export function AccountList({
  settings,
  choices,
  onChange,
  onDone,
}: {
  settings: AgentSettings
  choices: LoginChoices
  onChange: (settings: AgentSettings) => void
  onDone: () => void
}) {
  useLanguage()
  const items: MenuEntry[] = [
    { key: 'heading', heading: t('{0} account', { '0': providerName(settings.provider) }) },
    ...choices.order.map((id) => {
      const line = choices.line(id)
      const limited = choices.usage(id)?.limited
      return {
        key: id,
        selected: id === choices.current,
        label: (
          <>
            <span className="grow flex-1 min-w-0 text-left">
              <span className="block truncate">{choices.name(id)}</span>
              {line && (
                <span className={`block truncate text-caption ${limited ? 'text-warn' : 'text-muted-foreground'}`}>
                  {line}
                </span>
              )}
            </span>
            {id === choices.current && <Check size={13} />}
          </>
        ),
        onSelect: () => {
          if (id !== choices.current) onChange({ ...settings, accountId: id })
        },
      }
    }),
    { key: 'sep', separator: true as const },
    {
      key: 'settings',
      label: t('Manage logins…'),
      onSelect: () => window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'providers' } })),
    },
  ]
  return (
    <div role="menu" aria-label={t('{0} account', { '0': providerName(settings.provider) })}>
      <MenuItems items={items} close={onDone} />
    </div>
  )
}
