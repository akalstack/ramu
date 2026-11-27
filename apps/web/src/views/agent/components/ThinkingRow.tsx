import { t as translate, useLanguage } from '../../../i18n'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/desktop-button'
import { Brain, ChevronRight } from 'lucide-react'
import { NEW_THOUGHT, thoughtBlock, thoughtLine, thoughtTitle, tickThought } from '@ramu/shared/chat/thoughtLine'
import { useChatFade } from '../../../chat/ChatMotion'
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { MarkdownText } from '../../../chat/MarkdownText'
import { scrollMotion } from '../../../workspace/panelMotion'
import { useScrollFade } from '../hooks/useScrollFade'
import { formatDuration } from '../lib/format'
import { WorkingText } from './WorkingText'
import {
  CARET_CLASS,
  DISCLOSURE_ROW_CLASS,
  TOOL_DISCLOSURE_PANEL_CLASS,
  TOOL_ICON_CLASS,
  TOOL_SUMMARY_CLASS,
} from '../styles'

/**
 * Reasoning the provider shared, as one row led by the brain icon: closed, the thought itself on a single line that
 * ends in an ellipsis (its newest paragraph, shimmering, while it streams) preceded by "Thought for 4s" once it took
 * a while; opened, the row is titled "Thought" (or "Thinking", "Thought for 4s") and the whole thought shows below as
 * markdown, each new block fading in while it streams.
 */
export function ThinkingRow({ text, active = false }: { text: string; active?: boolean }) {
  useLanguage()
  const [open, setOpen] = useState(false)
  const [timing, setTiming] = useState(() => tickThought(NEW_THOUGHT, active, Date.now()))
  const body = useScrollFade<HTMLDivElement>()
  const line = useMemo(() => thoughtLine(text, active), [text, active])
  // The closed line moves on a paragraph at a time while it streams, each one fading in as a reply's blocks do.
  const lineFade = useChatFade<HTMLSpanElement>(active ? String(thoughtBlock(text)) : '')
  useEffect(() => setTiming((current) => tickThought(current, active, Date.now())), [active])
  const heading = thoughtTitle(active, timing.took)
  const longThought = heading.label === 'Thought for {0}'
  const title =
    heading.label === 'Thought for {0}'
      ? translate(heading.label, { '0': formatDuration(heading.took) })
      : translate(heading.label)
  // Follow the newest line while thinking streams.
  useLayoutEffect(() => {
    const el = body.current
    if (active && el) el.scrollTo({ top: el.scrollHeight, behavior: scrollMotion() })
  }, [text, active, body])
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={`thinking ${DISCLOSURE_ROW_CLASS}`}>
      {/* Full width, so a streaming thought ends in an ellipsis at the column's edge instead of overflowing it. */}
      <CollapsibleTrigger render={<Button variant="ghost" className="w-full min-w-0" />}>
        <Brain size={14} className={TOOL_ICON_CLASS} />
        {/* Not a tool-summary: a tool group shrinks those, and this label must always read in full. Open, the row is
            titled, since the thought itself has moved below it; closed, the thought's own line says what it is. */}
        {/* A thought still on its first paragraph has no line of its own yet, so the row says "Thinking". */}
        {open || longThought || !line ? (
          <span className="flex-none whitespace-nowrap font-sans text-chat text-inherit">{title}</span>
        ) : (
          <span className="sr-only">{title}</span>
        )}
        {!open && line && (
          <span ref={lineFade} className={`${TOOL_SUMMARY_CLASS} thinking-line text-muted-foreground`}>
            {active ? <WorkingText>{line}</WorkingText> : line}
          </span>
        )}
        <ChevronRight size={12} className={CARET_CLASS} />
      </CollapsibleTrigger>
      <CollapsibleContent className={TOOL_DISCLOSURE_PANEL_CLASS}>
        <MarkdownText
          ref={body}
          density="compact"
          className="thinking-body fade-scroll [--fade-top:0px] [--fade-bottom:0px] [mask-image:linear-gradient(to_bottom,_transparent_0,_#000_var(--fade-top),_#000_calc(100%_-_var(--fade-bottom)),_transparent_100%)] [transition:--fade-top_0.14s_ease-out,_--fade-bottom_0.14s_ease-out] m-[2px_0_4px] text-muted-foreground [overflow-wrap:anywhere] overflow-y-auto [&_:is(strong,h1,h2,h3,h4,h5,h6)]:text-soft [&_:not(pre)>code]:text-inherit max-h-[260px]"
          streaming={active}
        >
          {text}
        </MarkdownText>
      </CollapsibleContent>
    </Collapsible>
  )
}
