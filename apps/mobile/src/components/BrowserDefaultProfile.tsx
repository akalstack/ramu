import { useEffect, useRef, useState } from 'react'
import type { BrowserProfileInfo } from '@ramu/shared/types/browser'
import { space } from '../theme'
import { useStore } from '../runtime/store'
import type { useHostSettings } from '../runtime/useHostSettings'
import type { Option } from '../runtime/settingsModel'
import { useSay } from '../i18n'
import { ChoiceRow } from './SettingRows'
import { Card } from './ui'

const PATH = 'agentBrowser.defaultProfileId'
/** The profiles every host has, offered when its own list cannot be read. */
const BUILTIN: Pick<BrowserProfileInfo, 'id' | 'name' | 'builtin'>[] = [
  { id: 'default', name: 'Default', builtin: true },
  { id: 'temporary', name: 'Temporary', builtin: true },
]

/** The choices for the default profile: the host's profiles, and the saved one even when it no longer exists. */
export function profileOptions(
  profiles: Pick<BrowserProfileInfo, 'id' | 'name' | 'builtin'>[] | null,
  current: unknown,
  say: (text: string, values?: Record<string, string>) => string,
): Option[] {
  const options = (profiles ?? BUILTIN).map((profile) => ({
    value: profile.id,
    label: profile.builtin ? say(profile.name) : profile.name,
  }))
  return typeof current === 'string' && !options.some((option) => option.value === current)
    ? [...options, { value: current, label: say('Unavailable profile ({0})', { 0: current }) }]
    : options
}

/**
 * The integrated browser profile agents start in on the selected host, as on the desktop's Browser settings. Creating,
 * importing and clearing profiles stay on the host.
 */
export function BrowserDefaultProfile({ host, locked }: { host: ReturnType<typeof useHostSettings>; locked: boolean }) {
  const store = useStore()
  const say = useSay()
  const hostId = host.computerId
  const online = store.isOnline(hostId)
  const [profiles, setProfiles] = useState<BrowserProfileInfo[] | null>(null)
  const runtime = useRef(store)
  runtime.current = store
  useEffect(() => {
    setProfiles(null)
    if (!online) return
    let active = true
    // A phone can list profiles only when agents use the host's own browser; a connected desktop's browser keeps its
    // list to itself, so the built-in profiles are the choices offered then.
    void (async () => {
      const status = await runtime.current.invoke(hostId, 'hostBrowser.status')
      if (!status.enabled || status.selected === false) return
      const catalog = await runtime.current.invoke(hostId, 'hostBrowser.profiles')
      if (active && catalog.profiles.length) setProfiles(catalog.profiles)
    })().catch(() => undefined)
    return () => {
      active = false
    }
  }, [hostId, online])
  if (host.state.status !== 'ready' || !host.state.settings.some((setting) => setting.path === PATH)) return null
  const value = host.read(PATH)
  return (
    <Card style={{ marginHorizontal: space.l, marginTop: space.m }}>
      <ChoiceRow
        title={say('Default integrated profile')}
        help={say(
          'Default shares website sign-ins on the host. Temporary keeps each run separate and is cleared when the run ends.',
        )}
        value={value}
        options={profileOptions(profiles, value, say)}
        disabled={locked || store.computers.find((computer) => computer.id === hostId)?.access === 'viewer'}
        onChange={(next) => host.set(PATH, next)}
      />
    </Card>
  )
}
