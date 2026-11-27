import { SummaryDisclosureButton } from '@/components/summary-disclosure-button'
import { useLanguage } from '../../../i18n'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { CARET_CLASS } from '../styles'

/** "Worked for 35s": the run's steps fold into one line once it is done; the answer stays visible. */
export function TurnSummary({ label, children }: { label: string; children: React.ReactNode; sourceIndex?: number }) {
  useLanguage()
  const [open, setOpen] = useState(false)
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={open ? 'turn-summary flex flex-col open' : 'turn-summary flex flex-col'}
    >
      <CollapsibleTrigger render={<Marker render={<SummaryDisclosureButton />} />}>
        <MarkerContent className="flex-none text-muted-foreground">{label}</MarkerContent>
        <MarkerIcon>
          {open ? (
            <ChevronDown size={14} className={CARET_CLASS} />
          ) : (
            <ChevronRight size={14} className={CARET_CLASS} />
          )}
        </MarkerIcon>
      </CollapsibleTrigger>
      <CollapsibleContent className="turn-summary-panel [&[data-starting-style]]:h-0 [&[data-ending-style]]:h-0 [&[data-starting-style]]:opacity-0 [&[data-ending-style]]:opacity-0 h-[var(--collapsible-panel-height)] overflow-hidden motion-safe:[transition:height_200ms_var(--ease),opacity_160ms_var(--ease)]">
        <div className="turn-summary-body flex flex-col gap-3 pt-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * "Working for 12s" at the top of a turn still running, drawn as the summary it becomes: when the turn ends the same
 * line reads "Worked for 38s" and the steps under it fold, so nothing above the answer moves. It is a plain timer: the
 * working line at the end of the turn is the one that shimmers, and two moving lines would compete.
 */
export function TurnRunning({ label }: { label: string }) {
  useLanguage()
  return (
    <div className="turn-summary flex flex-col" role="status">
      <Marker render={<SummaryDisclosureButton tabIndex={-1} className="pointer-events-none" />}>
        <MarkerContent className="flex-none text-muted-foreground tabular-nums">{label}</MarkerContent>
      </Marker>
    </div>
  )
}
