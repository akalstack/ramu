import { useState } from 'react'
import { HostAddressSheet } from '../../components/HostAddressSheet'
import { Alert, Platform, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import Constants from 'expo-constants'
import { Check, ChevronRight, Plus, RefreshCw } from 'lucide-react-native'
import { font, space, useTheme, type Appearance, type TextSize } from '../../theme'
import { useStore, type Language } from '../../runtime/store'
import { PAGE_PARTS, sectionById, visibleGroups, type SettingsSection } from '../../runtime/settingsModel'
import { useHostSettings } from '../../runtime/useHostSettings'
import { sharedValue } from '@ramu/shared/sharedFields'
import {
  BUSY_MODE_DEVICE_KEY,
  MODEL_WARNING_DEVICE_KEY,
  resolveBusyMode,
  resolveModelChangeWarning,
  type BusyMode,
} from '../../runtime/busyMode'
import {
  PUSH_CATEGORIES,
  PUSH_MUTED_KEY,
  isCategoryOn,
  parseSwitched,
  type PushCategory,
} from '../../runtime/pushCategories'
import { useT, useSay } from '../../i18n'
import { Header, Screen, useScrolledUnderBar, PageScrollView as ScrollView } from '../../components/Screen'
import { PlanUsageReading, PlanUsageSummary } from '../../components/PlanUsage'
import { Button, Card, ConnectionDot, Divider, Row, SectionLabel, Segmented, T } from '../../components/ui'
import { ComputerScope } from '../../components/SettingsChrome'
import { RulesSettings } from '../../components/RulesSettings'
import { AgentSetupSettings, MemoryList } from '../../components/AgentSetupSettings'
import { VoiceSettings } from '../../components/VoiceSettings'
import { ProviderCompatibility } from '../../components/ProviderCompatibility'
import { HostingStatus } from '../../components/HostingStatus'
import { ComputerUseSettings } from '../../components/ComputerUseSettings'
import { ThemeLibrary } from '../../components/ThemeLibrary'
import { Hint, HostGroups, RowLabel, ToggleRow } from '../../components/SettingRows'
import { PermissionNeeded } from '../../components/DevicePermissions'
import { ScopeControl } from '../../components/ScopeControl'
import { PhonePermissions } from '../../components/DevicePermissions'

function AppearancePage() {
  const say = useSay()
  const { appearance, setAppearance, textSize, setTextSize } = useTheme()
  const { language, setLanguage, drafts, setDraft } = useStore()
  const t = useT()
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
      <ScopeControl
        field="appearance"
        overridden={appearance !== 'system'}
        inheritedLabel="System"
        onUseInherited={() => setAppearance('system')}
      />
      <ThemeLibrary />
      <SectionLabel>{t.textSizeLabel}</SectionLabel>
      <Card style={{ marginHorizontal: space.l }}>
        <Segmented<TextSize>
          style={{ margin: space.m }}
          value={textSize}
          onChange={setTextSize}
          options={[
            { key: 'default', label: t.textSizeDefault },
            { key: 'large', label: t.textSizeLarge },
            { key: 'larger', label: t.textSizeLarger },
          ]}
        />
      </Card>
      <Hint>{t.textSizeHint}</Hint>
      <ScopeControl
        field="textSize"
        overridden={textSize !== 'default'}
        inheritedLabel={t.textSizeDefault}
        onUseInherited={() => setTextSize('default')}
      />
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
          title={say('Haptic feedback')}
          help="A light tap when you switch tabs, pick an option or copy text."
          value={drafts.haptics !== 'off'}
          onChange={(on) => setDraft('haptics', on ? '' : 'off')}
        />
      </Card>
      <VoiceSettings />
    </>
  )
}

/**
 * How a message sent while the agent works, and the warning before a model change, behave here: this phone's own choice
 * first, then the setting shared by all your phones on this computer, then the computer's own setting.
 */
function BusyBehavior({ computerId }: { computerId: string }) {
  const router = useRouter()
  const { c } = useTheme()
  const { drafts, setDraft, appPreferences, mobileLayers } = useStore()
  const t = useT()
  const sharedBusy = sharedValue(mobileLayers[computerId], 'queueWhileBusy')
  const sharedWarning = sharedValue(mobileLayers[computerId], 'modelChangeWarning')
  const hostBusy = appPreferences[computerId]?.busyMessageAction
  const hostWarn = appPreferences[computerId]?.warnModelChange
  const resolved = resolveBusyMode(drafts[BUSY_MODE_DEVICE_KEY], sharedBusy, hostBusy)
  const inheritedBusy = resolveBusyMode(undefined, sharedBusy, hostBusy)
  const warning = resolveModelChangeWarning(drafts[MODEL_WARNING_DEVICE_KEY], sharedWarning, hostWarn)
  const inheritedWarning = resolveModelChangeWarning(undefined, sharedWarning, hostWarn)
  return (
    <>
      <SectionLabel>{t.busyOnPhone}</SectionLabel>
      <Card style={{ marginHorizontal: space.l }}>
        <Segmented<BusyMode>
          style={{ margin: space.m }}
          value={resolved.mode}
          onChange={(mode) => setDraft(BUSY_MODE_DEVICE_KEY, mode)}
          options={[
            { key: 'steer', label: t.steer },
            { key: 'queue', label: t.queue },
          ]}
        />
      </Card>
      <Hint>{t.busyHint}</Hint>
      {resolved.source === 'device' ? (
        <Button
          kind="ghost"
          title={`${t.scopeUseInherited} · ${inheritedBusy.mode === 'queue' ? t.queue : t.steer}`}
          onPress={() => setDraft(BUSY_MODE_DEVICE_KEY, '')}
        />
      ) : null}
      <SectionLabel>{t.modelWarnOnPhone}</SectionLabel>
      <Card style={{ marginHorizontal: space.l }}>
        <Segmented<'on' | 'off'>
          style={{ margin: space.m }}
          value={warning.warn ? 'on' : 'off'}
          onChange={(value) => setDraft(MODEL_WARNING_DEVICE_KEY, value)}
          options={[
            { key: 'on', label: t.modelWarnOn },
            { key: 'off', label: t.modelWarnOff },
          ]}
        />
      </Card>
      <Hint>{t.modelWarnHint}</Hint>
      {warning.source === 'device' ? (
        <Button
          kind="ghost"
          title={`${t.scopeUseInherited} · ${inheritedWarning.warn ? t.modelWarnOn : t.modelWarnOff}`}
          onPress={() => setDraft(MODEL_WARNING_DEVICE_KEY, '')}
        />
      ) : null}
      <Card style={{ marginHorizontal: space.l }}>
        <Row
          accessibilityRole="button"
          onPress={() => router.dismissTo({ pathname: '/', params: { filter: 'archived' } })}
        >
          <T style={{ flex: 1 }}>{t.homeArchived}</T>
          <ChevronRight size={16} color={c.muted} />
        </Row>
      </Card>
    </>
  )
}

function Notifications({ host, name }: { host: ReturnType<typeof useHostSettings>; name?: string }) {
  const say = useSay()
  const { drafts, setDraft, enablePush, disablePush, setPushCategory } = useStore()
  const t = useT()
  const pushOn = drafts['push-enabled'] === 'yes'
  const labels: Record<PushCategory, [string, string]> = {
    input: [t.alertInput, t.alertInputHelp],
    failed: [t.alertFailed, t.alertFailedHelp],
    done: [t.alertDone, t.alertDoneHelp],
    scheduled: [t.alertScheduled, t.alertScheduledHelp],
    digest: [t.alertDigest, t.alertDigestHelp],
  }
  return (
    <>
      <SectionLabel>This phone</SectionLabel>
      <Card style={{ marginHorizontal: space.l }}>
        <ToggleRow
          title={say('Background alerts')}
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
              title={say('Live Activities')}
              help="Track ongoing work on your Lock Screen and Dynamic Island."
              value={drafts['live-activities-enabled'] !== 'no'}
              onChange={(on) => setDraft('live-activities-enabled', on ? 'yes' : 'no')}
            />
          </>
        ) : null}
      </Card>
      {pushOn ? (
        <>
          <SectionLabel>{t.alertsWhen}</SectionLabel>
          <Card style={{ marginHorizontal: space.l }}>
            {PUSH_CATEGORIES.map((category, index) => (
              <View key={category}>
                {index ? <Divider inset={space.l} /> : null}
                <ToggleRow
                  title={labels[category][0]}
                  help={labels[category][1]}
                  value={isCategoryOn(drafts[PUSH_MUTED_KEY], category)}
                  onChange={(on) => setPushCategory(category, on)}
                />
              </View>
            ))}
          </Card>
          <Hint>{t.alertsNeedHost}</Hint>
          <ScopeControl
            field="notifyCompletion"
            overridden={parseSwitched(drafts[PUSH_MUTED_KEY]).length > 0}
            inheritedLabel={t.alertsDefaults}
            onUseInherited={() => {
              // Back to each alert's own default; permission and registration are untouched.
              for (const category of parseSwitched(drafts[PUSH_MUTED_KEY]))
                setPushCategory(category, !isCategoryOn(drafts[PUSH_MUTED_KEY], category))
            }}
          />
          <Hint>{t.alertsPermissionSeparate}</Hint>
        </>
      ) : null}
      <HostGroups section="notifications" host={host} name={name} />
      <Hint>Alerts only reach you if “Background alerts” is on and this computer is paired.</Hint>
    </>
  )
}

function Computers() {
  const say = useSay()
  const router = useRouter()
  const { c } = useTheme()
  const { computers, selected, select, retry } = useStore()
  const t = useT()
  const [addressOpen, setAddressOpen] = useState(false)
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
          <PhonePermissions computerId={pc.id} />
          <SectionLabel>Connection</SectionLabel>
          <Card style={{ marginHorizontal: space.l }}>
            <Row style={{ paddingVertical: space.m }} onPress={() => retry(pc.id)}>
              <RowLabel title={say('Reconnect')} help={pc.error ?? 'Refresh the connection to this host.'} />
              <RefreshCw size={16} color={c.muted} />
            </Row>
            <Divider inset={space.l} />
            <Row onPress={() => setAddressOpen(true)}>
              <RowLabel title={t.hostChangeAddress} help={pc.address} />
              <ChevronRight size={16} color={c.muted} />
            </Row>
            <Divider inset={space.l} />
            <Row onPress={() => router.push('/computers')}>
              <T style={{ flex: 1 }}>Manage computers</T>
            </Row>
          </Card>
          {addressOpen ? <HostAddressSheet key={pc.id} computer={pc} onClose={() => setAddressOpen(false)} /> : null}
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
      <PlanUsageSummary hostIds={[computer]} />
      <Card style={{ marginHorizontal: space.l }}>
        {readings.length ? (
          readings.map((r, i) => (
            <View key={`${r.provider}:${r.accountId ?? 'default'}:${r.window}:${r.scope ?? ''}`}>
              {i ? <Divider inset={space.m} /> : null}
              <PlanUsageReading reading={r} />
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
  browser: 'Browser profiles, imports and downloads are managed in Ramu on the host.',
  providers:
    'Model sets, provider executable paths, sign-in, permission rules and the fallback order are managed in Ramu on the host.',
  workflows:
    'Sub-agent routing, the advisor, and the memory and skills library with its model choices are set up in Ramu on the host.',
  git: 'The commit message model is chosen in Ramu on the host.',
}

export default function SettingsSectionPage() {
  const edge = useScrolledUnderBar()
  const { section: param } = useLocalSearchParams<{ section: string }>()
  const section = sectionById(String(param))
  const { computers, selected, language, mayUse } = useStore()
  const host = useHostSettings(selected)
  // Without the host's Change settings permission the rows read only, with a request instead of saves it would refuse.
  const locked = !mayUse(selected, 'settings')
  const name = computers.find((computer) => computer.id === selected)?.name
  if (!section) return null
  const id = section.id
  const note = desktopOnly[id]
  const readySettings = host.state.status === 'ready' ? host.state.settings : []
  return (
    <Screen bg="window">
      <Header align="center" title={section.label[language]} scrollEdge scrolled={edge.scrolled} />
      <ScrollView
        onScroll={edge.onScroll}
        scrollEventThrottle={16}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: space.xl * 2 }}
      >
        {section.scope === 'host' ? <ComputerScope host={host} /> : null}
        {section.scope === 'host' && locked && computers.find((c) => c.id === selected)?.access !== 'viewer' ? (
          <View style={{ paddingHorizontal: space.l, paddingBottom: space.m }}>
            <PermissionNeeded computerId={selected} permission="settings" />
          </View>
        ) : null}
        {id === 'appearance' ? <AppearancePage /> : null}
        {id === 'notifications' ? <Notifications host={host} name={name} /> : null}
        {id === 'computers' ? <Computers /> : null}
        {id === 'about' ? <About /> : null}
        {id === 'providers' ? <ProviderCompatibility key={selected} hostId={selected} /> : null}
        {id === 'providers' ? <Usage computer={selected} /> : null}
        {id === 'chats' ? <BusyBehavior key={selected} computerId={selected} /> : null}
        {id === 'computer' ? <ComputerUseSettings key={selected} hostId={selected} /> : null}
        {id === 'git' ? <HostingStatus key={selected} hostId={selected} /> : null}
        {id === 'rules' ? <RulesSettings key={selected} hostId={selected} /> : null}
        {id === 'setup' ? <AgentSetupSettings key={selected} hostId={selected} /> : null}
        {section.scope === 'host' && id !== 'computer' ? (
          <HostGroups section={id} host={host} name={name} locked={locked} />
        ) : null}
        {section.scope === 'host' && host.state.status === 'ready'
          ? (PAGE_PARTS[id] ?? [])
              // A part this host has nothing for is left out rather than announced in the middle of the page.
              .filter((part) => visibleGroups(part, readySettings, host.read).length > 0)
              .map((part) => <HostGroups key={part} section={part} host={host} name={name} locked={locked} />)
          : null}
        {id === 'workflows' ? <MemoryList key={selected} hostId={selected} /> : null}
        {note ? <Hint>{note}</Hint> : null}
      </ScrollView>
    </Screen>
  )
}
