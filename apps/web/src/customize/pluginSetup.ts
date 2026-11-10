import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_PLUGIN_INDEX } from '@ramu/shared/plugins'
import { openPluginSettings } from '../settings/openPluginSettings'
import { useHost } from '../workspace/HostProvider'
import { reviewPluginInstall } from './openCustomize'

/** How far one of Ramu's plugins is set up on a host: not installed, installed without its key, or ready. */
export type PluginSetupState = 'missing' | 'credential' | 'ready'

/**
 * The setup state of the plugin named `name` from Ramu's index on the current host, and the next step: the install
 * review when it is missing, its credential in Customize → Plugins otherwise. Null while it is read or with no name.
 */
export function usePluginSetup(name: string | null): {
  state: PluginSetupState | null
  setUp: () => void
} {
  const host = useHost()
  const [state, setState] = useState<{ name: string; value: PluginSetupState } | null>(null)
  useEffect(() => {
    if (!name) return
    let live = true
    // A host without plugins shows the plugin as not installed.
    void Promise.resolve(host.invoke('plugins.list'))
      .catch(() => [])
      .then((plugins) => {
        if (!live) return
        const plugin = plugins.find((entry) => entry.name === name && entry.enabled)
        setState({
          name,
          value: !plugin
            ? 'missing'
            : plugin.credentials.every((slot) => slot.state === 'saved')
              ? 'ready'
              : 'credential',
        })
      })
    return () => {
      live = false
    }
  }, [host, name])
  const current = name && state?.name === name ? state.value : null
  const setUp = useCallback(() => {
    if (!name) return
    if (current === 'missing') reviewPluginInstall(DEFAULT_PLUGIN_INDEX, name)
    else openPluginSettings(host.id)
  }, [current, host.id, name])
  return { state: current, setUp }
}
