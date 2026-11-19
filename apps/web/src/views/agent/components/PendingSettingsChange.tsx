import { t as translate } from '../../../i18n'
import { ArrowRightLeft, RotateCcw, Settings2 } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import type { AgentSettings } from '@ramu/shared/types'
import { CONVERSATION_SEPARATOR_CLASS } from '../styles'
import { SettingsChange, SwitchBackLabel } from './SettingsChange'

/**
 * A model change waiting for the next message, drawn at the end of the chat like the separator it becomes once sent.
 * Another provider hands the conversation over, so it reads "Context handoff".
 */
export function PendingSettingsChange({
  next,
  previous,
  onCancel,
}: {
  next: AgentSettings
  previous: AgentSettings
  onCancel: () => void
}) {
  const handoff = next.provider !== previous.provider
  const Icon = handoff ? ArrowRightLeft : Settings2
  return (
    <div className={CONVERSATION_SEPARATOR_CLASS} data-pending-settings>
      <span className="min-w-0">
        <span className="inline-flex min-w-0 flex-wrap items-center justify-center gap-x-2 gap-y-1">
          <Icon size={14} className="flex-none" aria-hidden="true" />
          {translate(handoff ? 'Context handoff' : 'Settings changed')}
          <SettingsChange next={next} previous={previous} />
          <Button
            variant="ghost"
            size="icon-xs"
            className="separator-action size-[22px] min-h-[22px] p-0 text-soft"
            title={translate('Cancel the change and keep the current model')}
            onClick={onCancel}
          >
            <RotateCcw size={13} aria-hidden="true" />
            <span className="sr-only">
              <SwitchBackLabel previous={previous} next={next} />
            </span>
          </Button>
        </span>
        <small>{translate('Applies when you send your next message')}</small>
      </span>
    </div>
  )
}
