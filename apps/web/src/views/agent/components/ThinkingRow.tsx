import { t as translate, useLanguage } from '../../../i18n'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/desktop-button'
import { Brain, ChevronRight } from 'lucide-react'
import { thoughtLine } from '@ramu/shared/chat/thoughtLine'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MarkdownText } from '../../../chat/MarkdownText'
import { scrollMotion } from '../../../workspace/panelMotion'
import { useScrollFade } from '../hooks/useScrollFade'
import { formatDuration } from '../lib/format'
import { noteArrival, rehypeStreamWords, streamClock } from '../lib/streamWords'
import { WorkingText } from './WorkingText'
import { CARET_CLASS, TOOL_DISCLOSURE_PANEL_CLASS, TOOL_ICON_CLASS, TOOL_SUMMARY_CLASS } from '../styles'

/**
 * Reasoning the provider shared, as one row led by the brain icon: closed, the thought itself on a single line that
 * ends in an ellipsis (its newest paragraph, shimmering, while it streams) preceded by "Thought for 4s" once it took
 * a while; opened, the row is titled "Thought" (or "Thinking", "Thought for 4s") and the whole thought shows below as
 * markdown, new words fading in while it streams.
 */
export function ThinkingRow({ text, active = false }: { text: string; active?: boolean }) {
  useLanguage()
  const [open, setOpen] = useState(false)
  const startedAt = useRef<number | null>(active ? Date.now() : null)
  const [took, setTook] = useState<number | null>(null)
  const body = useScrollFade<HTMLDivElement>()
  const line = useMemo(() => thoughtLine(text, active), [text, active])
  const clock = useRef(streamClock(text))
  noteArrival(clock.current, text)
  const rehypePlugins = useMemo(() => [rehypeStreamWords(clock.current)], [])
  useEffect(() => {
    if (active) {
      startedAt.current ??= Date.now()
    } else if (startedAt.current !== null) {
      setTook(Date.now() - startedAt.current)
      startedAt.current = null
    }
  }, [active])
  const longThought = took !== null && took >= 1000
  const title = active
    ? translate('Thinking')
    : longThought
      ? translate('Thought for {0}', { '0': formatDuration(took) })
      : translate('Thought')
  // Follow the newest line while thinking streams.
  useLayoutEffect(() => {
    const el = body.current
    if (active && el) el.scrollTo({ top: el.scrollHeight, behavior: scrollMotion() })
  }, [text, active, body])
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="thinking tool-group [&_>_[data-slot='collapsible-trigger']]:cursor-pointer [&_>_[data-slot='collapsible-trigger']]:[list-style:none] [&_>_[data-slot='collapsible-trigger']]:font-normal [&_>_[data-slot='collapsible-trigger']]:[transition:background_0.12s_var(--ease),_border-color_0.12s_var(--ease)] [&_>_[data-slot='collapsible-trigger']]:flex [&_>_[data-slot='collapsible-trigger']]:items-center [&_>_[data-slot='collapsible-trigger']]:justify-start [&_>_[data-slot='collapsible-trigger']]:gap-2 [&_>_[data-slot='collapsible-trigger']]:h-auto [&_>_[data-slot='collapsible-trigger']]:min-h-0 [&_>_[data-slot='collapsible-trigger']]:p-[3px_0] [&_>_[data-slot='collapsible-trigger']]:[border:0] [&_>_[data-slot='collapsible-trigger']]:[border-radius:0] [&_>_[data-slot='collapsible-trigger']]:bg-transparent [&_>_[data-slot='collapsible-trigger']]:text-muted-foreground [&_>_[data-slot='collapsible-trigger']]:text-chat [&_>_[data-slot='collapsible-trigger']::-webkit-details-marker]:hidden [&_>_[data-slot='collapsible-trigger']:hover]:bg-transparent [&_>_[data-slot='collapsible-trigger']:hover]:[border:0] [&_>_[data-slot='collapsible-trigger']:hover]:text-soft [&[data-open]_>_summary_.caret]:[transform:rotate(90deg)] [&[data-open]_>_summary]:bg-transparent [&[data-open]_>_summary]:[border:0] [&[data-open]_>_summary]:text-soft [&_>_[data-slot='collapsible-trigger']_.caret]:m-0 [&_>_[data-slot='collapsible-trigger']_.caret]:opacity-0 [&_>_[data-slot='collapsible-trigger']_.caret]:[transition:opacity_0.15s_var(--ease),_transform_0.15s_var(--ease)] text-control text-muted-foreground"
    >
      {/* Full width, so a streaming thought ends in an ellipsis at the column's edge instead of overflowing it. */}
      <CollapsibleTrigger render={<Button variant="ghost" className="w-full min-w-0" />}>
        <Brain size={14} className={TOOL_ICON_CLASS} />
        {/* Not a tool-summary: a tool group shrinks those, and this label must always read in full. Open, the row is
            titled, since the thought itself has moved below it; closed, the thought's own line says what it is. */}
        {open || (!active && longThought) ? (
          <span className="flex-none whitespace-nowrap font-sans text-chat text-inherit">{title}</span>
        ) : (
          <span className="sr-only">{title}</span>
        )}
        {!open && line && (
          <span className={`${TOOL_SUMMARY_CLASS} thinking-line text-muted-foreground`}>
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
          rehypePlugins={active ? rehypePlugins : undefined}
        >
          {text}
        </MarkdownText>
      </CollapsibleContent>
    </Collapsible>
  )
}
