import type { SettingsSection } from './SettingsPage'

const section: SettingsSection = 'plugins'

/** Opens Customize → Plugins on the host that needs a plugin, where it is installed and its credential saved. */
export const openPluginSettings = (host: string) =>
  window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section, host } }))
