import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Linking, View } from 'react-native'
import * as Device from 'expo-device'
import type { AccountUser, ListedHostInfo } from '@ramu/shared/account'
import { translate } from '@ramu/shared/i18n'
import * as account from '../runtime/account'
import { secureRandom } from '../runtime/secureRandom'
import { useStore } from '../runtime/store'
import { connectAccountHosts } from './AccountHosts'
import { space, useTheme, type Appearance, type TextSize } from '../theme'
import { RowLabel, TextRow } from './SettingRows'
import { Button, Card, Divider, Row, SectionLabel, T } from './ui'

const phoneName = () => Device.deviceName || Device.modelName || 'Ramu phone'

/**
 * The Ramu account on this phone: sign in, approve a new host's request for the backup key after the numbers match,
 * back up and restore this phone's own preferences, and add a host listed in the account without a code.
 */
export function AccountSettings() {
  const store = useStore()
  const theme = useTheme()
  const { c } = theme
  const t = (text: string, values?: Record<string, string | number>) => translate(store.language, text, values)
  const [user, setUser] = useState<AccountUser | null | undefined>(undefined)
  const [signIn, setSignIn] = useState<{ userCode: string; url: string } | null>(null)
  const [requests, setRequests] = useState<{ id: string; name: string; code: string | null }[]>([])
  const [hosts, setHosts] = useState<ListedHostInfo[]>([])
  const [hasKey, setHasKey] = useState(false)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const pairing = useRef<AbortController | null>(null)
  const refresh = async () => {
    setUser(await account.accountUser())
    setHasKey(await account.hasBackupKey())
  }
  useEffect(() => {
    void refresh()
  }, [])
  useEffect(() => {
    if (!user) return
    const read = () => {
      void account.keyRequests().then(setRequests, () => {})
      void account.listedHosts().then(setHosts, () => {})
    }
    read()
    const timer = setInterval(read, 3000)
    return () => clearInterval(timer)
  }, [user])
  const act = async (run: () => Promise<void>) => {
    setBusy(true)
    setStatus('')
    try {
      await run()
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }
  const random = async () => {
    const source = await secureRandom()
    if (!source) throw new Error(t('This phone cannot make secure random numbers.'))
    return source
  }
  const preferences = (): account.PhonePreferences => ({
    appearance: theme.appearance,
    textSize: theme.textSize,
    language: store.language,
    themes: theme.themes,
    selectedTheme: theme.themes.some((entry) => entry.id === theme.theme.id) ? theme.theme.id : null,
    layout: Object.fromEntries(Object.entries(store.drafts ?? {}).filter(([key]) => key.startsWith('pref-device:'))),
  })
  if (user === undefined) return <ActivityIndicator color={c.accent} style={{ padding: space.l }} />
  return (
    <View>
      <T size={13} tone="muted" style={{ paddingHorizontal: space.l, paddingTop: space.m }}>
        {t(
          'Optional. It keeps backups only your devices can open and connects this phone to the hosts you listed, as each host allows. Run by Akalstack.',
        )}
      </T>
      {status ? (
        <T tone="bad" style={{ paddingHorizontal: space.l, paddingTop: space.s }}>
          {status}
        </T>
      ) : null}
      <SectionLabel>{t('Ramu account')}</SectionLabel>
      <Card style={{ marginHorizontal: space.l }}>
        {user ? (
          <Row style={{ paddingVertical: space.m }}>
            <RowLabel title={user.email} help={user.name} />
            <Button
              kind="secondary"
              title={t('Sign out')}
              disabled={busy}
              onPress={() => void act(async () => (await account.signOut(), await refresh()))}
            />
          </Row>
        ) : signIn ? (
          <Row style={{ paddingVertical: space.m }}>
            <RowLabel
              title={t('Code: {code}', { code: signIn.userCode })}
              help={t('Sign in with GitHub, Google or a passkey, check the code matches and choose Approve.')}
            />
            <Button title={t('Open')} onPress={() => void Linking.openURL(signIn.url)} />
          </Row>
        ) : (
          <Row style={{ paddingVertical: space.m }}>
            <RowLabel title={t('Not signed in')} />
            <Button
              title={t('Sign in')}
              disabled={busy}
              onPress={() =>
                void act(async () => {
                  const started = await account.startSignIn()
                  setSignIn({ userCode: started.userCode, url: started.url })
                  void Linking.openURL(started.url)
                  const signed = await started.wait()
                  setSignIn(null)
                  if (!signed) throw new Error(t('The sign-in expired or was denied. Try again.'))
                  await refresh()
                  connectAccountHosts()
                })
              }
            />
          </Row>
        )}
      </Card>
      {user ? (
        <>
          <SectionLabel>{t('This phone’s settings')}</SectionLabel>
          <Card style={{ marginHorizontal: space.l }}>
            <Row style={{ paddingVertical: space.m }}>
              <RowLabel
                title={t('Back up this phone')}
                help={t(
                  'Appearance, text size, language, themes and layout, sealed on this phone. Paired hosts and drafts are never included.',
                )}
              />
              <Button
                kind="secondary"
                title={t('Back up')}
                disabled={busy}
                onPress={() =>
                  void act(async () => {
                    await account.backUpPhone(preferences(), phoneName(), await random())
                    setHasKey(true)
                    setStatus(t('Backed up.'))
                  })
                }
              />
            </Row>
            <Divider inset={space.l} />
            {hasKey ? (
              <Row style={{ paddingVertical: space.m }}>
                <RowLabel
                  title={t('Restore your phone’s settings?')}
                  help={t('From the newest backup of a phone in this account.')}
                />
                <Button
                  kind="secondary"
                  title={t('Restore')}
                  disabled={busy}
                  onPress={() =>
                    void act(async () => {
                      const [latest] = (await account.phoneBackups()).sort((a, b) => b.createdAt - a.createdAt)
                      if (!latest) throw new Error(t('No phone backup yet.'))
                      const saved = await account.readPhoneBackup(latest.slot, latest.version)
                      theme.setAppearance(saved.appearance as Appearance)
                      theme.setTextSize(saved.textSize as TextSize)
                      store.setLanguage(saved.language as typeof store.language)
                      for (const kept of saved.themes) theme.keepTheme(kept)
                      theme.selectTheme(saved.selectedTheme)
                      for (const [key, value] of Object.entries(saved.layout)) store.setDraft(key, value)
                      setStatus(t('Restored the settings of {name}.', { name: latest.name }))
                    })
                  }
                />
              </Row>
            ) : (
              <>
                <Row style={{ paddingVertical: space.m }}>
                  <RowLabel
                    title={t('Approve on another device')}
                    help={t('A host or phone that has your backup key shows the same number; approve there.')}
                  />
                  <Button
                    kind="secondary"
                    title={t('Ask')}
                    disabled={busy}
                    onPress={() =>
                      void act(async () => {
                        await account.requestKey(phoneName(), await random(), (code) =>
                          setStatus(t('Your other device should show {code}.', { code })),
                        )
                        setHasKey(true)
                        setStatus(t('This phone has the backup key now.'))
                      })
                    }
                  />
                </Row>
                <Divider inset={space.l} />
                <TextRow
                  title={t('Recovery code')}
                  help={t('The code you saved when backups were turned on.')}
                  value=""
                  maxLength={80}
                  onCommit={(code) =>
                    void act(async () => {
                      await account.useRecoveryCode(code)
                      setHasKey(true)
                    })
                  }
                />
              </>
            )}
          </Card>
          {requests.length ? (
            <>
              <SectionLabel>{t('New devices asking for your backup key')}</SectionLabel>
              <Card style={{ marginHorizontal: space.l }}>
                {requests.map((request, index) => (
                  <View key={request.id}>
                    {index ? <Divider inset={space.l} /> : null}
                    <Row style={{ paddingVertical: space.m }}>
                      <RowLabel
                        title={request.name}
                        help={
                          request.code
                            ? t('It should show {code}', { code: request.code })
                            : t('Answer to see the number')
                        }
                      />
                      {request.code ? (
                        <Button
                          title={t('Approve')}
                          disabled={busy}
                          onPress={() => void act(async () => account.approveKeyRequest(request.id, await random()))}
                        />
                      ) : (
                        <Button
                          kind="secondary"
                          title={t('Answer')}
                          disabled={busy}
                          onPress={() => void act(async () => account.answerKeyRequest(request.id, await random()))}
                        />
                      )}
                      <Button
                        kind="secondary"
                        title={t('Deny')}
                        disabled={busy}
                        onPress={() => void act(() => account.denyKeyRequest(request.id))}
                      />
                    </Row>
                  </View>
                ))}
              </Card>
            </>
          ) : null}
          <SectionLabel>{t('Your hosts')}</SectionLabel>
          <Card style={{ marginHorizontal: space.l }}>
            {!hosts.length ? (
              <Row style={{ paddingVertical: space.m }}>
                <RowLabel
                  title={t('No listed hosts')}
                  help={t('Turn on List this host in my account in a host’s Settings → Account.')}
                />
              </Row>
            ) : null}
            {hosts.map((host, index) => (
              <View key={host.id}>
                {index ? <Divider inset={space.l} /> : null}
                <Row style={{ paddingVertical: space.m }}>
                  <RowLabel
                    title={host.name}
                    help={
                      host.trust === 'ask'
                        ? t('Last seen {time} · asks before connecting', {
                            time: new Date(host.lastSeen).toLocaleString(),
                          })
                        : t('Last seen {time} · connects without asking', {
                            time: new Date(host.lastSeen).toLocaleString(),
                          })
                    }
                  />
                  <Button
                    kind="secondary"
                    title={host.trust === 'ask' ? t('Pair') : t('Connect')}
                    disabled={busy || store.computers.some((computer) => computer.hostId === host.hostKey)}
                    onPress={() =>
                      void act(async () => {
                        pairing.current?.abort()
                        const controller = new AbortController()
                        pairing.current = controller
                        await store.pairThroughAccount(
                          host.name,
                          host.id,
                          (code) =>
                            setStatus(
                              host.trust === 'ask'
                                ? t('Allow this phone on {name} when it shows {code}.', { name: host.name, code })
                                : t('Connecting to {name}…', { name: host.name }),
                            ),
                          controller.signal,
                        )
                        setStatus(t('Paired with {name}.', { name: host.name }))
                      })
                    }
                  />
                </Row>
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </View>
  )
}
