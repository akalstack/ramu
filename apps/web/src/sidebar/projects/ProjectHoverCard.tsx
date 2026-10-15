import { FolderClosed, MessageCircle } from 'lucide-react'
import { HoverCardContent } from '@/components/ui/hover-card'
import type { Project } from '@ramu/shared/types'
import { t, useLanguage } from '../../i18n'

/** Details for a project, shown to the right of the sidebar after a short hover; it stays open while the pointer is on it. */
export function ProjectHoverCard({
  project,
  folders,
  chats,
}: {
  project: Project
  folders: { id: string; name: string; root: string }[]
  chats: number
}) {
  useLanguage()
  return (
    <HoverCardContent
      side="right"
      align="start"
      sideOffset={6}
      alignOffset={-4}
      className="project-hover-card relative z-1200 w-[320px] max-w-[calc(100vw_-_24px)] p-1.5 [border:1px_solid_var(--edge)] rounded-(--radius-m) [background:color-mix(in_srgb,_var(--raised)_94%,_transparent)] [backdrop-filter:blur(14px)] [box-shadow:0_10px_32px_rgba(0,_0,_0,_0.45)] text-control [animation:fade-only_0.12s_ease-out]"
    >
      <div className="phc-title [&_strong]:font-semibold [&_strong]:overflow-hidden [&_strong]:text-ellipsis [&_strong]:whitespace-nowrap [&_svg]:flex-none [&_svg]:text-muted-foreground flex items-center gap-[9px] min-h-[26px] p-[0_8px]">
        <FolderClosed size={15} />
        <strong>{project.name}</strong>
      </div>
      <div className="phc-line [&_svg]:flex-none [&_svg]:text-muted-foreground flex items-center gap-[9px] min-h-[26px] p-[0_8px] muted text-muted-foreground">
        <MessageCircle size={14} />
        {chats} {chats === 1 ? t('chat') : t('chats')}
      </div>
      <div className="phc-sep h-px m-[5px_2px] [background:var(--line)]" />
      {(folders.length
        ? folders.map((f) => ({ key: f.id, name: f.name, root: f.root }))
        : project.root
          ? [{ key: 'root', name: project.name, root: project.root }]
          : []
      ).map((f) => (
        <div
          key={f.key}
          className="phc-folder flex items-center gap-[9px] min-h-[26px] p-[0_8px] [&_svg]:flex-none [&_svg]:text-muted-foreground [&_span]:[overflow-wrap:anywhere] [&_span]:leading-[1.4] [&_span]:text-caption items-start pt-[5px] pb-[5px] text-soft"
          title={f.root}
        >
          <FolderClosed size={14} />
          <span>{f.root}</span>
        </div>
      ))}
    </HoverCardContent>
  )
}
