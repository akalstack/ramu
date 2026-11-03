import { UserRound } from 'lucide-react-native'
import { accountName, providerAccountOrder, providerName } from '@ramu/shared/providers/providers'
import type { AgentProvider } from '@ramu/shared/types'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import { useAccountLogins } from '../runtime/useAccountLogins'
import { SheetGroup, SheetOption } from './SheetOptions'

/**
 * Which login of the provider the thread runs on, as on the desktop. Usage limits still move a thread to the next login by
 * themselves; this lets a person pick one on purpose. Shown only when the provider has more than one login turned on.
 */
export function AccountRows({
  computerId,
  provider,
  accountId,
  onPick,
}: {
  computerId: string
  provider: AgentProvider
  accountId?: string
  onPick: (accountId: string) => void
}) {
  const store = useStore()
  const say = useSay()
  const config = store.appPreferences[computerId]?.providerBinaries
  const order = providerAccountOrder(config, provider)
  const several = order.length > 1
  const logins = useAccountLogins([computerId], several)[computerId]?.[provider] ?? {}
  if (!several) return null
  const selected = accountId && order.includes(accountId) ? accountId : order[0]
  const name = (id: string) => accountName(config, provider, id, logins[id], say)
  return (
    <SheetGroup
      title={say('{0} account', { '0': providerName(provider) })}
      footer={say('A usage limit still moves the thread to the next login by itself.')}
    >
      {order.map((id) => (
        <SheetOption
          key={id}
          icon={UserRound}
          title={name(id)}
          selected={id === selected}
          onPress={() => {
            if (id !== selected) onPick(id)
          }}
        />
      ))}
    </SheetGroup>
  )
}
