import { Alert, Pressable, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Check, Laptop, Plus, Server } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import { counts, useStore } from '../runtime/store'
import { useT, ago } from '../i18n'
import { GlassButton, Header, Screen, PageScrollView as ScrollView } from '../components/Screen'
import { Card, ConnectionDot, Divider, Pill, Row, T } from '../components/ui'

export default function Computers() {
  const { c } = useTheme()
  const t = useT()
  const router = useRouter()
  const { computers, chats, selected, select, forget, retry } = useStore()
  return (
    <Screen bg="canvas">
      <Header modal title={t.computers} subtitle="Every paired computer stays connected" />
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
                    router.back()
                  }}
                  style={{ paddingVertical: space.m }}
                >
                  <View style={{ width: 34, height: 34, borderRadius: radius.s + 2, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' }}>
                    <I size={17} color={c.soft} strokeWidth={1.8} />
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <T weight="600">{pc.name}</T>
                      <ConnectionDot status={pc.status} />
                      <T size={font.caption} tone="muted">
                        {pc.status === 'online' ? t.online : pc.lastSeen ? `${t[pc.status]} · ${ago(pc.lastSeen)}` : t[pc.status]}
                      </T>
                    </View>
                    <T size={font.caption} tone="muted" mono numberOfLines={1}>
                      {pc.address.replace(/^https?:\/\//, '')}
                    </T>
                    {n.running || n.waiting ? (
                      <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
                        {n.running ? <Pill tone="accent" wash={c.accentWash}>{`${n.running} ${t.running}`}</Pill> : null}
                        {n.waiting ? <Pill tone="warn" wash={c.warnWash}>{`${n.waiting} ${t.waiting}`}</Pill> : null}
                      </View>
                    ) : null}
                  </View>
                  {pc.id === selected ? <Check size={18} color={c.accent} /> : null}
                </Row>
                {pc.error ? <T tone="bad" size={font.caption} style={{ paddingHorizontal: space.m }}>{pc.error}</T> : null}
                <View style={{ flexDirection: 'row', padding: space.m, gap: space.l }}><Pressable onPress={() => retry(pc.id)}><T tone="accent">Reconnect</T></Pressable><Pressable onPress={() => router.push('/pair')}><T tone="accent">Pair again</T></Pressable><Pressable onPress={() => Alert.alert('Forget computer?', `${pc.name}: removes phone credentials, drafts and outbox. Agents keep running. Revoke the old device on this computer to invalidate its token.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Forget', style: 'destructive', onPress: () => void forget(pc.id) }])}><T tone="bad">Forget</T></Pressable></View>
              </View>
            )
          })}
        </Card>
        <GlassButton icon={Plus} title={t.pair} onPress={() => router.push('/pair')} />
        <T size={font.caption} tone="muted" style={{ textAlign: 'center', lineHeight: 18, paddingHorizontal: space.l }}>
          Agents keep running on each computer. The phone follows them while the app is open.
        </T>
      </ScrollView>
    </Screen>
  )
}
