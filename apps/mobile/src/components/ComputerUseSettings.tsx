import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, View } from 'react-native'
import type { RamuMethods } from '@ramu/shared/api'
import type { PlatformReadiness, TestDeviceStatus } from '@ramu/shared/testDevices'
import { appControlHelp, runtimeHelp } from '@ramu/shared/computerStatus'
import { space } from '../theme'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import { Hint, ToggleRow } from './SettingRows'
import { Button, Card, Divider, SectionLabel, T } from './ui'

type Status = ReturnType<RamuMethods['computer.status']>

/**
 * Settings → Computer use for the selected computer: whether agents may use its screen and real-pointer drags. Which
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
  if (!status && !error) return <ActivityIndicator style={{ margin: space.xl }} />
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
              title={say('Let app drags use the real pointer')}
              help={say(
                status.globalPointer
                  ? 'On. Dragging in an app can move windows and select text, and it may move the pointer while the agent works.'
                  : 'Off. Drags stay inside the app and never move the pointer, but cannot move windows or select text.',
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
          'Each thread still needs your approval before the agent can see or control the screen. Installing the helper and allowing Screen Recording and Accessibility are done in Ramu on that Mac. Turning this off ends every thread’s access.',
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
      <T weight="500">
        {title} · {say(value.ready ? 'Ready' : 'Not ready')}
      </T>
      {value.missing.map((entry) => (
        <T key={entry.item} size={12} tone="muted" style={{ lineHeight: 18 }}>
          {entry.item}: {entry.fix}
        </T>
      ))}
      {value.note ? (
        <T size={12} tone="muted" style={{ lineHeight: 18 }}>
          {say(value.note)}
        </T>
      ) : null}
    </View>
  )
}

/**
 * Test devices on the selected computer, as on the desktop: whether agents may boot its iOS Simulators and Android
 * emulators, what each platform still needs, and Stop for a device left running. Installing Xcode, the Android SDK or
 * the tap helper happens at that computer.
 */
export function TestDeviceSettings({ hostId }: { hostId: string }) {
  const say = useSay()
  const store = useStore()
  const readOnly = store.computers.find((computer) => computer.id === hostId)?.access === 'viewer'
  const online = store.isOnline(hostId)
  const [status, setStatus] = useState<TestDeviceStatus | null>(null)
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
    if (online) void load()
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
  // A host without test devices answers with an error; the section stays out of the way rather than alarming.
  if (!status || !online) return null
  const running = status.devices.filter((device) => device.running)
  return (
    <>
      <SectionLabel>{say('Test devices')}</SectionLabel>
      <Card style={{ marginHorizontal: space.l }}>
        <ToggleRow
          title={say('Let agents use test devices')}
          help={say(
            'Agents boot iOS Simulators and Android emulators on this host, install the app they built and check it like computer use. Xcode and the Android SDK stay your install.',
          )}
          value={status.enabled}
          disabled={busy || readOnly}
          onChange={(enabled) => void act(() => store.invoke(hostId, 'testDevices.setEnabled', enabled))}
        />
        <Divider inset={space.l} />
        <Readiness title="iOS" value={status.ios} />
        <Divider inset={space.l} />
        <Readiness title="Android" value={status.android} />
        {running.map((device) => (
          <View key={device.id}>
            <Divider inset={space.l} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, padding: space.l }}>
              <T style={{ flex: 1 }} numberOfLines={1}>
                {device.name}
              </T>
              <Button
                kind="secondary"
                title={say('Stop')}
                accessibilityLabel={say('Stop {0}', { 0: device.name })}
                disabled={busy || readOnly}
                onPress={() => void act(() => store.invoke(hostId, 'testDevices.stop', device.id))}
              />
            </View>
          </View>
        ))}
      </Card>
      {error ? (
        <T tone="bad" style={{ paddingHorizontal: space.l + 4, paddingTop: space.s }}>
          {error}
        </T>
      ) : null}
    </>
  )
}
