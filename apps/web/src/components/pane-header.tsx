import type { ReactNode } from 'react'
import { cn } from 'cn'

/** VS Code style pane header: uppercase underlined title on the left, icon actions on the right. */
export function PaneHeader({ title, children, actions, className, ariaLabel }: { title: ReactNode; children?: ReactNode; actions?: ReactNode; className?: string; ariaLabel?: string }) {
  return <header className={cn('pane-header flex items-stretch flex-none h-[35px] pr-1.5 pl-3 gap-1 [border-bottom:1px_solid_var(--line)]', className)}>
    <span className="pane-header-title flex items-center h-full mr-2 border-b border-foreground text-[11px] font-medium uppercase tracking-wide text-foreground select-none">{title}</span>
    {children}
    <div className="grow flex-1 min-w-0" />
    {actions && <div className="flex items-center gap-0.5" role="toolbar" aria-label={ariaLabel}>{actions}</div>}
  </header>
}

/** Shared class for compact ghost icon buttons inside a PaneHeader. */
export const paneActionClass = 'ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact) self-center'
