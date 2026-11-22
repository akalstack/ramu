import { Button } from '@/components/desktop-button'
import { t, useLanguage } from '../i18n'

export type CustomizeSection = 'plugins' | 'skills' | 'mcp'

/** Opens Customize on a section from anywhere, such as a thread's "Set up a 3D service" or a Settings link. */
export const CUSTOMIZE_EVENT = 'ramu:customize'
/** What a Customize link asks for: a section, and optionally one plugin or MCP server in it opened on its details. */
export interface CustomizeTarget {
  section: CustomizeSection
  /** A plugin's id in Plugins, or an MCP connection's id in MCP servers. */
  item?: string
  /** A listed plugin to open the install review of, in Plugins. */
  install?: { index: string; name: string }
}
/** Opens Plugins on the install review of one listed plugin, such as a recommended MCP server's fuller plugin. */
export function reviewPluginInstall(index: string, name: string) {
  window.dispatchEvent(
    new CustomEvent<CustomizeTarget>(CUSTOMIZE_EVENT, { detail: { section: 'plugins', install: { index, name } } }),
  )
}
export function openCustomize(section: CustomizeSection, item?: string) {
  window.dispatchEvent(
    new CustomEvent<CustomizeTarget>(CUSTOMIZE_EVENT, { detail: { section, ...(item ? { item } : {}) } }),
  )
}

/** A pointer from Settings to the Customize section that holds these: one line and the way there. */
export function MovedToCustomize({ section, text }: { section: CustomizeSection; text: string }) {
  useLanguage()
  return (
    <div className="mt-5 flex items-center justify-between gap-3 rounded-(--radius-m) bg-fill px-3 py-2.5">
      <span className="text-control text-soft">{text}</span>
      <Button size="sm" variant="secondary" onClick={() => openCustomize(section)}>
        {t('Open Customize')}
      </Button>
    </div>
  )
}
