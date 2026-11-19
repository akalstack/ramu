import { useEffect, useState } from 'react'
import { BookOpen, Puzzle, Server } from 'lucide-react'
import { RowButton } from '@/components/row-button'
import { t, useLanguage } from '../i18n'
import { McpSection } from './McpSection'
import { PluginsSection } from './PluginsSection'
import { SkillsSection } from './SkillsSection'
import { CUSTOMIZE_EVENT, type CustomizeSection, type CustomizeTarget } from './openCustomize'

const SECTIONS: { id: CustomizeSection; label: string; Icon: typeof Puzzle }[] = [
  { id: 'plugins', label: 'Plugins', Icon: Puzzle },
  { id: 'skills', label: 'Skills', Icon: BookOpen },
  { id: 'mcp', label: 'MCP servers', Icon: Server },
]

/**
 * Customize: what agents can use beyond their own model, in one place: plugins, skills and MCP servers, each with what
 * is installed and what to add, recommended first.
 */
export function CustomizePage({ initial = { section: 'plugins' } }: { initial?: CustomizeTarget }) {
  useLanguage()
  const [section, setSection] = useState<CustomizeSection>(initial.section)
  // The plugin or server a link asked to open; a new object each time, so asking for the same one again reopens it.
  const [item, setItem] = useState<{ id: string } | null>(initial.item ? { id: initial.item } : null)
  const [install, setInstall] = useState<{ index: string; name: string } | null>(initial.install ?? null)
  useEffect(() => {
    const show = (event: Event) => {
      const next = (event as CustomEvent<CustomizeTarget | undefined>).detail
      if (!next?.section) return
      setSection(next.section)
      setItem(next.item ? { id: next.item } : null)
      setInstall(next.install ? { ...next.install } : null)
    }
    window.addEventListener(CUSTOMIZE_EVENT, show)
    return () => window.removeEventListener(CUSTOMIZE_EVENT, show)
  }, [])
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <nav
        aria-label={t('Customize')}
        className="flex w-52 flex-none flex-col gap-0.5 border-r border-line p-3 max-[760px]:w-14 max-[760px]:px-2"
      >
        <h2 className="m-0 px-2 pt-1 pb-3 text-control font-semibold text-foreground max-[760px]:sr-only">
          {t('Customize')}
        </h2>
        {SECTIONS.map(({ id, label, Icon }) => (
          <RowButton
            key={id}
            size="sm"
            aria-current={section === id ? 'page' : undefined}
            aria-pressed={section === id}
            title={t(label)}
            className="gap-2.5 rounded-(--radius-s) px-2 aria-[current=page]:text-foreground"
            onClick={() => setSection(id)}
          >
            <Icon size={15} className="flex-none" aria-hidden />
            <span className="truncate max-[760px]:sr-only">{t(label)}</span>
          </RowButton>
        ))}
      </nav>
      <div className="@container min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[920px] px-6 py-6">
          {section === 'plugins' && <PluginsSection open={item} install={install} />}
          {section === 'skills' && <SkillsSection onOpenPlugins={() => setSection('plugins')} />}
          {section === 'mcp' && <McpSection open={item} />}
        </div>
      </div>
    </div>
  )
}
