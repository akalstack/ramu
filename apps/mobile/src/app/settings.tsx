import { Alert, Platform, Pressable, Switch, View } from 'react-native'
import { useRouter } from 'expo-router'
import Constants from 'expo-constants'
import { ChevronRight, Monitor } from 'lucide-react-native'
import type { UsageReading } from '@ramu/shared/types'
import { font, radius, space, useTheme, type Appearance } from '../theme'
import { useStore, type Language } from '../runtime/store'
import { providerNames } from '../runtime/types'
import { useT, ago, until } from '../i18n'
import { Header, Screen, PageScrollView as ScrollView } from '../components/Screen'
import { ProviderIcon } from '../components/Logos'
import { Card, ConnectionDot, Divider, Row, SectionLabel, T, tap } from '../components/ui'

function Segmented<V extends string>({
  value,
  options,
  onChange,
}: {
  value: V
  options: [V, string][]
  onChange: (v: V) => void
}) {
  const { c } = useTheme()
  return (
    <View
      style={{ flexDirection: 'row', backgroundColor: c.fill, borderRadius: radius.s + 2, padding: 3, margin: space.m }}
    >
      {options.map(([v, label]) => (
        <Pressable
          key={v}
          onPress={() => {
            tap()
            onChange(v)
          }}
          style={{
            flex: 1,
            alignItems: 'center',
            paddingVertical: 8,
            borderRadius: radius.s,
            backgroundColor: v === value ? c.raised : 'transparent',
          }}
        >
          <T size={font.control} weight={v === value ? '600' : '400'} tone={v === value ? 'text' : 'muted'}>
            {label}
          </T>
        </Pressable>
      ))}
    </View>
  )
}

const windowName: Record<UsageReading['window'], string> = { five_hour: '5-hour', weekly: 'Weekly', monthly: 'Monthly' }

function UsageBar({ r }: { r: UsageReading }) {
  const { c } = useTheme()
  const color = r.status === 'limited' ? c.bad : r.status === 'warning' ? c.warn : c.primary
  return (
    <View style={{ paddingHorizontal: space.m, paddingVertical: space.m, gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <ProviderIcon provider={r.provider} size={15} />
        <T size={font.body - 1} weight="500">
          {providerNames[r.provider]}
        </T>
        <T size={font.caption} tone="muted" style={{ flex: 1 }}>
          {windowName[r.window]}
          {r.plan ? ` · ${r.plan}` : ''}
        </T>
        <T
          size={font.control}
          weight="600"
          tone={r.status === 'limited' ? 'bad' : r.status === 'warning' ? 'warn' : 'soft'}
        >
          {r.usedPercent}%
        </T>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: c.fill, overflow: 'hidden' }}>
        <View style={{ width: `${r.usedPercent}%`, height: '100%', borderRadius: 3, backgroundColor: color }} />
      </View>
      <T size={font.caption} tone="muted">
        {r.resetsAt ? `Resets in ${until(r.resetsAt)}` : 'No reset time reported'} · updated {ago(r.updatedAt)} ago
      </T>
    </View>
  )
}

export default function Settings() {
  const { c, appearance, setAppearance } = useTheme()
  const t = useT()
  const router = useRouter()
  const { computers, selected, language, setLanguage, usage, retry, enablePush, disablePush, drafts, setDraft } =
    useStore()
  const pc = computers.find((x) => x.id === selected)
  const readings = usage[selected] ?? []
  return (
    <Screen bg="window">
      <Header modal title={t.settings} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: space.xl * 2 }}>
        <SectionLabel>{t.computers}</SectionLabel>
        <Card style={{ marginHorizontal: space.l }}>
          <Row onPress={() => router.push('/computers')}>
            <Monitor size={17} color={c.soft} />
            <T style={{ flex: 1 }}>{pc?.name}</T>
            {pc ? <ConnectionDot status={pc.status} /> : null}
            <T size={font.control} tone="muted">
              {computers.length} paired
            </T>
            <ChevronRight size={16} color={c.muted} />
          </Row>
        </Card>

        <SectionLabel
          right={
            <T size={font.caption} tone="muted">
              {pc?.name}
            </T>
          }
        >
          {t.usage}
        </SectionLabel>
        <Card style={{ marginHorizontal: space.l }}>
          {readings.length ? (
            readings.map((r, i) => (
              <View key={`${r.provider}-${r.window}`}>
                {i ? <Divider inset={space.m} /> : null}
                <UsageBar r={r} />
              </View>
            ))
          ) : (
            <T size={font.control} tone="muted" style={{ padding: space.m }}>
              Unavailable — this computer has not reported usage.
            </T>
          )}
        </Card>

        <SectionLabel>Chat</SectionLabel>
        <Card style={{ marginHorizontal: space.l }}>
          <Row
            style={{ paddingVertical: space.l }}
            onPress={() => setDraft('pref:model-warning', drafts['pref:model-warning'] === 'off' ? '' : 'off')}
          >
            <View style={{ flex: 1, gap: 6 }}>
              <T weight="500" style={{ lineHeight: 22 }}>
                Warn before changing model
              </T>
              <T size={font.caption} tone="muted" style={{ lineHeight: 19 }}>
                A new model can't reuse the cache of a conversation in progress, so the first message after switching
                costs more usage.
              </T>
            </View>
            <Switch
              value={drafts['pref:model-warning'] !== 'off'}
              onValueChange={(on) => setDraft('pref:model-warning', on ? '' : 'off')}
            />
          </Row>
        </Card>

        <SectionLabel>Notifications</SectionLabel>
        <Card style={{ marginHorizontal: space.l }}>
          <Row
            style={{ paddingVertical: space.l }}
            onPress={() => {
              void (drafts['push-enabled'] === 'yes' ? disablePush() : enablePush()).catch((e) =>
                Alert.alert('Notifications', e.message),
              )
            }}
          >
            <View style={{ flex: 1, gap: 6 }}>
              <T weight="500" style={{ lineHeight: 22 }}>
                {drafts['push-enabled'] === 'yes' ? 'Disable background alerts' : 'Enable background alerts'}
              </T>
              <T size={font.caption} tone="muted" style={{ lineHeight: 19 }}>
                Get alerts from your paired computers when a task needs your attention.
              </T>
            </View>
          </Row>
        </Card>
        {Platform.OS === 'ios' ? (
          <>
            <SectionLabel>Live Activities</SectionLabel>
            <Card style={{ marginHorizontal: space.l }}>
              <Row style={{ paddingVertical: space.l }}>
                <View style={{ flex: 1, gap: 6 }}>
                  <T weight="500" style={{ lineHeight: 22 }}>
                    Show ongoing work
                  </T>
                  <T size={font.caption} tone="muted" style={{ lineHeight: 19 }}>
                    Track tasks on your Lock Screen and Dynamic Island.
                  </T>
                </View>
                <Switch
                  accessibilityLabel="Show ongoing work in Live Activities"
                  value={drafts['live-activities-enabled'] !== 'no'}
                  onValueChange={(value) => setDraft('live-activities-enabled', value ? 'yes' : 'no')}
                  trackColor={{ true: c.primary }}
                />
              </Row>
            </Card>
          </>
        ) : null}
        <SectionLabel>{t.appearance}</SectionLabel>
        <Card style={{ marginHorizontal: space.l }}>
          <Segmented<Appearance>
            value={appearance}
            onChange={setAppearance}
            options={[
              ['system', 'System'],
              ['light', 'Light'],
              ['dark', 'Dark'],
            ]}
          />
        </Card>

        <SectionLabel>{t.language}</SectionLabel>
        <Card style={{ marginHorizontal: space.l }}>
          <Segmented<Language>
            value={language}
            onChange={setLanguage}
            options={[
              ['en', 'English'],
              ['id', 'Bahasa Indonesia'],
            ]}
          />
        </Card>

        <SectionLabel>Connection</SectionLabel>
        <Card style={{ marginHorizontal: space.l }}>
          <Row style={{ paddingVertical: space.l }} onPress={() => pc && retry(pc.id)}>
            <View style={{ flex: 1, gap: 6 }}>
              <T weight="500" style={{ lineHeight: 22 }}>
                Reconnect
              </T>
              <T size={font.caption} tone="muted" style={{ lineHeight: 19 }}>
                {pc?.error ?? 'Refresh the connection to this computer.'}
              </T>
            </View>
          </Row>
        </Card>

        <SectionLabel>{t.about}</SectionLabel>
        <Card style={{ marginHorizontal: space.l }}>
          <Row>
            <T style={{ flex: 1 }}>Version</T>
            <T tone="muted">{Constants.expoConfig?.version ?? '0.1.0'} · alpha</T>
          </Row>
          <Divider inset={space.l} />
          <Row>
            <T style={{ flex: 1 }}>Data</T>
            <T tone="muted">Live workspace</T>
          </Row>
        </Card>
      </ScrollView>
    </Screen>
  )
}
