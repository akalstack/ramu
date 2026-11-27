import { BellRing, ChevronRight } from 'lucide-react'
import type { MessageOrigin } from '@ramu/shared/types'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/desktop-button'
import { t, useLanguage } from '../../../i18n'
import { MarkdownText } from '../../../chat/MarkdownText'
import {
  CARET_CLASS,
  DISCLOSURE_ROW_CLASS,
  TOOL_DISCLOSURE_PANEL_CLASS,
  TOOL_ICON_CLASS,
  TOOL_SUMMARY_CLASS,
} from '../styles'

/**
 * A message Ramu sent the thread by itself (a check failed, a review came, a site answers again), drawn as the rows
 * around it are: what happened on one line, and opened, the message the agent read.
 */
export function RamuEventRow({ from }: { from: Extract<MessageOrigin, { kind: 'ramu' }> }) {
  useLanguage()
  return (
    <Collapsible className={`ramu-event ${DISCLOSURE_ROW_CLASS}`}>
      <CollapsibleTrigger render={<Button variant="ghost" className="w-full min-w-0" />}>
        <BellRing size={14} className={TOOL_ICON_CLASS} />
        <span className={TOOL_SUMMARY_CLASS}>{t(from.title, from.values)}</span>
        <ChevronRight size={12} className={CARET_CLASS} />
      </CollapsibleTrigger>
      {from.detail && (
        <CollapsibleContent className={TOOL_DISCLOSURE_PANEL_CLASS}>
          <MarkdownText density="compact" className="max-h-[360px] overflow-y-auto">
            {from.detail}
          </MarkdownText>
        </CollapsibleContent>
      )}
    </Collapsible>
  )
}
