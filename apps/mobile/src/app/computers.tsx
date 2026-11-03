import { useState } from 'react'
import { HostAddressSheet } from '../components/HostAddressSheet'
import { HostUpdates } from '../components/HostUpdates'
import { goBackOrHome } from '../runtime/navigation'
import { Alert, Pressable, Switch, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Check, Laptop, Plus, Server } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import { counts, useStore } from '../runtime/store'
import { useT, ago, useSay } from '../i18n'
import { GlassButton, Header, Screen, PageScrollView as ScrollView } from '../components/Screen'
import { Card, ConnectionDot, Divider, Pill, Row, T } from '../components/ui'

/** Where a host's text starts: the row's padding, the icon tile and the gap after it. */
const TEXT_INSET = space.m + 34 + space.m

/** A small tonal action under a host; several fit on one line. */
function Action({ label, onPress, tone = 'accent' }: { label: string; onPress: () => void; tone?: 'accent' | 'bad' }) {
  const { c } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 30,
        justifyContent: 'center',
        paddingHorizontal: space.s + 2,
        borderRadius: radius.full,
        backgroundColor: pressed ? c.pressed : c.fill,
      })}
    >
      <T size={font.control} weight="500" tone={tone}>
        {label}
      </T>
    </Pressable>
  )
}

export default function Computers() {
  const say = useSay()
  const { c } = useTheme()
  const t = useT()
  const router = useRouter()
  const [editing, setEditing] = useState<string | null>(null)
  const { computers, chats, selected, select, forget, retry, setConnected } = useStore()
  return (
    <Screen bg="canvas">
      <Header modal title={t.computers} subtitle={say('Every paired host stays connected')} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space.l, gap: space.l }}>
        <Card>
          {computers.map((pc, i) => {
            const n = counts(chats, pc.id)
            const I = pc.os === 'linux' ? Server : Laptop
            return (
              <View key={pc.id}>
                {i ? <Divider inset={60} /> : null}
                <Row
                  onPress={() => {
                    select(pc.id)
                    goBackOrHome(router)
                  }}
                  style={{ paddingTop: space.m, paddingBottom: space.s }}
                >
                  <View
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: radius.s + 2,
                      backgroundColor: c.fill,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <I size={17} color={c.soft} strokeWidth={1.8} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <T weight="600" numberOfLines={1} style={{ flexShrink: 1 }}>
                        {pc.name}
                      </T>
                      {pc.id === selected ? <Check size={15} color={c.accent} strokeWidth={2.4} /> : null}
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <ConnectionDot status={pc.status} />
                      <T size={font.caption} tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                        {[
                          pc.status === 'online'
                            ? t.online
                            : pc.lastSeen
                              ? `${t[pc.status]} · ${ago(pc.lastSeen)}`
                              : t[pc.status],
                          pc.address.replace(/^https?:\/\//, ''),
                        ].join(' · ')}
                      </T>
                    </View>
                    {n.running || n.waiting ? (
                      <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
                        {n.running ? (
                          <Pill tone="accent" wash={c.accentWash}>{`${n.running} ${t.running}`}</Pill>
                        ) : null}
                        {n.waiting ? <Pill tone="warn" wash={c.warnWash}>{`${n.waiting} ${t.waiting}`}</Pill> : null}
                      </View>
                    ) : null}
                  </View>
                  {pc.status !== 'revoked' ? (
                    <Switch
                      accessibilityLabel={`${t.keepConnected}: ${pc.name}`}
                      value={pc.status !== 'paused'}
                      onValueChange={(on) => void setConnected(pc.id, on)}
                    />
                  ) : null}
                </Row>
                <View style={{ paddingLeft: TEXT_INSET, paddingRight: space.m, paddingBottom: space.m, gap: space.s }}>
                  {pc.deviceId && pc.status === 'offline' && !pc.lastSeen ? (
                    <T tone="muted" size={font.caption}>
                      {t.grantedUnreachable}
                    </T>
                  ) : null}
                  {pc.error ? (
                    <T tone="bad" size={font.caption}>
                      {pc.error}
                    </T>
                  ) : null}
                  {pc.status === 'online' ? <HostUpdates hostId={pc.id} name={pc.name} running={n.running} /> : null}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
                    {pc.status !== 'online' && pc.status !== 'paused' ? (
                      <Action label={say('Reconnect')} onPress={() => retry(pc.id)} />
                    ) : null}
                    <Action label={say('Switch network')} onPress={() => setEditing(pc.id)} />
                    {pc.status === 'revoked' || pc.error ? (
                      <Action label={say('Pair again')} onPress={() => router.push('/pair')} />
                    ) : null}
                    <Action
                      label={say('Forget')}
                      tone="bad"
                      onPress={() =>
                        Alert.alert(say('Forget {0}?', { 0: pc.name }), t.forgetHostDraftHint, [
                          { text: say('Cancel'), style: 'cancel' },
                          {
                            text: say('Forget'),
                            style: 'destructive',
                            onPress: () =>
                              void forget(pc.id).catch((error) =>
                                Alert.alert(t.forgetHostFailed, error instanceof Error ? error.message : String(error)),
                              ),
                          },
                        ])
                      }
                    />
                  </View>
                </View>
              </View>
            )
          })}
        </Card>
        <GlassButton icon={Plus} title={t.pair} onPress={() => router.push('/pair')} />
        <T size={font.caption} tone="muted" style={{ textAlign: 'center', lineHeight: 18, paddingHorizontal: space.l }}>
          {say('Agents keep running on each computer. The phone follows them while the app is open.')}
        </T>
      </ScrollView>
      {editing && computers.find((pc) => pc.id === editing) ? (
        <HostAddressSheet
          key={editing}
          computer={computers.find((pc) => pc.id === editing)!}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Screen>
  )
}
