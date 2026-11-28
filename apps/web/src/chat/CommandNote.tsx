import { ChevronRight, OctagonX, SquareTerminal } from 'lucide-react'
import { commandLine } from '@ramu/shared/chat/commandLine'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChatActivityButton } from './ChatActivity'
import { t, useLanguage } from '../i18n'
import { RepeatCount } from '../views/agent/components/RepeatCount'

/**
 * A background command that finished, failed or was asked to stop, as a goal's note reads: its icon, what happened, the
 * command's first line beside it, and the whole command when opened. On the phone it reads the same.
 */
export function CommandNote({
  command,
  state,
  repeats,
}: {
  command: string
  state: 'finished' | 'failed' | 'stop'
  repeats?: number
}) {
  useLanguage()
  const Icon = state === 'stop' ? OctagonX : SquareTerminal
  const label =
    state === 'stop'
      ? t('Stop requested')
      : state === 'failed'
        ? t('Background command failed')
        : t('Background command finished')
  return (
    <Collapsible className="command-note chat-activity-disclosure" aria-label={label} role="status">
      <CollapsibleTrigger render={<ChatActivityButton />}>
        <Icon size={14} className={`flex-none ${state === 'failed' ? 'text-bad' : 'text-muted-foreground'}`} />
        <span className="tool-group-label text-[length:inherit]">{label}</span>
        <span
          className="chat-activity-meta flex-initial min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono"
          title={command}
        >
          {commandLine(command)}
        </span>
        <RepeatCount count={repeats} />
        <ChevronRight
          size={14}
          className="caret flex-none text-muted-foreground [transition:transform_0.15s_var(--ease)] [[data-open]>_[data-slot='collapsible-trigger']_&]:[transform:rotate(90deg)]"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="tool-disclosure-panel [&[data-starting-style]]:h-0 [&[data-ending-style]]:h-0 h-[var(--collapsible-panel-height)] overflow-hidden [transition:height_160ms_var(--ease)]">
        <pre className="m-0 ml-[22px] max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-(--radius-s) bg-(--code-bg) p-[8px_12px] font-mono text-caption text-soft">
          {command}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  )
}
