import { PanelRightClose } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { t } from '../i18n'

export function HideWorkspaceButton({ onHide }: { onHide: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="flex-none text-muted-foreground hover:text-foreground"
      aria-label={t('Hide workspace')}
      title={t('Hide workspace')}
      onClick={onHide}
    >
      <PanelRightClose data-icon="inline-start" />
    </Button>
  )
}
