import { Alert, Platform, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import Constants from 'expo-constants'
import { Check, Plus, RefreshCw } from 'lucide-react-native'
import type { UsageReading } from '@ramu/shared/types'
import { font, space, useTheme, type Appearance } from '../../theme'
import { useStore, type Language } from '../../runtime/store'
import { providerNames } from '../../runtime/types'
import { sectionById, type SettingsSection } from '../../runtime/settingsModel'
import { useHostSettings } from '../../runtime/useHostSettings'
import { ago, until } from '../../i18n'
import { Header, Screen, PageScrollView as ScrollView } from '../../components/Screen'
import { ProviderIcon } from '../../components/Logos'
import { Card, ConnectionDot, Divider, Row, SectionLabel, Segmented, T } from '../../components/ui'
import { ComputerScope } from '../../components/SettingsChrome'
import { Hint, HostGroups, RowLabel, ToggleRow } from '../../components/SettingRows'

const windowName: Record<UsageReading['window'], string> = {
  five_hour: '5-hour',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quota: 'Quota',
}

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

function AppearancePage() {
  const { appearance, setAppearance } = useTheme()
  const { language, setLanguage, drafts, setDraft } = useStore()
  return (
    <>
      <SectionLabel>Theme</SectionLabel>
      <Card style={{ marginHorizontal: space.l }}>
        <Segmented<Appearance>
          style={{ margin: space.m }}
          value={appearance}
          onChange={setAppearance}
          options={[
            { key: 'system', label: 'System' },
            { key: 'light', label: 'Light' },
            { key: 'dark', label: 'Dark' },
          ]}
        />
      </Card>
      <SectionLabel>Language</SectionLabel>
      <Card style={{ marginHorizontal: space.l }}>
        <Segmented<Language>
          style={{ margin: space.m }}
          value={language}
          onChange={setLanguage}
          options={[
            { key: 'en', label: 'English' },
            { key: 'id', label: 'Bahasa Indonesia' },
          ]}
        />
      </Card>
      <Hint>Only changes this phone. Each computer keeps its own language.</Hint>
      <SectionLabel>Feedback</SectionLabel>
      <Card style={{ marginHorizontal: space.l }}>
        <ToggleRow
          title="Haptic feedback"
          help="A light tap when you switch tabs, pick an option or copy text."
          value={drafts.haptics !== 'off'}
          onChange={(on) => setDraft('haptics', on ? '' : 'off')}
        />
      </Card>
    </>
  )
}

function Notifications({ host, name }: { host: ReturnType<typeof useHostSettings>; name?: string }) {
  const { drafts, setDraft, enablePush, disablePush } = useStore()
  const pushOn = drafts['push-enabled'] === 'yes'
  return (
    <>
      <SectionLabel>This phone</SectionLabel>
      <Card style={{ marginHorizontal: space.l }}>
        <ToggleRow
          title="Background alerts"
          help="Get alerts from your paired hosts when a task needs your attention."
          value={pushOn}
          onChange={(on) => {
            void (on ? enablePush() : disablePush()).catch((e) => Alert.alert('Notifications', e.message))
          }}
        />
        {Platform.OS === 'ios' ? (
          <>
            <Divider inset={space.l} />
            <ToggleRow
              title="Live Activities"
              help="Track ongoing work on your Lock Screen and Dynamic Island."
              value={drafts['live-activities-enabled'] !== 'no'}
              onChange={(on) => setDraft('live-activities-enabled', on ? 'yes' : 'no')}
            />
          </>
        ) : null}
      </Card>
      <HostGroups section="notifications" host={host} name={name} />
      <Hint>Alerts only reach you if “Background alerts” is on and this computer is paired.</Hint>
    </>
  )
}

function Computers() {
  const router = useRouter()
  const { c } = useTheme()
  const { computers, selected, select, retry } = useStore()
  const pc = computers.find((computer) => computer.id === selected)
  return (
    <>
      <SectionLabel>Paired computers</SectionLabel>
      <Card style={{ marginHorizontal: space.l }}>
        {computers.map((computer, index) => (
          <View key={computer.id}>
            {index ? <Divider inset={space.l} /> : null}
            <Row
              accessibilityRole="radio"
              accessibilityState={{ selected: computer.id === selected }}
              onPress={() => select(computer.id)}
            >
              <T style={{ flex: 1 }}>{computer.name}</T>
              <ConnectionDot status={computer.status} />
              {computer.id === selected ? <Check size={17} color={c.primary} /> : null}
            </Row>
          </View>
        ))}
        {computers.length ? <Divider inset={space.l} /> : null}
        <Row onPress={() => router.push('/pair')}>
          <Plus size={17} color={c.primary} />
          <T tone="accent">Pair a computer</T>
        </Row>
      </Card>
      <Hint>Settings and new threads go to the checked computer.</Hint>
      {pc ? (
        <>
          <SectionLabel>Connection</SectionLabel>
          <Card style={{ marginHorizontal: space.l }}>
            <Row style={{ paddingVertical: space.m }} onPress={() => retry(pc.id)}>
              <RowLabel title="Reconnect" help={pc.error ?? 'Refresh the connection to this host.'} />
              <RefreshCw size={16} color={c.muted} />
            </Row>
            <Divider inset={space.l} />
            <Row onPress={() => router.push('/computers')}>
              <T style={{ flex: 1 }}>Manage computers</T>
            </Row>
          </Card>
        </>
      ) : null}
    </>
  )
}

function About() {
  return (
    <>
      <SectionLabel>Ramu</SectionLabel>
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
    </>
  )
}

function Usage({ computer }: { computer: string }) {
  const { usage } = useStore()
  const readings = usage[computer] ?? []
  return (
    <>
      <SectionLabel>Plan usage</SectionLabel>
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
    </>
  )
}

/** What the desktop edits that the phone leaves to it, so a missing row is explained rather than puzzling. */
const desktopOnly: Partial<Record<SettingsSection, string>> = {
  providers: 'Model sets, provider binaries and sign-in are managed in Ramu on the host.',
  access: 'Permission rules and the provider fallback order are edited in Ramu on the host.',
  workflows: 'Sub-agent routing and the advisor are set up in Ramu on the host.',
  memory: 'The memory and skills library, and its model choices, are managed in Ramu on the host.',
  git: 'The commit message model is chosen in Ramu on the host.',
}

export default function SettingsSectionPage() {
  const { section: param } = useLocalSearchParams<{ section: string }>()
  const section = sectionById(String(param))
  const { computers, selected, language } = useStore()
  const host = useHostSettings(selected)
  const name = computers.find((computer) => computer.id === selected)?.name
  if (!section) return null
  const id = section.id
  const note = desktopOnly[id]
  return (
    <Screen bg="window">
      <Header title={section.label[language]} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: space.xl * 2 }}>
        {section.scope === 'host' ? <ComputerScope host={host} /> : null}
        {id === 'appearance' ? <AppearancePage /> : null}
        {id === 'notifications' ? <Notifications host={host} name={name} /> : null}
        {id === 'computers' ? <Computers /> : null}
        {id === 'about' ? <About /> : null}
        {id === 'providers' ? <Usage computer={selected} /> : null}
        {section.scope === 'host' ? <HostGroups section={id} host={host} name={name} /> : null}
        {note ? <Hint>{note}</Hint> : null}
      </ScrollView>
    </Screen>
  )
}
