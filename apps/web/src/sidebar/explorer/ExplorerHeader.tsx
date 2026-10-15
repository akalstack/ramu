import { FilePlus, FolderPlus, ListCollapse, RefreshCw } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { t, useLanguage } from '../../i18n'
import { ICON_BUTTON_CLASS } from './constants'

function HeaderButton({
  title,
  label,
  onClick,
  children,
}: {
  title: string
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className={ICON_BUTTON_CLASS}
      title={title}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

/** Panel header: create, refresh and collapse act on the tree used last through window events. */
export function ExplorerHeader() {
  useLanguage()
  return (
    <header className="panel-title text-chat font-semibold tracking-[-0.01em] text-foreground m-[4px_0_8px] overflow-hidden text-ellipsis whitespace-nowrap explorer-title [&_.icon]:w-[var(--action-size)] [&_.icon]:h-[var(--action-size)] [&_.icon_>_svg]:w-[var(--icon-size)] [&_.icon_>_svg]:h-[var(--icon-size)] flex items-center gap-1">
      <span className="grow flex-1 min-w-0 text-left" />
      <HeaderButton
        title={t('New file')}
        label={t('New file')}
        onClick={() => window.dispatchEvent(new CustomEvent('ramu:explorer-new', { detail: 'file' }))}
      >
        <FilePlus size={14} />
      </HeaderButton>
      <HeaderButton
        title={t('New folder')}
        label={t('New folder')}
        onClick={() => window.dispatchEvent(new CustomEvent('ramu:explorer-new', { detail: 'dir' }))}
      >
        <FolderPlus size={14} />
      </HeaderButton>
      <HeaderButton
        title={t('Refresh explorer')}
        label={t('Refresh explorer')}
        onClick={() => window.dispatchEvent(new Event('ramu:refresh-explorer'))}
      >
        <RefreshCw size={14} />
      </HeaderButton>
      <HeaderButton
        title={t('Collapse folders')}
        label={t('Collapse explorer folders')}
        onClick={() => window.dispatchEvent(new Event('ramu:collapse-explorer'))}
      >
        <ListCollapse size={14} />
      </HeaderButton>
    </header>
  )
}
