import type { ComponentProps, ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/desktop-button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useTraySection } from './TrayStack'

/** One accessible disclosure treatment for questions, goals, the message queue and live work. */
export function ComposerTraySection({
  title,
  icon,
  count,
  actions,
  children,
  className,
  open: controlled,
  defaultOpen,
  onOpenChange,
  ...props
}: Omit<ComponentProps<typeof Collapsible>, 'title'> & {
  title: ReactNode
  icon: ReactNode
  /** How many items the section holds, shown after the title as "Title · 3". */
  count?: number
  actions?: ReactNode
}) {
  // A section whose caller does not hold its state takes the stack's, so opening it closes the stack's other one.
  const [stacked, setStacked] = useTraySection(defaultOpen ?? false)
  return (
    <Collapsible
      className={cn('composer-tray-section', className)}
      open={controlled ?? stacked}
      onOpenChange={(open, details) => {
        if (controlled === undefined) setStacked(open)
        onOpenChange?.(open, details)
      }}
      {...props}
    >
      <div className="composer-tray-header">
        <CollapsibleTrigger render={<Button variant="ghost" />} className="composer-tray-trigger">
          {icon}
          <span className="composer-tray-title">
            {title}
            {count !== undefined && (
              <>
                <span aria-hidden className="composer-tray-count-dot">
                  ·
                </span>
                <span className="composer-tray-count">{count}</span>
              </>
            )}
          </span>
          <ChevronDown className="composer-tray-chevron" />
        </CollapsibleTrigger>
        {actions && <div className="composer-tray-actions">{actions}</div>}
      </div>
      <CollapsibleContent keepMounted className="composer-tray-panel">
        <div className="composer-tray-details">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
