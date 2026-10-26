import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, View } from 'react-native'
import type { RamuMethods } from '@ramu/shared/api'
import { appControlHelp, runtimeHelp } from '@ramu/shared/computerStatus'
import { space } from '../theme'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import { isMethodMissing } from '../runtime/goalVerify'
import { Hint, ToggleRow } from './SettingRows'
import { Card, Divider, SectionLabel, T } from './ui'

type Status = ReturnType<RamuMethods['computer.status']>
type Device = ReturnType<RamuMethods['computer.runtimeDevices']>[number]

/**
 * Settings → Computer use for the selected computer: whether agents may use its screen, real-pointer drags, and which paired
 * devices share their screen with it. Installing the helper and granting macOS permissions need someone at that Mac, so
 * this page reports their state and leaves the steps to Ramu on the host.
 */
export function ComputerUseSettings({ hostId }: { hostId: string }) {
  const say = useSay()
  const store = useStore()
  const readOnly = store.computers.find((computer) => computer.id === hostId)?.access === 'viewer'
  const online = store.isOnline(hostId)
  const [status, setStatus] = useState<Status | null>(null)
  const [devices, setDevices] = useState<Device[]>([])
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
      // Device sharing is an owner's decision on the host that holds the screen.
      const shared = next.enabled ? await store.invoke(hostId, 'computer.runtimeDevices').catch(() => []) : []
      if (live.current) setDevices(shared)
    } catch (reason) {
      if (live.current)
        setError(
          isMethodMissing(reason)
            ? say('This computer is too old to show Computer use here. Update Ramu on it.')
            : reason instanceof Error
              ? reason.message
              : String(reason),
        )
    }
  }, [hostId, store.invoke])
  useEffect(() => {
    setStatus(null)
    setDevices([])
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
      {devices.length ? (
        <>
          <SectionLabel>{say('Devices sharing their screen')}</SectionLabel>
          <Card style={{ marginHorizontal: space.l }}>
            {devices.map((device, index) => (
              <View key={device.deviceId}>
                {index ? <Divider inset={space.l} /> : null}
                <ToggleRow
                  title={say('{0} shares its screen with this host', { 0: device.name })}
                  help={say(device.online ? 'Online' : 'Offline')}
                  value={device.allowed}
                  disabled={busy || readOnly}
                  onChange={(allow) =>
                    void act(() => store.invoke(hostId, 'computer.allowRuntime', device.deviceId, allow))
                  }
                />
              </View>
            ))}
          </Card>
          <Hint>{say('Off by default. You can revoke a device at any time.')}</Hint>
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
