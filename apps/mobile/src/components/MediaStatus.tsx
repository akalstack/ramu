import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { translate } from '@ramu/shared/i18n'
import type { MediaAccount } from '@ramu/shared/types/media'
import { useStore } from '../runtime/store'
import { font, space, useTheme } from '../theme'
import { Card, Divider, SectionLabel, T } from './ui'
import { BrandIcon } from './Logos'

/** Last answer per host, so an unreachable host still shows what was known. */
const lastKnown = new Map<string, MediaAccount[]>()

/**
 * The media services' API keys on the selected host. Keys are pasted on the host's own computer; the phone never holds
 * one, so this card only says what is connected and where to connect the rest.
 */
export function MediaStatus({ hostId }: { hostId: string }) {
  const store = useStore()
  const { c } = useTheme()
  const t = (key: string, values?: Record<string, string>) => translate(store.language, key, values)
  const online = store.isOnline(hostId)
  const [accounts, setAccounts] = useState<MediaAccount[] | null>(() => lastKnown.get(hostId) ?? null)
  const [failed, setFailed] = useState(false)
  const generation = useRef(0)
  const runtime = useRef(store)
  runtime.current = store

  const load = useCallback(async () => {
    const mine = ++generation.current
    setFailed(false)
    try {
      const result = await runtime.current.invoke(hostId, 'abilities.mediaAccounts', false)
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
      <SectionLabel>{t('Media')}</SectionLabel>
      <Card style={{ marginHorizontal: space.l }}>
        {accounts.map((account, index) => (
          <View key={account.service}>
            {index ? <Divider inset={space.l} /> : null}
            <View style={{ padding: space.m, gap: space.s, flexDirection: 'row', alignItems: 'center' }}>
              <BrandIcon brand={account.service} size={18} />
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
      <T size={font.caption} tone="muted" style={{ paddingHorizontal: space.xl, paddingTop: space.m }}>
        {t('Save API keys in Ramu on the host computer, under Settings → Providers. The phone never stores a key.')}
      </T>
    </>
  )
}
