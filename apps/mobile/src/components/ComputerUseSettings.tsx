import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Linking, View } from 'react-native'
import type { RamuMethods } from '@ramu/shared/api'
import {
  queuePlace,
  testDeviceFix,
  testDeviceSummary,
  type PlatformReadiness,
  type TestDeviceStatus,
  type TestPlatform,
} from '@ramu/shared/testDevices'
import { appControlHelp, runtimeHelp } from '@ramu/shared/computerStatus'
import { space } from '../theme'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import { Hint, ToggleRow } from './SettingRows'
import { Button, Card, Divider, SectionLabel, Sheet, T } from './ui'
import { SheetGroup, SheetOption } from './SheetOptions'
import { PageLoader } from './PageLoader'

type Status = ReturnType<RamuMethods['computer.status']>

/**
 * Settings → Computer for the selected computer: whether agents may use its screen and real-pointer drags. Which
 * paired devices share their screen with it is a permission, so it lives in Remote access. Installing the helper and granting macOS permissions need someone at that Mac, so
 * this page reports their state and leaves the steps to Ramu on the host.
 */
export function ComputerUseSettings({ hostId }: { hostId: string }) {
  const say = useSay()
  const store = useStore()
  const readOnly = store.computers.find((computer) => computer.id === hostId)?.access === 'viewer'
  const online = store.isOnline(hostId)
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  const load = useCallback(async () => {
    try {
      const next = await store.invoke(hostId, 'computer.status')
      if (!live.current) return
      setStatus(next)
      setError('')
    } catch (reason) {
      if (live.current) setError(reason instanceof Error ? reason.message : String(reason))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputes on [hostId, store.invoke] by design; the values it reads beyond these are current as of that run
  }, [hostId, store.invoke])
  useEffect(() => {
    setStatus(null)
    if (online) void load()
  }, [load, online])
  const act = async (work: () => Promise<unknown>) => {
    if (busy || readOnly) return
    setBusy(true)
    try {
      await work()
      await load()
    } catch (reason) {
      Alert.alert(say('Computer use'), reason instanceof Error ? reason.message : String(reason))
      await load()
    } finally {
      if (live.current) setBusy(false)
    }
  }
  if (!online)
    return (
      <T tone="muted" style={{ padding: space.xl, textAlign: 'center' }}>
        {say('This computer is not reachable, so Computer use cannot be shown.')}
      </T>
    )
  if (!status && !error) return <PageLoader style={{ margin: space.xl }} />
  if (!status)
    return (
      <T tone="bad" style={{ padding: space.xl }}>
        {error}
      </T>
    )
  return (
    <>
      <SectionLabel>{say('Agent access')}</SectionLabel>
      <Card style={{ marginHorizontal: space.l }}>
        <ToggleRow
          title={say('Let agents use this computer')}
          help={say(runtimeHelp(status))}
          value={status.enabled}
          disabled={busy || readOnly || (!status.enabled && !status.runtime.available)}
          onChange={(enabled) => void act(() => store.invoke(hostId, 'computer.setEnabled', enabled))}
        />
        {status.apps ? (
          <>
            <Divider inset={space.l} />
            <View style={{ padding: space.l }}>
              <T weight="500">{say('App control')}</T>
              <T size={12} tone="muted" style={{ marginTop: 4, lineHeight: 18 }}>
                {say(appControlHelp(status))}
              </T>
            </View>
          </>
        ) : null}
        {status.enabled && status.apps?.available ? (
          <>
            <Divider inset={space.l} />
            <ToggleRow
              title={say('Let app drags use your real pointer')}
              help={say(
                status.globalPointer
                  ? 'On. Dragging in an app can move windows and select text, and it may move your pointer while the agent works.'
                  : 'Off. Drags stay inside the app and never move your pointer, but cannot move windows or select text.',
              )}
              value={status.globalPointer}
              disabled={busy || readOnly}
              onChange={(enabled) => void act(() => store.invoke(hostId, 'computer.setGlobalPointer', enabled))}
            />
          </>
        ) : null}
      </Card>
      <Hint>
        {say(
          'Each thread still needs your approval before the agent can see or control the screen. Install the helper and allow Screen Recording and Accessibility in Ramu on that Mac. Turning this off ends every thread’s access.',
        )}
      </Hint>
      {error ? (
        <T tone="bad" style={{ paddingHorizontal: space.l + 4, paddingTop: space.s }}>
          {error}
        </T>
      ) : null}
    </>
  )
}

function Readiness({ title, value }: { title: string; value: PlatformReadiness }) {
  const say = useSay()
  return (
    <View style={{ padding: space.l, gap: 4 }}>
      <T weight="500">{value.unsupported ? title : `${title} · ${say(value.ready ? 'Ready' : 'Needs setup')}`}</T>
      {value.unsupported ? (
        <T size={12} tone="muted" style={{ lineHeight: 18 }}>
          {say(value.unsupported)}
        </T>
      ) : null}
      {value.missing.map((entry) => {
        const fix = testDeviceFix(entry.item)
        return (
          <View key={entry.item} style={{ gap: 4 }}>
            <T size={12} tone="muted" style={{ lineHeight: 18 }}>
              {say(entry.name)}: {entry.fix}
            </T>
            {fix?.kind === 'link' ? (
              <Button kind="ghost" title={say(fix.label)} onPress={() => void Linking.openURL(fix.url)} />
            ) : null}
          </View>
        )
      })}
    </View>
  )
}

/** A thread with a device, or one waiting for it, with Stop. */
function DeviceRow({
  title,
  detail,
  waiting,
  disabled,
  onStop,
}: {
  title: string
  detail: string
  waiting: boolean
  disabled: boolean
  onStop: () => void
}) {
  const say = useSay()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, padding: space.l }}>
      <View style={{ flex: 1, gap: 2 }}>
        <T numberOfLines={1}>{title}</T>
        <T size={12} tone="muted" numberOfLines={1}>
          {detail}
        </T>
      </View>
      <Button
        kind="secondary"
        title={waiting ? say('Stop waiting') : say('Stop')}
        accessibilityLabel={say('Stop {0}', { 0: title })}
        disabled={disabled}
        onPress={onStop}
      />
    </View>
  )
}

const PLATFORM_TITLE: Record<TestPlatform, string> = { ios: 'iOS Simulator', android: 'Android emulator' }

/**
 * Settings → Test devices on the selected computer, in the desktop page's order: the switch with its status line,
 * Set up (which runs on that computer), what each platform still needs, the threads holding or waiting for a device
 * with Stop, and the model a thread gets by default.
 */
export function TestDeviceSettings({ hostId }: { hostId: string }) {
  const say = useSay()
  const store = useStore()
  const readOnly = store.computers.find((computer) => computer.id === hostId)?.access === 'viewer'
  const online = store.isOnline(hostId)
  const [status, setStatus] = useState<TestDeviceStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [choosing, setChoosing] = useState<TestPlatform | null>(null)
  const [choosingCount, setChoosingCount] = useState(false)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  const load = useCallback(async () => {
    try {
      const next = await store.invoke(hostId, 'testDevices.status')
      if (!live.current) return
      setStatus(next)
      setError('')
    } catch (reason) {
      if (live.current) setError(reason instanceof Error ? reason.message : String(reason))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputes on [hostId, store.invoke] by design; the values it reads beyond these are current as of that run
  }, [hostId, store.invoke])
  useEffect(() => {
    setStatus(null)
    if (!online) return
    void load()
    // Threads take and give back devices while the page is open.
    const timer = setInterval(() => void load(), 10_000)
    return () => clearInterval(timer)
  }, [load, online])
  const act = async (work: () => Promise<unknown>) => {
    if (busy || readOnly) return
    setBusy(true)
    try {
      await work()
    } catch (reason) {
      if (live.current) setError(reason instanceof Error ? reason.message : String(reason))
    }
    await load()
    if (live.current) setBusy(false)
  }
  if (!online) return <Hint>{say('Connect to this host to see its test devices.')}</Hint>
  if (!status) return error ? <Hint>{error}</Hint> : null
  const platforms = (['ios', 'android'] as const).filter(
    (platform) => status[platform].ready && status.models[platform].length,
  )
  const stop = (taskId: string) => void act(() => store.invoke(hostId, 'testDevices.stop', taskId))
  return (
    <>
      <Card style={{ marginHorizontal: space.l }}>
        <ToggleRow
          title={say('Let agents use test devices')}
          help={testDeviceSummary(status)
            .parts.map((part) => say(part.text, part.values))
            .join(' · ')}
          value={status.enabled}
          disabled={busy || readOnly}
          onChange={(enabled) => void act(() => store.invoke(hostId, 'testDevices.setEnabled', enabled))}
        />
        {!status.installed ? (
          <>
            <Divider inset={space.l} />
            <View style={{ padding: space.l, gap: space.s }}>
              <T size={12} tone="muted" style={{ lineHeight: 18 }}>
                {say('Installs Simlock and agent-device in Ramu’s tools folder. No Homebrew, nothing system-wide.')}
              </T>
              <Button
                title={busy ? say('Setting up…') : say('Set up test devices')}
                disabled={busy || readOnly}
                onPress={() => void act(() => store.invoke(hostId, 'testDevices.setUp'))}
              />
            </View>
          </>
        ) : null}
      </Card>
      {status.installed ? (
        <>
          <SectionLabel>{say('Setup')}</SectionLabel>
          <Card style={{ marginHorizontal: space.l }}>
            <Readiness title={say(PLATFORM_TITLE.ios)} value={status.ios} />
            <Divider inset={space.l} />
            <Readiness title={say(PLATFORM_TITLE.android)} value={status.android} />
          </Card>
        </>
      ) : null}
      {status.inUse.length || status.waiting.length ? (
        <>
          <SectionLabel>{say('In use')}</SectionLabel>
          <Card style={{ marginHorizontal: space.l }}>
            {status.inUse.map((entry, index) => (
              <View key={entry.taskId}>
                {index ? <Divider inset={space.l} /> : null}
                <DeviceRow
                  title={entry.name}
                  detail={
                    store.chats.find((chat) => chat.computerId === hostId && chat.taskId === entry.taskId)?.title ??
                    say('Held by a thread')
                  }
                  waiting={false}
                  disabled={busy || readOnly}
                  onStop={() => stop(entry.taskId)}
                />
              </View>
            ))}
            {status.waiting.map((entry, index) => {
              const place = queuePlace(entry.position)
              return (
                <View key={entry.taskId}>
                  {index || status.inUse.length ? <Divider inset={space.l} /> : null}
                  <DeviceRow
                    title={say(PLATFORM_TITLE[entry.platform])}
                    detail={say(place.text, place.values)}
                    waiting
                    disabled={busy || readOnly}
                    onStop={() => stop(entry.taskId)}
                  />
                </View>
              )
            })}
          </Card>
        </>
      ) : null}
      {platforms.length ? (
        <>
          <SectionLabel>{say('Defaults')}</SectionLabel>
          <Card style={{ marginHorizontal: space.l }}>
            {platforms.map((platform, index) => (
              <View key={platform}>
                {index ? <Divider inset={space.l} /> : null}
                <SheetOption
                  title={say(platform === 'ios' ? 'iPhone or iPad' : 'Android device')}
                  trailing={
                    <T size={12} tone="muted">
                      {status.defaults[platform] ?? ''}
                    </T>
                  }
                  onPress={() => setChoosing(platform)}
                />
              </View>
            ))}
          </Card>
          <Hint>{say('What a thread gets when it names no model.')}</Hint>
        </>
      ) : null}
      {choosing ? (
        <Sheet open onClose={() => setChoosing(null)} title={say(PLATFORM_TITLE[choosing])}>
          <SheetGroup>
            {[...status.models[choosing]]
              .sort((a, b) => Number(b.kind === 'phone') - Number(a.kind === 'phone'))
              .map((model) => (
                <SheetOption
                  key={model.name}
                  title={model.name}
                  selected={model.name === status.defaults[choosing]}
                  onPress={() => {
                    const platform = choosing
                    setChoosing(null)
                    void act(() =>
                      store.invoke(hostId, 'testDevices.setPreferences', {
                        [platform === 'ios' ? 'iosModel' : 'androidModel']: model.name,
                      }),
                    )
                  }}
                />
              ))}
          </SheetGroup>
        </Sheet>
      ) : null}
      {choosingCount ? (
        <Sheet open onClose={() => setChoosingCount(false)} title={say('Devices at once')}>
          <SheetGroup>
            {[null, 1, 2, 3, 4, 5, 6].map((count) => (
              <SheetOption
                key={String(count)}
                title={count === null ? say('Automatic') : String(count)}
                selected={status.maxRunning === count}
                onPress={() => {
                  setChoosingCount(false)
                  void act(() => store.invoke(hostId, 'testDevices.setPreferences', { maxRunning: count }))
                }}
              />
            ))}
          </SheetGroup>
        </Sheet>
      ) : null}
      {status.installed ? (
        <>
          <SectionLabel>{say('Advanced')}</SectionLabel>
          <Card style={{ marginHorizontal: space.l }}>
            <ToggleRow
              title={say('Keep a spare device ready')}
              help={say(
                'The next thread gets its device in about half the time, but a spare simulator or emulator stays booted and holds memory.',
              )}
              value={status.keepWarm}
              disabled={busy || readOnly}
              onChange={(keep) =>
                void act(() => store.invoke(hostId, 'testDevices.setPreferences', { keepWarm: keep }))
              }
            />
            <Divider inset={space.l} />
            <SheetOption
              title={say('Devices at once')}
              trailing={
                <T size={12} tone="muted">
                  {status.maxRunning === null ? say('Automatic') : String(status.maxRunning)}
                </T>
              }
              onPress={() => setChoosingCount(true)}
            />
            {!status.ios.unsupported ? (
              <>
                <Divider inset={space.l} />
                <ToggleRow
                  title={say('Slim iOS Simulators')}
                  help={say('Quicker to start and lighter on memory, without some system apps such as Safari.')}
                  value={status.slim}
                  disabled={busy || readOnly}
                  onChange={(slim) => void act(() => store.invoke(hostId, 'testDevices.setPreferences', { slim }))}
                />
              </>
            ) : null}
          </Card>
        </>
      ) : null}
      {error ? (
        <T tone="bad" style={{ paddingHorizontal: space.l + 4, paddingTop: space.s }}>
          {error}
        </T>
      ) : null}
    </>
  )
}
