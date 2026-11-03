import { Linking, View } from 'react-native'
import {
  accountDisplayName,
  planName,
  providerAccountRows,
  type ProviderAccount,
  type ProviderStatus,
} from '@ramu/shared/providers/providers'
import { useSay } from '../i18n'
import type { useHostSettings } from '../runtime/useHostSettings'
import { font, space } from '../theme'
import { Button, T, Toggle } from './ui'

/**
 * A provider's logins in the order they are tried, each with how it signs in and a switch to stop using it, as on the
 * desktop. Signing in, adding logins and entering API keys stay on the host, since they open a browser or take a secret.
 */
export function ProviderLogins({
  status,
  settings,
  disabled,
}: {
  status: ProviderStatus
  settings: ReturnType<typeof useHostSettings>
  disabled: boolean
}) {
  const say = useSay()
  const provider = status.provider
  const base = `providerBinaries.${provider}`
  const accounts = (settings.read(`${base}.accounts`) as ProviderAccount[] | undefined) ?? []
  const defaultOn = settings.read(`${base}.defaultAccountEnabled`) !== false
  const config = {
    [provider]: {
      binary: '',
      accounts,
      accountOrder: settings.read(`${base}.accountOrder`) as string[] | undefined,
      defaultAccountEnabled: defaultOn,
    },
  }
  const ids = providerAccountRows(config, provider)
  const on = (id: string) => (id === 'default' ? defaultOn : accounts.find((a) => a.id === id)?.enabled !== false)
  const onCount = ids.filter(on).length
  const ready = settings.state.status === 'ready'
  const toggle = (id: string, enabled: boolean) =>
    id === 'default'
      ? settings.set(`${base}.defaultAccountEnabled`, enabled)
      : settings.set(
          `${base}.accounts`,
          accounts.map((account) => (account.id === id ? { ...account, enabled } : account)),
        )
  return (
    <View style={{ gap: space.xs }}>
      {ids.map((id) => {
        const login = status.signIn?.[id]
        const shown = accountDisplayName(config, provider, id, login?.email)
        const name =
          shown.fallback === 'default'
            ? say(provider === 'antigravity' ? 'Default account' : 'Default CLI account')
            : shown.fallback === 'numbered'
              ? say('Account {0}', { '0': shown.number })
              : shown.name
        const state = !login
          ? ''
          : !login.signedIn
            ? say('Not signed in')
            : login.apiKey
              ? `${say('Signed in')} · ${say('API key')}`
              : `${say('Signed in')}${login.plan ? ` · ${planName(login.plan)}` : ''}`
        return (
          <View key={id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
            <View style={{ flex: 1, opacity: on(id) ? 1 : 0.6 }}>
              <T size={font.control} numberOfLines={1}>
                {name}
              </T>
              {state ? (
                <T size={font.caption} tone={login?.signedIn ? 'accent' : 'muted'}>
                  {state}
                </T>
              ) : null}
            </View>
            {login?.signedIn && login.upgradeUrl ? (
              <Button
                kind="ghost"
                title={say('Upgrade plan')}
                onPress={() => void Linking.openURL(login.upgradeUrl!).catch(() => {})}
              />
            ) : null}
            {ids.length > 1 ? (
              <Toggle
                accessibilityLabel={say('Turn account {0} on or off', { '0': name })}
                value={on(id)}
                disabled={disabled || !ready || (on(id) && onCount <= 1)}
                onValueChange={(enabled) => toggle(id, enabled)}
              />
            ) : null}
          </View>
        )
      })}
    </View>
  )
}
