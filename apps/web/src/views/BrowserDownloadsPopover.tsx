import type { ReactNode } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { t } from '../i18n'

export function BrowserDownloadsPopover({
  open,
  onOpenChange,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t('Downloads')} title={t('Downloads')} />
        }
      >
        <Download size={14} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)]">
        <PopoverTitle>{t('Downloads')}</PopoverTitle>
        <div className="max-h-80 overflow-auto text-caption">{children}</div>
      </PopoverContent>
    </Popover>
  )
}
