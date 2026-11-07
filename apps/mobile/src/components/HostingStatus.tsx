import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { accountBrand } from '@ramu/shared/brands'
import { accountName } from '@ramu/shared/deployText'
import { forgeStatusText } from '@ramu/shared/forgeStatus'
import { translate } from '@ramu/shared/i18n'
import type { ForgeConnectionSummary, HostingAccount } from '@ramu/shared/types'
import { useStore } from '../runtime/store'
import { font, space, useTheme } from '../theme'
import { Card, Divider, SectionLabel, T } from './ui'
import { BrandIcon } from './Logos'

/** Last answer per host, so an unreachable host still shows what was known, marked as stale. */
const lastKnown = new Map<string, ForgeConnectionSummary>()

/**
 * GitHub on the selected host: the sign-ins it detected and the tokens saved there, in words. Tokens are added, replaced
 * and removed on the host's own computer; the phone never holds one, so this card only explains the state and the next step.
 */
export function HostingStatus({ hostId }: { hostId: string }) {
  const store = useStore()
  const { c } = useTheme()
  const t = (key: string, values?: Record<string, string>) => translate(store.language, key, values)
  const words = forgeStatusText(t)
  const online = store.isOnline(hostId)
  const [summary, setSummary] = useState<ForgeConnectionSummary | null>(() => lastKnown.get(hostId) ?? null)
  const [deploy, setDeploy] = useState<HostingAccount[]>([])
  const [failed, setFailed] = useState(false)
  const [stale, setStale] = useState(!online)
  const generation = useRef(0)
  const runtime = useRef(store)
  runtime.current = store

  const load = useCallback(async () => {
    const mine = ++generation.current
    setFailed(false)
    try {
      const result = await runtime.current.invoke(hostId, 'forge.connections')
      // A late answer for another host selection or an older request is dropped.
      if (mine !== generation.current) return
      lastKnown.set(hostId, result)
      setSummary(result)
      setStale(false)
      // A host without deploys yet simply shows no platforms.
      const accounts = await runtime.current.invoke(hostId, 'deploy.accounts', false).catch(() => null)
      if (mine === generation.current) setDeploy(accounts?.accounts ?? [])
    } catch {
      if (mine !== generation.current) return
      setFailed(true)
      setStale(true)
    }
  }, [hostId])
  useEffect(() => {
    setSummary(lastKnown.get(hostId) ?? null)
    setStale(!online)
    if (online) void load()
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- a counter that invalidates in-flight work; it is not a DOM ref
      ++generation.current
    }
  }, [hostId, online, load])

  const guidance =
    summary?.credentialStore === 'unavailable'
      ? t(
          'The credential store on the host is locked or missing, so tokens cannot be saved there. Sign-ins from the GitHub CLI still work.',
        )
      : summary && summary.cli !== 'signed-in' && !summary.saved?.some((connection) => connection.state === 'connected')
        ? t(
            'Connect GitHub in Ramu on the host computer (Settings → Git → Hosting accounts). The phone never stores a GitHub token.',
          )
        : null
  return (
    <>
      <SectionLabel>{t('GitHub on this host')}</SectionLabel>
      <Card style={{ marginHorizontal: space.l }}>
        {!summary && online && !failed ? (
          <View style={{ padding: space.m }}>
            <ActivityIndicator color={c.accent} />
          </View>
        ) : (
          <View style={{ padding: space.m, gap: space.s }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
              <BrandIcon brand="github" size={16} />
              <T style={{ flex: 1 }} accessibilityLiveRegion="polite" accessibilityRole={failed ? 'alert' : undefined}>
                {!summary && !online ? t('Reconnect to check GitHub.') : words.connectionHeadline(summary, failed)}
              </T>
            </View>
            {stale && summary ? (
              <T size={font.caption} tone="muted">
                {t('Showing the last result; the host is not reachable.')}
              </T>
            ) : null}
          </View>
        )}
        {summary?.accounts.map((account) => (
          <View key={`${account.host}:${account.login}`}>
            <Divider inset={space.l} />
            <View style={{ padding: space.m, gap: space.xs }}>
              <T weight="600">{`${account.login} · ${account.host}`}</T>
              <T size={font.caption} tone="muted">
                {words.accountDetail(account)}
              </T>
            </View>
          </View>
        ))}
        {summary?.saved?.map((connection) => (
          <View key={connection.id}>
            <Divider inset={space.l} />
            <View style={{ padding: space.m, gap: space.xs }}>
              <T weight="600">{`${connection.login ?? t('Saved token')} · ${connection.origin}`}</T>
              <T size={font.caption} tone={connection.state === 'connected' ? 'muted' : 'warn'}>
                {words.savedDetail(connection)}
              </T>
            </View>
          </View>
        ))}
        {deploy.map((account) => (
          <View key={account.platform}>
            <Divider inset={space.l} />
            <View style={{ padding: space.m, gap: space.xs, flexDirection: 'row', alignItems: 'center' }}>
              <BrandIcon brand={accountBrand(account.platform)} size={16} />
              <T style={{ flex: 1 }} size={font.caption} tone={account.error ? 'warn' : 'muted'}>
                {!account.connected
                  ? t('{0}: not connected. Connect it in Ramu on the host computer.', {
                      0: accountName(t, account.platform, account.name),
                    })
                  : (account.error ??
                    t('{0}: connected as {1}', {
                      0: accountName(t, account.platform, account.name),
                      1: account.account ?? account.name,
                    }))}
              </T>
            </View>
          </View>
        ))}
        {guidance ? (
          <>
            <Divider inset={space.l} />
            <View style={{ padding: space.m }}>
              <T size={font.caption} tone="muted">
                {guidance}
              </T>
            </View>
          </>
        ) : null}
      </Card>
    </>
  )
}
