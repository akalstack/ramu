import { Button } from '@/components/desktop-button'
import { t, useLanguage } from '../i18n'

export type CustomizeSection = 'plugins' | 'skills' | 'mcp'

/** Opens Customize on a section from anywhere, such as a thread's "Set up a 3D service" or Settings' old links. */
export const CUSTOMIZE_EVENT = 'ramu:customize'
export function openCustomize(section: CustomizeSection) {
  window.dispatchEvent(new CustomEvent(CUSTOMIZE_EVENT, { detail: { section } }))
}

/** Where Settings used to keep plugins, skills and MCP servers: one line and the way there. */
export function MovedToCustomize({ section, text }: { section: CustomizeSection; text: string }) {
  useLanguage()
  return (
    <div className="flex items-center justify-between gap-3 rounded-(--radius-m) bg-fill px-3 py-2.5">
      <span className="text-control text-soft">{text}</span>
      <Button size="sm" variant="secondary" onClick={() => openCustomize(section)}>
        {t('Open Customize')}
      </Button>
    </div>
  )
}
