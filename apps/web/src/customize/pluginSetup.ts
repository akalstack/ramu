import { useCallback, useEffect, useState } from 'react'
import { openPluginSettings } from '../settings/openPluginSettings'
import { useHost } from '../workspace/HostProvider'
import { reviewPluginInstall } from './openCustomize'

/** How far a plugin is set up on a host: not installed, installed without its key, or ready. */
export type PluginSetupState = 'missing' | 'credential' | 'ready'

/**
 * The setup state of a plugin from an index on the current host, and the next step: the install review when it is
 * missing, its credential in Customize → Plugins otherwise. Null while it is read or with no plugin.
 */
export function usePluginSetup(plugin: { index: string; name: string } | null): {
  state: PluginSetupState | null
  setUp: () => void
} {
  const host = useHost()
  const name = plugin?.name ?? null
  const index = plugin?.index ?? null
  const [state, setState] = useState<{ name: string; value: PluginSetupState } | null>(null)
  useEffect(() => {
    if (!name) return
    let live = true
    // A host without plugins shows the plugin as not installed.
    void Promise.resolve(host.invoke('plugins.list'))
      .catch(() => [])
      .then((plugins) => {
        if (!live) return
        const installed = plugins.find((entry) => entry.name === name && entry.enabled)
        setState({
          name,
          value: !installed
            ? 'missing'
            : installed.credentials.every((slot) => slot.state === 'saved')
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
    if (!name || !index) return
    if (current === 'missing') reviewPluginInstall(index, name)
    else openPluginSettings()
  }, [current, index, name])
  return { state: current, setUp }
}
