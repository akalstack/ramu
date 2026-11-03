import { useEffect, useRef, useState } from 'react'
import { Alert } from 'react-native'
import type { SettingsSnapshot, SharedSetting } from '@ramu/shared/settingsCompatibility'
import { useStore } from './store'
import { applyValue, looseInvoke, patchSetting, type SettingsHost } from './settingsModel'

export type HostSettingsState =
  | { status: 'offline' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; settings: SharedSetting[] }

/**
 * The shared preferences of one computer, edited live: each change shows at once, is saved in order against what the
 * computer last confirmed, and snaps back with an alert if the computer refuses it.
 */
export function useHostSettings(computerId: string) {
  const store = useStore()
  const online = store.computers.find((computer) => computer.id === computerId)?.status === 'online'
  const [state, setState] = useState<HostSettingsState>({ status: online ? 'loading' : 'offline' })
  const confirmed = useRef<SettingsSnapshot | null>(null)
  const shown = useRef<SettingsSnapshot | null>(null)
  const pending = useRef(0)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const generation = useRef(0)
  const call = looseInvoke(store.invoke)
  const host = ((method: string, ...args: unknown[]) => call(computerId, method, ...args)) as SettingsHost
  const hostRef = useRef(host)
  hostRef.current = host

  const show = (snapshot: SettingsSnapshot) => {
    shown.current = snapshot
    setState({ status: 'ready', settings: snapshot.settings })
  }
  const load = () => {
    const mine = ++generation.current
    void hostRef
      .current('settings.app.snapshot')
      .then((snapshot) => {
        // A save in flight owns what is on screen; its own answer follows.
        if (mine !== generation.current || pending.current) return
        confirmed.current = snapshot
        show(snapshot)
      })
      .catch((error) => {
        if (mine !== generation.current) return
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      })
  }
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    confirmed.current = shown.current = null
    generation.current++
    setState({ status: online ? 'loading' : 'offline' })
    if (online) loadRef.current()
  }, [computerId, online])
  // The store re-reads preferences whenever the computer's settings change, so that is our cue to refresh too.
  const changed = store.appPreferences[computerId]
  const first = useRef(true)
  useEffect(() => {
    if (first.current) first.current = false
    else if (online) loadRef.current()
  }, [changed, online])

  const read = (path: string) => shown.current?.settings.find((setting) => setting.path === path)?.value
  const set = (path: string, value: unknown) => {
    if (!shown.current || !confirmed.current) return
    pending.current++
    show(applyValue(shown.current, path, value))
    queue.current = queue.current.then(async () => {
      try {
        const next = await patchSetting(hostRef.current, confirmed.current!, path, value)
        confirmed.current = next
        pending.current--
        if (!pending.current) show(next)
      } catch (error) {
        pending.current--
        const was = confirmed.current?.settings.find((setting) => setting.path === path)?.value
        if (shown.current) show(applyValue(shown.current, path, was))
        Alert.alert('Could not save', error instanceof Error ? error.message : String(error))
      }
    })
  }
  return { state, read, set, reload: load, computerId }
}
