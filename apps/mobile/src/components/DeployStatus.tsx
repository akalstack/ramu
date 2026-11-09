import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { accountBrand } from '@ramu/shared/brands'
import { translate } from '@ramu/shared/i18n'
import type { HostingAccount } from '@ramu/shared/types'
import { DEPLOY_ACCOUNT_GROUPS } from '@ramu/shared/types/deploy'
import { useStore } from '../runtime/store'
import { font, space, useTheme } from '../theme'
import { Card, Divider, SectionLabel, T } from './ui'
import { BrandIcon } from './Logos'

/** Last answer per host, so an unreachable host still shows what was known. */
const lastKnown = new Map<string, HostingAccount[]>()

/**
 * The deploy accounts on the selected host, grouped as the desktop's Deploy page groups them. Tokens are pasted on the
 * host's own computer; the phone never holds one, so this page only says what is connected and where to connect the rest.
 */
export function DeployStatus({ hostId, only }: { hostId: string; only?: 'media' }) {
  const store = useStore()
  const { c } = useTheme()
  const t = (key: string, values?: Record<string, string>) => translate(store.language, key, values)
  const online = store.isOnline(hostId)
  const [accounts, setAccounts] = useState<HostingAccount[] | null>(() => lastKnown.get(hostId) ?? null)
  const [failed, setFailed] = useState(false)
  const generation = useRef(0)
  const runtime = useRef(store)
  runtime.current = store

  const load = useCallback(async () => {
    const mine = ++generation.current
    setFailed(false)
    try {
      const result = await runtime.current.invoke(hostId, 'deploy.accounts', false)
      if (mine !== generation.current) return
      lastKnown.set(hostId, result.accounts)
      setAccounts(result.accounts)
    } catch {
      if (mine === generation.current) setFailed(true)
    }
  }, [hostId])
  useEffect(() => {
    setAccounts(lastKnown.get(hostId) ?? null)
    if (online) void load()
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- a counter that invalidates in-flight work; it is not a DOM ref
      ++generation.current
    }
  }, [hostId, online, load])

  if (!accounts)
    return (
      <Card style={{ marginHorizontal: space.l }}>
        <View style={{ padding: space.m }}>
          {online && !failed ? (
            <ActivityIndicator color={c.accent} />
          ) : (
            <T tone="muted" accessibilityRole={failed ? 'alert' : undefined}>
              {failed ? t('Could not read the accounts on this host.') : t('Reconnect to check the accounts.')}
            </T>
          )}
        </View>
      </Card>
    )
  return (
    <>
      {(only ? [{ kind: only, title: 'Media' }] : DEPLOY_ACCOUNT_GROUPS).map((group) => {
        const members = accounts.filter((account) => account.kind === group.kind)
        if (!members.length) return null
        return (
          <View key={group.kind}>
            <SectionLabel>{t(group.title)}</SectionLabel>
            <Card style={{ marginHorizontal: space.l }}>
              {members.map((account, index) => (
                <View key={account.platform}>
                  {index ? <Divider inset={space.l} /> : null}
                  <View style={{ padding: space.m, gap: space.s, flexDirection: 'row', alignItems: 'center' }}>
                    <BrandIcon brand={accountBrand(account.platform)} size={18} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <T weight="600">{account.name}</T>
                      <T size={font.caption} tone={account.error ? 'warn' : 'muted'}>
                        {account.error ??
                          (account.connected
                            ? t('Connected as {0}', { 0: account.account ?? account.name })
                            : t('Not connected'))}
                      </T>
                    </View>
                  </View>
                </View>
              ))}
            </Card>
          </View>
        )
      })}
      <T size={font.caption} tone="muted" style={{ paddingHorizontal: space.xl, paddingTop: space.m }}>
        {only === 'media'
          ? t('Save API keys in Ramu on the host computer, under Settings → Media. The phone never stores a key.')
          : t(
              'Connect accounts in Ramu on the host computer, under Settings → Deploy. The phone never stores a token.',
            )}
      </T>
    </>
  )
}
