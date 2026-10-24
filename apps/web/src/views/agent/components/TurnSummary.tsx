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
      <CollapsibleContent className="turn-summary-panel [&[data-starting-style]]:h-0 [&[data-ending-style]]:h-0 h-[var(--collapsible-panel-height)] overflow-hidden motion-safe:[transition:height_200ms_var(--ease)]">
        <div className="turn-summary-body flex flex-col gap-3 pt-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}
