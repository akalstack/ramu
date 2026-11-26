import type { ComponentProps, ReactNode } from 'react'
import { ChevronDown, LoaderCircle } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/desktop-button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { t } from '../i18n'
import { useSteadySpin } from '../lib/steadyActivity'
import { useInTrayStack, useTraySection } from './TrayStack'

/** The same thin arc the sidebar marks a working thread with, so "working" reads one way everywhere. */
function LiveMark() {
  const ref = useSteadySpin<SVGSVGElement>()
  return <LoaderCircle ref={ref} aria-hidden className="composer-tray-live animate-spin" />
}

/**
 * One accessible disclosure treatment for questions, goals, the message queue and live work.
 *
 * Inside a `TrayStack` the section is a chip in the tray's row; opening it shows its card above the row, over the
 * conversation, so nothing under the composer moves. Elsewhere it is a full-width row that opens in place.
 */
export function ComposerTraySection({
  title,
  chip,
  live = false,
  icon,
  count,
  actions,
  children,
  className,
  open: controlled,
  defaultOpen,
  onOpenChange,
  ...props
}: Omit<ComponentProps<typeof Collapsible>, 'title' | 'onOpenChange'> & {
  title: ReactNode
  /** A shorter name for the chip when the title is long, such as a goal's status without its objective. */
  chip?: ReactNode
  /** The work is happening right now, such as an agent driving the browser; the chip shows the working mark. */
  live?: boolean
  icon: ReactNode
  /** How many items the section holds, shown after the title as "Title · 3". */
  count?: number
  actions?: ReactNode
  onOpenChange?: (open: boolean) => void
}) {
  // A section whose caller does not hold its state takes the stack's, so opening it closes the stack's other one.
  const [stacked, setStacked] = useTraySection(defaultOpen ?? false)
  const inStack = useInTrayStack()
  const open = controlled ?? stacked
  const setOpen = (next: boolean) => {
    if (controlled === undefined) setStacked(next)
    onOpenChange?.(next)
  }
  const label = (text: ReactNode) => (
    <span className="composer-tray-title">
      {text}
      {count !== undefined && (
        <>
          <span aria-hidden className="composer-tray-count-dot">
            ·
          </span>
          <span className="composer-tray-count">{count}</span>
        </>
      )}
    </span>
  )
  if (inStack)
    return (
      <Collapsible
        className={cn('composer-tray-section composer-tray-chip', className)}
        open={open}
        onOpenChange={setOpen}
        {...props}
      >
        <CollapsibleTrigger render={<Button variant="ghost" />} className="composer-tray-chip-trigger">
          {icon}
          {label(chip ?? title)}
          {live && <LiveMark />}
        </CollapsibleTrigger>
        <CollapsibleContent
          keepMounted
          className="composer-tray-card"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.stopPropagation()
            setOpen(false)
          }}
        >
          <div className="composer-tray-header">
            <span className="composer-tray-card-title">
              {icon}
              {label(title)}
            </span>
            {actions && <div className="composer-tray-actions">{actions}</div>}
            <Button
              variant="ghost"
              size="icon-xs"
              className="icon small-icon composer-tray-close"
              aria-label={t('Close')}
              title={t('Close')}
              onClick={() => setOpen(false)}
            >
              <ChevronDown />
            </Button>
          </div>
          <div className="composer-tray-details">{children}</div>
        </CollapsibleContent>
      </Collapsible>
    )
  return (
    <Collapsible className={cn('composer-tray-section', className)} open={open} onOpenChange={setOpen} {...props}>
      <div className="composer-tray-header">
        <CollapsibleTrigger render={<Button variant="ghost" />} className="composer-tray-trigger">
          {icon}
          {label(title)}
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

/**
 * A tray section's list of rows: it scrolls once it is taller than a few rows. The rows keep their own height, since a
 * flex column would otherwise squeeze two-line rows into each other instead of scrolling.
 */
export const TRAY_LIST_CLASS =
  'my-0 -mx-1.5 flex max-h-40 list-none flex-col gap-0.5 overflow-y-auto overscroll-contain p-0 [&>li]:flex-none'
