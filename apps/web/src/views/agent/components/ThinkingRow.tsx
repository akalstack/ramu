import { t as translate, useLanguage } from '../../../i18n'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/desktop-button'
import { Brain, ChevronRight } from 'lucide-react'
import { CARET_CLASS, TOOL_DISCLOSURE_PANEL_CLASS, TOOL_ICON_CLASS, TOOL_SUMMARY_CLASS } from '../styles'

/** Reasoning the provider shared; folded into the turn's work and open on demand. */
export function ThinkingRow({ text, active = false }: { text: string; active?: boolean }) {
  useLanguage()
  return (
    <Collapsible
      defaultOpen={active}
      className="thinking tool-group [&_>_[data-slot='collapsible-trigger']]:cursor-pointer [&_>_[data-slot='collapsible-trigger']]:[list-style:none] [&_>_[data-slot='collapsible-trigger']]:font-normal [&_>_[data-slot='collapsible-trigger']]:[transition:background_0.12s_var(--ease),_border-color_0.12s_var(--ease)] [&_>_[data-slot='collapsible-trigger']]:flex [&_>_[data-slot='collapsible-trigger']]:items-center [&_>_[data-slot='collapsible-trigger']]:justify-start [&_>_[data-slot='collapsible-trigger']]:gap-2 [&_>_[data-slot='collapsible-trigger']]:h-auto [&_>_[data-slot='collapsible-trigger']]:min-h-0 [&_>_[data-slot='collapsible-trigger']]:p-[3px_0] [&_>_[data-slot='collapsible-trigger']]:[border:0] [&_>_[data-slot='collapsible-trigger']]:[border-radius:0] [&_>_[data-slot='collapsible-trigger']]:bg-transparent [&_>_[data-slot='collapsible-trigger']]:text-muted-foreground [&_>_[data-slot='collapsible-trigger']]:text-chat [&_>_[data-slot='collapsible-trigger']::-webkit-details-marker]:hidden [&_>_[data-slot='collapsible-trigger']:hover]:bg-transparent [&_>_[data-slot='collapsible-trigger']:hover]:[border:0] [&_>_[data-slot='collapsible-trigger']:hover]:text-soft [&[data-open]_>_summary_.caret]:[transform:rotate(90deg)] [&[data-open]_>_summary]:bg-transparent [&[data-open]_>_summary]:[border:0] [&[data-open]_>_summary]:text-soft [&_>_[data-slot='collapsible-trigger']_.caret]:m-0 [&_>_[data-slot='collapsible-trigger']_.caret]:opacity-0 [&_>_[data-slot='collapsible-trigger']_.caret]:[transition:opacity_0.15s_var(--ease),_transform_0.15s_var(--ease)] text-control text-muted-foreground"
    >
      <CollapsibleTrigger render={<Button variant="ghost" />}>
        <Brain size={14} className={TOOL_ICON_CLASS} />
        <span className={TOOL_SUMMARY_CLASS}>{translate(active ? 'Thinking' : 'Thought')}</span>
        <ChevronRight size={12} className={CARET_CLASS} />
      </CollapsibleTrigger>
      <CollapsibleContent className={TOOL_DISCLOSURE_PANEL_CLASS}>
        <div className="thinking-body m-[2px_0_4px_20px] pl-2.5 [border-left:2px_solid_var(--line-strong)] text-muted-foreground text-control leading-[1.55] whitespace-pre-wrap [overflow-wrap:anywhere] max-h-[260px] overflow-auto">
          {text}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
