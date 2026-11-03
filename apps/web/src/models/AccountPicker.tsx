import { ChevronDown, UserRound } from 'lucide-react'
import { providerAccountOrder, providerName } from '@ramu/shared/providers/providers'
import type { AgentSettings } from '@ramu/shared/types'
import { t, useLanguage } from '../i18n'
import { Menu } from '../Menu'
import { useAppSettings } from '../settings/AppSettings'
import { accountLabel, useAccountEmails } from '../settings/Usage'

/**
 * Which login of the provider the thread runs on. Usage limits still move a thread to the next login by themselves; this
 * lets a person choose one on purpose, such as an API key for a long task or a work login for work. Shown only when the
 * provider has more than one login turned on.
 */
export function AccountPicker({
  settings,
  onChange,
  disabled,
}: {
  settings: AgentSettings
  onChange: (settings: AgentSettings) => void
  disabled: boolean
}) {
  useLanguage()
  const { preferences } = useAppSettings()
  const config = preferences.providerBinaries
  const order = providerAccountOrder(config, settings.provider)
  const emails = useAccountEmails(order.length > 1)[settings.provider] ?? {}
  if (order.length < 2) return null
  const current = settings.accountId && order.includes(settings.accountId) ? settings.accountId : order[0]!
  const name = (id: string) => accountLabel(config, id, settings.provider, emails[id])
  return (
    <Menu
      standard
      label={t('{0} account · {1}', { '0': providerName(settings.provider), '1': name(current) })}
      className="control-btn h-8 min-w-0 gap-2 px-2 text-sm [&>span]:truncate"
      disabled={disabled}
      icon={
        <>
          <UserRound size={13} />
          <span className="max-w-[160px] truncate">{name(current)}</span>
          <ChevronDown size={12} />
        </>
      }
      items={[
        { key: 'heading', heading: t('{0} account', { '0': providerName(settings.provider) }) },
        ...order.map((id) => ({
          key: id,
          label: name(id),
          selected: id === current,
          onSelect: () => {
            if (id !== current) onChange({ ...settings, accountId: id })
          },
        })),
        { key: 'sep', separator: true as const },
        {
          key: 'settings',
          label: t('Manage logins…'),
          onSelect: () => window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'providers' } })),
        },
      ]}
    />
  )
}
