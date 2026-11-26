import { useEffect } from 'react'
import { Pencil, X } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { t as translate, useLanguage } from '../../../i18n'
import { ICON_BUTTON_CLASS } from '../styles'

/**
 * Says the message box holds a queued message or a waiting steer being changed, so Save replaces it instead of sending
 * another. Escape anywhere in the chat cancels, like the inline editor it replaces.
 */
export function QueuedEditChip({ kind, onCancel }: { kind: 'queued' | 'steer'; onCancel: () => void }) {
  useLanguage()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  return (
    <span
      role="status"
      className="m-[4px_0_8px] inline-flex min-w-0 items-center gap-1.5 self-start rounded-(--radius-s) bg-hover py-1 pr-1 pl-2.5 text-control text-soft"
    >
      <Pencil size={13} className="flex-none text-primary" aria-hidden="true" />
      <span className="truncate">
        {kind === 'steer' ? translate('Editing a steering message') : translate('Editing a queued message')}
      </span>
      <span className="text-muted-foreground">· {translate('held until you save')}</span>
      <Button
        variant="ghost"
        size="icon-xs"
        className={ICON_BUTTON_CLASS}
        aria-label={translate('Cancel editing')}
        title={translate('Cancel editing (Esc)')}
        onClick={onCancel}
      >
        <X size={13} />
      </Button>
    </span>
  )
}
