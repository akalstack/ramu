import { useState } from 'react'
import { HostAddressSheet } from '../components/HostAddressSheet'
import { goBackOrHome } from '../runtime/navigation'
import { Alert, Pressable, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Check, Laptop, Plus, Server } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import { counts, useStore } from '../runtime/store'
import { useT, ago, useSay } from '../i18n'
import { GlassButton, Header, Screen, PageScrollView as ScrollView } from '../components/Screen'
import { Card, ConnectionDot, Divider, Pill, Row, T } from '../components/ui'

export default function Computers() {
  const say = useSay()
  const { c } = useTheme()
  const t = useT()
  const router = useRouter()
  const [editing, setEditing] = useState<string | null>(null)
  const { computers, chats, selected, select, forget, retry } = useStore()
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
                  style={{ paddingVertical: space.m }}
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
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <T weight="600" numberOfLines={1} style={{ flexShrink: 1 }}>
                        {pc.name}
                      </T>
                      <ConnectionDot status={pc.status} />
                      <T size={font.caption} tone="muted">
                        {pc.status === 'online'
                          ? t.online
                          : pc.lastSeen
                            ? `${t[pc.status]} · ${ago(pc.lastSeen)}`
                            : t[pc.status]}
                      </T>
                    </View>
                    <T size={font.caption} tone="muted" mono numberOfLines={1}>
                      {pc.address.replace(/^https?:\/\//, '')}
                    </T>
                    {n.running || n.waiting ? (
                      <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
                        {n.running ? (
                          <Pill tone="accent" wash={c.accentWash}>{`${n.running} ${t.running}`}</Pill>
                        ) : null}
                        {n.waiting ? <Pill tone="warn" wash={c.warnWash}>{`${n.waiting} ${t.waiting}`}</Pill> : null}
                      </View>
                    ) : null}
                  </View>
                  {pc.id === selected ? <Check size={18} color={c.accent} /> : null}
                </Row>
                {pc.deviceId && pc.status === 'offline' && !pc.lastSeen ? (
                  <T tone="muted" size={font.caption} style={{ paddingHorizontal: space.m }}>
                    {t.grantedUnreachable}
                  </T>
                ) : null}
                {pc.error ? (
                  <T tone="bad" size={font.caption} style={{ paddingHorizontal: space.m }}>
                    {pc.error}
                  </T>
                ) : null}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: space.m, gap: space.s }}>
                  <Pressable
                    accessibilityRole="button"
                    style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: space.s }}
                    onPress={() => retry(pc.id)}
                  >
                    <T tone="accent">Reconnect</T>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: space.s }}
                    onPress={() => setEditing(pc.id)}
                  >
                    <T tone="accent">{t.hostChangeAddress}</T>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: space.s }}
                    onPress={() => router.push('/pair')}
                  >
                    <T tone="accent">Pair again</T>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: space.s }}
                    onPress={() =>
                      Alert.alert('Forget host?', `${pc.name}: ${t.forgetHostDraftHint}`, [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Forget',
                          style: 'destructive',
                          onPress: () =>
                            void forget(pc.id).catch((error) =>
                              Alert.alert(t.forgetHostFailed, error instanceof Error ? error.message : String(error)),
                            ),
                        },
                      ])
                    }
                  >
                    <T tone="bad">Forget</T>
                  </Pressable>
                </View>
              </View>
            )
          })}
        </Card>
        <GlassButton icon={Plus} title={t.pair} onPress={() => router.push('/pair')} />
        <T size={font.caption} tone="muted" style={{ textAlign: 'center', lineHeight: 18, paddingHorizontal: space.l }}>
          Agents keep running on each computer. The phone follows them while the app is open.
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
