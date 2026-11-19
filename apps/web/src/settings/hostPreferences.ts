import { createElement, useEffect, useState, type ReactNode } from 'react'
import { useHost } from '../workspace/HostProvider'
import { useHostRuntime } from '../workspace/workspace'
import { DEFAULT_APP_PREFERENCES, type AppPreferences } from '@ramu/shared/types'
import type { HostRuntime } from '../workspace/hostRuntime'
import { ownHostId } from '../hosts'
import { invoke } from '../ipc'
import { AppSettingsOverride, useAppSettings } from './AppSettings'

/**
 * The preferences a host's workspace store follows (preview tabs, the default terminal dock). The window's own host
 * uses this window's settings; another host's store reads that host's (`computers.settings.get`) and follows its
 * `settings:changed`. Until they arrive it uses this window's, so a store never waits on them. Appearance, language
 * and the other window-wide settings always stay this window's (`useAppSettings`).
 */
export function useHostPreferences(host: string, on: HostRuntime['on']): AppPreferences {
  const { preferences } = useAppSettings()
  const own = host === ownHostId()
  const [loaded, setLoaded] = useState<{ host: string; preferences: AppPreferences } | null>(null)
  const hostPreferences = loaded?.host === host ? loaded.preferences : null
  useEffect(() => {
    if (own) return
    let disposed = false
    void invoke('computers.settings.get', host).then(
      (snapshot) => {
        if (!disposed && snapshot.preferences)
          setLoaded({ host, preferences: { ...DEFAULT_APP_PREFERENCES, ...snapshot.preferences } })
      },
      () => {},
    )
    const off = on('settings:changed', (next) =>
      setLoaded({ host, preferences: { ...DEFAULT_APP_PREFERENCES, ...next } }),
    )
    return () => {
      disposed = true
      off()
    }
  }, [host, own, on])
  return own ? preferences : (hostPreferences ?? preferences)
}

/** Preferences used by the active host's feature screens; desktop appearance stays owned by the outer provider. */
export function ActiveHostSettings({ children }: { children: ReactNode }) {
  const host = useHost()
  const runtime = useHostRuntime()
  const inherited = useAppSettings()
  const preferences = useHostPreferences(host.id, runtime.on)
  const [latest, setLatest] = useState<{ host: string; preferences: AppPreferences } | null>(null)
  const refreshed = latest?.host === host.id ? latest.preferences : null
  useEffect(
    () => runtime.on('settings:changed', (next) => setLatest({ host: host.id, preferences: next })),
    [runtime, host.id],
  )
  return createElement(AppSettingsOverride, {
    value: {
      preferences: refreshed ?? preferences,
      reload: async () => {
        if (host.isLocal) await inherited.reload()
        else setLatest({ host: host.id, preferences: await host.invoke('settings.app.get') })
      },
      save: async (next) => {
        if (host.isLocal) await inherited.save(next)
        else {
          await host.invoke('settings.app.set', next)
          setLatest({ host: host.id, preferences: next })
        }
      },
    },
    children,
  })
}
