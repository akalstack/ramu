import { useState } from 'react'
import { SquareTerminal, X } from 'lucide-react'
import { terminalAttachmentLabel, type TerminalAttachment } from '@ramu/shared/chat/terminalContext'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/desktop-button'
import { t, useLanguage } from '../i18n'

/**
 * Terminal output going out with a message, or that went out with one. A press shows the captured text, so the person
 * can check what the agent reads; × in the message box takes it off.
 */
export function TerminalAttachmentChip({
  attachment,
  onRemove,
  sent,
}: {
  attachment: Omit<TerminalAttachment, 'id'>
  onRemove?: () => void
  /** Under a sent message: quieter, and nothing to remove. */
  sent?: boolean
}) {
  useLanguage()
  const [open, setOpen] = useState(false)
  const label = terminalAttachmentLabel(attachment)
  return (
    <span
      className={`inline-flex h-6 max-w-[280px] min-w-0 items-center rounded-(--radius-s) text-caption ${sent ? 'bg-raised text-muted-foreground' : 'bg-hover'} ${onRemove ? 'pr-0.5' : ''}`}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="xs"
              type="button"
              className="h-6 min-w-0 gap-1.5 rounded-(--radius-s) bg-transparent px-2 text-caption font-normal hover:bg-transparent"
              aria-label={t('Terminal output, {0}', { '0': label })}
            />
          }
        >
          <SquareTerminal size={13} className="flex-none text-muted-foreground" aria-hidden />
          <span className={`min-w-0 truncate ${sent ? 'text-foreground' : ''}`}>{label}</span>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-[min(520px,calc(100vw-16px))] gap-2 p-3">
          <pre
            className="m-0 max-h-72 overflow-auto rounded-(--radius-s) bg-hover p-2.5 font-mono text-caption whitespace-pre text-soft"
            aria-label={t('Captured terminal output')}
            tabIndex={0}
          >
            {attachment.text}
          </pre>
          <div className="flex flex-wrap items-center justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard.writeText(attachment.text)}>
              {t('Copy')}
            </Button>
            {onRemove && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setOpen(false)
                  onRemove()
                }}
              >
                {t('Remove')}
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {onRemove && (
        <Button
          variant="ghost"
          size="icon-xs"
          type="button"
          className="size-5 flex-none rounded-full"
          aria-label={t('Remove {0} from this message', { '0': label })}
          onClick={onRemove}
        >
          <X size={11} />
        </Button>
      )}
    </span>
  )
}
