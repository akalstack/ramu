import type { ComponentProps, ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/desktop-button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

/** One accessible disclosure treatment for questions, goals and the message queue. */
export function ComposerTraySection({
  title,
  icon,
  actions,
  children,
  className,
  ...props
}: Omit<ComponentProps<typeof Collapsible>, 'title'> & {
  title: ReactNode
  icon: ReactNode
  actions?: ReactNode
}) {
  return (
    <Collapsible className={cn('composer-tray-section', className)} {...props}>
      <div className="composer-tray-header">
        <CollapsibleTrigger render={<Button variant="ghost" />} className="composer-tray-trigger">
          {icon}
          <span className="composer-tray-title">{title}</span>
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
