import { AppWindow, X } from 'lucide-react'
import type { InteractiveAttachment } from '@ramu/shared/interactive'
import { Button } from '@/components/desktop-button'
import { t, useLanguage } from '../i18n'

/** Interactive Content waiting to go out with the next message; × takes it off without touching the card. */
export function InteractiveAttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: InteractiveAttachment
  onRemove: () => void
}) {
  useLanguage()
  return (
    <span
      className="inline-flex h-6 max-w-[280px] min-w-0 items-center gap-1.5 rounded-(--radius-s) bg-hover pr-0.5 pl-2 text-caption"
      title={`${attachment.title} · v${attachment.version} · ${attachment.detail}`}
    >
      <AppWindow size={13} className="flex-none text-muted-foreground" aria-hidden />
      <span className="min-w-0 truncate">{attachment.title}</span>
      <span className="flex-none text-muted-foreground">v{attachment.version}</span>
      <Button
        variant="ghost"
        size="icon-xs"
        type="button"
        className="size-5 flex-none rounded-full"
        aria-label={t('Remove {0} from this message', { '0': attachment.title })}
        onClick={onRemove}
      >
        <X size={11} />
      </Button>
    </span>
  )
}
