import { useState } from 'react'
import { PluginSettings } from '../../components/PluginSettings'
import { AccountSettings } from '../../components/AccountSettings'
import { IdentitySettings } from '../../components/IdentitySettings'
import { AbilitySummary } from '../../components/AbilitySummary'
import { HostAddressSheet } from '../../components/HostAddressSheet'
import { hostOfUrl, networkName } from '@ramu/shared/networkLabel'
import { Alert, Platform, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import Constants from 'expo-constants'
import { Check, ChevronRight, Plus, RefreshCw } from 'lucide-react-native'
import { font, space, useTheme, type Appearance, type TextSize } from '../../theme'
import { useStore, type Language } from '../../runtime/store'
import { sectionById, type SettingsSection } from '../../runtime/settingsModel'
import { THREAD_LIST_KEY, readThreadList, type ThreadListMode } from '../../runtime/threadGroups'
import { useHostSettings } from '../../runtime/useHostSettings'
import { translate } from '@ramu/shared/i18n'
import {
  BUSY_MODE_DEVICE_KEY,
  MODEL_WARNING_DEVICE_KEY,
  readBusyMode,
  readModelWarning,
  type BusyMode,
  type ModelWarning,
} from '../../runtime/busyMode'
import { useScopedChoice } from '../../runtime/useScopedChoice'
import { ScopedChoiceRow } from '../../components/ScopedChoiceRow'
import {
  PUSH_CATEGORIES,
  PUSH_MUTED_KEY,
  isCategoryOn,
  parseSwitched,
  type PushCategory,
} from '../../runtime/pushCategories'
import { useT, useSay } from '../../i18n'
import { accountName } from '@ramu/shared/providers/providers'
import { useAccountLogins } from '../../runtime/useAccountLogins'
import { Screen, useScrolledUnderBar } from '../../components/Screen'
import { SettingScroll } from '../../components/SettingHighlight'
import { PlanUsageReading, PlanUsageSummary } from '../../components/PlanUsage'
import { Card, ConnectionDot, Divider, Row, SectionLabel, Segmented, T } from '../../components/ui'
import { SettingsHeader } from '../../components/SettingsChrome'
import { RulesSettings } from '../../components/RulesSettings'
import { AgentSetupSettings, MemoryList } from '../../components/AgentSetupSettings'
import { VoiceSettings } from '../../components/VoiceSettings'
import { ProviderCompatibility } from '../../components/ProviderCompatibility'
import { HostingStatus } from '../../components/HostingStatus'
import { MediaStatus } from '../../components/MediaStatus'
import { ComputerUseSettings, TestDeviceSettings } from '../../components/ComputerUseSettings'
import { ThemeLibrary } from '../../components/ThemeLibrary'
import { Hint, HostGroups, RowLabel, ToggleRow } from '../../components/SettingRows'
import { PermissionNeeded } from '../../components/DevicePermissions'
import { SavedApprovals } from '../../components/SavedApprovals'
import { LearningReviews } from '../../components/LearningReviews'
import { ManagedSkills } from '../../components/ManagedSkills'
import { BrowserDefaultProfile } from '../../components/BrowserDefaultProfile'
import { ScopeControl } from '../../components/ScopeControl'
import { PhonePermissions } from '../../components/DevicePermissions'

function AppearancePage() {
  const say = useSay()
  const { appearance, setAppearance, textSize, setTextSize } = useTheme()
  const { language, setLanguage, drafts, setDraft } = useStore()
  const t = useT()
  return (
    <>
      <SectionLabel>{say('Theme')}</SectionLabel>
      <Card style={{ marginHorizontal: space.l }}>
        <Segmented<Appearance>
          style={{ margin: space.m }}
          value={appearance}
          onChange={setAppearance}
          options={[
            { key: 'system', label: say('System') },
            { key: 'light', label: say('Light') },
            { key: 'dark', label: say('Dark') },
          ]}
        />
      </Card>
      <ScopeControl
        field="appearance"
        overridden={appearance !== 'system'}
        inheritedLabel={say('System')}
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
      <SectionLabel>{say('Language')}</SectionLabel>
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
      <Hint>{say('Only changes this phone. Each computer keeps its own language.')}</Hint>
      <SectionLabel>{say('Feedback')}</SectionLabel>
      <Card style={{ marginHorizontal: space.l }}>
        <ToggleRow
          title={say('Haptic feedback')}
          help={say('A light tap when you switch tabs, pick an option or copy text.')}
          value={drafts.haptics !== 'off'}
          onChange={(on) => setDraft('haptics', on ? '' : 'off')}
        />
      </Card>
      <VoiceSettings />
    </>
  )
}

/**
 * How a message sent while the agent works, and the warning before a model change, behave: for all devices (the
 * computer's own setting), all your phones (kept on the computer), or this phone alone.
 */
function BusyBehavior({ host, locked }: { host: ReturnType<typeof useHostSettings>; locked: boolean }) {
  const { appPreferences } = useStore()
  const t = useT()
  const say = useSay()
  const computerId = host.computerId
  const ready = host.state.status === 'ready'
  const allBlocked = locked ? ('permission' as const) : ready ? undefined : ('offline' as const)
  // The live snapshot shows a save at once; the store's copy covers the moment before it loads.
  const hostValue = (path: 'busyMessageAction' | 'warnModelChange' | 'recentChatMode') =>
    ready ? host.read(path) : appPreferences[computerId]?.[path]
  const busy = useScopedChoice<BusyMode>({
    computerId,
    field: 'queueWhileBusy',
    deviceKey: BUSY_MODE_DEVICE_KEY,
    fallback: 'steer',
    read: readBusyMode,
    toShared: (value) => value,
    all: {
      value: hostValue('busyMessageAction'),
      blocked: allBlocked,
      save: (value) => host.set('busyMessageAction', value),
    },
  })
  const warning = useScopedChoice<ModelWarning>({
    computerId,
    field: 'modelChangeWarning',
    deviceKey: MODEL_WARNING_DEVICE_KEY,
    fallback: 'on',
    read: readModelWarning,
    toShared: (value) => value === 'on',
    all: {
      value: hostValue('warnModelChange'),
      blocked: allBlocked,
      save: (value) => host.set('warnModelChange', value === 'on'),
    },
  })
  const threadList = useScopedChoice<ThreadListMode>({
    computerId,
    field: 'recentChatMode',
    deviceKey: THREAD_LIST_KEY,
    fallback: 'projects',
    read: readThreadList,
    toShared: (value) => value === 'recent',
    all: {
      value: hostValue('recentChatMode'),
      blocked: allBlocked,
      save: (value) => host.set('recentChatMode', value === 'recent'),
    },
  })
  return (
    <>
      <SectionLabel>{t.yourPreferences}</SectionLabel>
      <Card style={{ marginHorizontal: space.l }}>
        <ScopedChoiceRow<BusyMode>
          title="Messages while working"
          help={t.busyHint}
          control={busy}
          options={[
            { key: 'steer', label: t.steer },
            { key: 'queue', label: t.queue },
          ]}
        />
        <Divider inset={space.l} />
        <ScopedChoiceRow<ModelWarning>
          title="Warn before changing model"
          help={t.modelWarnHint}
          control={warning}
          options={[
            { key: 'on', label: t.modelWarnOn },
            { key: 'off', label: t.modelWarnOff },
          ]}
        />
        <Divider inset={space.l} />
        <ScopedChoiceRow<ThreadListMode>
          title="Thread list shows"
          help={say(
            'Projects groups threads under their project. Recent threads lists every thread by latest activity.',
          )}
          control={threadList}
          options={[
            { key: 'projects', label: say('Projects') },
            { key: 'recent', label: say('Recent threads') },
          ]}
        />
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
    artifacts: [say('Artifacts'), say('Notifications from artifacts you allowed to notify, in their own words.')],
  }
  return (
    <>
      <SectionLabel>{say('This phone')}</SectionLabel>
      <Card style={{ marginHorizontal: space.l }}>
        <ToggleRow
          title={say('Background alerts')}
          help={say('Get alerts from your paired hosts when a task needs your attention.')}
          value={pushOn}
          onChange={(on) => {
            void (on ? enablePush() : disablePush()).catch((e) => Alert.alert(say('Notifications'), e.message))
          }}
        />
        {Platform.OS === 'ios' ? (
          <>
            <Divider inset={space.l} />
            <ToggleRow
              title={say('Live Activities')}
              help={say('Track ongoing work on your Lock Screen and Dynamic Island.')}
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
      <Hint>{say('Alerts only reach you if “Background alerts” is on and this computer is paired.')}</Hint>
    </>
  )
}

function Computers() {
  const say = useSay()
  const router = useRouter()
  const { c } = useTheme()
  const { computers, selected, select, retry } = useStore()
  const [addressOpen, setAddressOpen] = useState(false)
  const pc = computers.find((computer) => computer.id === selected)
  return (
    <>
      <SectionLabel>{say('Paired computers')}</SectionLabel>
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
          <T tone="accent">{say('Pair a computer')}</T>
        </Row>
      </Card>
      <Hint>{say('Settings and new threads go to the checked computer.')}</Hint>
      {pc ? (
        <>
          <PhonePermissions computerId={pc.id} />
          <SectionLabel>{say('Connection')}</SectionLabel>
          <Card style={{ marginHorizontal: space.l }}>
            <Row style={{ paddingVertical: space.m }} onPress={() => retry(pc.id)}>
              <RowLabel title={say('Reconnect')} help={pc.error ?? say('Refresh the connection to this host.')} />
              <RefreshCw size={16} color={c.muted} />
            </Row>
            <Divider inset={space.l} />
            <Row onPress={() => setAddressOpen(true)}>
              <RowLabel
                title={say('Network')}
                help={`${say(networkName(hostOfUrl(pc.address)))} · ${hostOfUrl(pc.address)}`}
              />
              <ChevronRight size={16} color={c.muted} />
            </Row>
            <Divider inset={space.l} />
            <Row onPress={() => router.push('/computers')}>
              <T style={{ flex: 1 }}>{say('Manage computers')}</T>
            </Row>
          </Card>
          {addressOpen ? <HostAddressSheet key={pc.id} computer={pc} onClose={() => setAddressOpen(false)} /> : null}
        </>
      ) : null}
    </>
  )
}

function About() {
  const say = useSay()
  return (
    <>
      <SectionLabel>Ramu</SectionLabel>
      <Card style={{ marginHorizontal: space.l }}>
        <Row>
          <T style={{ flex: 1 }}>{say('Version')}</T>
          <T tone="muted">{Constants.expoConfig?.version ?? '0.1.0'} · alpha</T>
        </Row>
        <Divider inset={space.l} />
        <Row>
          <T style={{ flex: 1 }}>{say('Data')}</T>
          <T tone="muted">{say('Live workspace')}</T>
        </Row>
      </Card>
    </>
  )
}

function Usage({ computer }: { computer: string }) {
  const { usage, appPreferences } = useStore()
  const say = useSay()
  const readings = usage[computer] ?? []
  const logins = useAccountLogins([computer], readings.length > 0)[computer]
  return (
    <>
      <SectionLabel>{say('Plan usage')}</SectionLabel>
      <PlanUsageSummary hostIds={[computer]} />
      <Card style={{ marginHorizontal: space.l }}>
        {readings.length ? (
          readings.map((r, i) => (
            <View key={`${r.provider}:${r.accountId ?? 'default'}:${r.window}:${r.scope ?? ''}`}>
              {i ? <Divider inset={space.m} /> : null}
              <PlanUsageReading
                reading={r}
                account={accountName(
                  appPreferences[computer]?.providerBinaries,
                  r.provider,
                  r.accountId ?? 'default',
                  logins?.[r.provider]?.[r.accountId ?? 'default'],
                  say,
                )}
              />
            </View>
          ))
        ) : (
          <T size={font.control} tone="muted" style={{ padding: space.m }}>
            {say('Unavailable — this computer has not reported usage.')}
          </T>
        )}
      </Card>
    </>
  )
}

/** What the desktop edits that the phone leaves to it, so a missing row is explained rather than puzzling. */
const desktopOnly: Partial<Record<SettingsSection, string>> = {
  browser: 'Creating, importing and clearing browser profiles, and downloads, are managed in Ramu on the host.',
  providers: 'Provider executable paths and sign-in are managed in Ramu on the host.',
  models: 'Model sets, the fallback order and the provider for each ability are edited in Ramu on the host.',
  workflows: 'Custom agents and a helper model of your own are set up in Ramu on the host.',
  memory: 'Installing and editing skills, and their model choices, are managed in Ramu on the host.',
  git: 'Hosting accounts and their tokens are added in Ramu on the host.',
}

export default function SettingsSectionPage() {
  const edge = useScrolledUnderBar()
  const { section: param, target } = useLocalSearchParams<{ section: string; target?: string }>()
  const section = sectionById(String(param))
  const { computers, selected, language, mayUse } = useStore()
  const host = useHostSettings(selected)
  // Without the host's Change settings permission the rows read only, with a request instead of saves it would refuse.
  const locked = !mayUse(selected, 'settings')
  const name = computers.find((computer) => computer.id === selected)?.name
  if (!section) return null
  const id = section.id
  const note = desktopOnly[id]
  return (
    <Screen bg="window">
      <SettingsHeader
        host={section.scope === 'host'}
        align="center"
        title={translate(language, section.label)}
        scrollEdge
        scrolled={edge.scrolled}
      />
      <SettingScroll
        target={target ? String(target) : undefined}
        onScroll={edge.onScroll}
        scrollEventThrottle={16}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: space.xl * 2 }}
      >
        {section.scope === 'host' && locked && computers.find((c) => c.id === selected)?.access !== 'viewer' ? (
          <View style={{ paddingHorizontal: space.l, paddingBottom: space.m }}>
            <PermissionNeeded computerId={selected} permission="settings" />
          </View>
        ) : null}
        {id === 'appearance' ? <AppearancePage /> : null}
        {id === 'notifications' ? <Notifications host={host} name={name} /> : null}
        {id === 'remote' ? <Computers /> : null}
        {id === 'about' ? <About /> : null}
        {id === 'account' ? <AccountSettings /> : null}
        {id === 'providers' ? (
          <ProviderCompatibility key={`ProviderCompatibility:${selected}`} hostId={selected} locked={locked} />
        ) : null}
        {id === 'providers' ? <MediaStatus key={`MediaStatus:${selected}`} hostId={selected} /> : null}
        {id === 'providers' ? <Usage computer={selected} /> : null}
        {id === 'chats' ? <BusyBehavior key={`BusyBehavior:${selected}`} host={host} locked={locked} /> : null}
        {id === 'computer' ? <ComputerUseSettings key={`ComputerUseSettings:${selected}`} hostId={selected} /> : null}
        {id === 'devices' ? <TestDeviceSettings key={`TestDeviceSettings:${selected}`} hostId={selected} /> : null}
        {id === 'git' ? <HostingStatus key={`HostingStatus:${selected}`} hostId={selected} /> : null}
        {id === 'agent-setup' ? <AgentSetupSettings key={`AgentSetupSettings:${selected}`} hostId={selected} /> : null}
        {id === 'agent-setup' ? <RulesSettings key={`RulesSettings:${selected}`} hostId={selected} /> : null}
        {id === 'agent-setup' ? (
          <ManagedSkills key={`ManagedSkills:${selected}`} hostId={selected} locked={locked} />
        ) : null}
        {id === 'plugins' ? <PluginSettings key={`PluginSettings:${selected}`} hostId={selected} /> : null}
        {id === 'identities' ? (
          <IdentitySettings key={`IdentitySettings:${selected}`} hostId={selected} locked={locked} />
        ) : null}
        {section.scope === 'host' && id !== 'computer' && id !== 'devices' ? (
          <HostGroups section={id} host={host} name={name} locked={locked} />
        ) : null}
        {id === 'models' ? <AbilitySummary key={`AbilitySummary:${selected}`} hostId={selected} /> : null}
        {id === 'memory' ? (
          <LearningReviews key={`LearningReviews:${selected}`} hostId={selected} locked={locked} />
        ) : null}
        {id === 'memory' ? <MemoryList key={`MemoryList:${selected}`} hostId={selected} /> : null}
        {id === 'browser' ? (
          <BrowserDefaultProfile key={`BrowserDefaultProfile:${selected}`} host={host} locked={locked} />
        ) : null}
        {id === 'access' ? (
          <SavedApprovals key={`SavedApprovals:${selected}`} hostId={selected} locked={locked} />
        ) : null}
        {note ? <Hint>{translate(language, note)}</Hint> : null}
      </SettingScroll>
    </Screen>
  )
}
