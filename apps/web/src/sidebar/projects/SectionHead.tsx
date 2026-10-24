import { SidebarDisclosureButton } from '@/components/sidebar-disclosure-button'
import { ChevronDown, type LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

/** A compact section landmark with a persistent disclosure cue and optional item count. */
export function SectionHead({
  title,
  icon: Icon,
  count,
  open,
  onToggle,
  controls,
  children,
}: {
  title: string
  icon?: LucideIcon
  count?: number
  open: boolean
  onToggle: () => void
  controls: string
  children?: React.ReactNode
}) {
  return (
    <div className="section-head group/head flex min-h-8 items-center justify-between gap-2 px-2 pb-1 pt-3 first:pt-1 text-caption font-medium text-muted-foreground">
      <SidebarDisclosureButton
        className="w-auto p-0 text-[length:var(--font-caption)]"
        aria-expanded={open}
        aria-controls={controls}
        onClick={onToggle}
      >
        {Icon && <Icon size={13} className="flex-none" aria-hidden="true" />}
        <span className="truncate">{title}</span>
        {count !== undefined && (
          <Badge variant="secondary" className="tabular-nums">
            {count}
          </Badge>
        )}
        <ChevronDown
          size={12}
          aria-hidden="true"
          className={`flex-none transition-transform ${open ? '' : '-rotate-90'}`}
        />
      </SidebarDisclosureButton>
      {children}
    </div>
  )
}
