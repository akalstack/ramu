import { Copy, CopyPlus, ExternalLink, Globe, Plus, RotateCw, X, XCircle } from 'lucide-react'
import { useState } from 'react'
import { browserFaviconFrom } from '@ramu/shared/browserLinks'
import type { BrowserTabInfo } from '@ramu/shared/types/browser'
import { t, useLanguage } from '../i18n'
import { copyText } from '../ipc'
import { useContextMenu, type MenuEntry } from '../Menu'

export interface BrowserTabActions {
  select(tab: BrowserTabInfo): void
  close(tab: BrowserTabInfo): void
  closeOthers(tab: BrowserTabInfo): void
  closeToRight(tab: BrowserTabInfo): void
  duplicate(tab: BrowserTabInfo): void
  reload(tab: BrowserTabInfo): void
  openExternal(tab: BrowserTabInfo): void
  newTab(): void
}

/** One tab of the thread's browser. Right-click offers what a browser's tab menu does; middle-click closes. */
export function BrowserTabChip({
  tab,
  index,
  count,
  active,
  disabled,
  actions,
}: {
  tab: BrowserTabInfo
  index: number
  count: number
  active: boolean
  disabled: boolean
  actions: BrowserTabActions
}) {
  useLanguage()
  const items: MenuEntry[] = [
    {
      key: 'new',
      label: (
        <>
          <Plus size={14} /> {t('New tab')}
        </>
      ),
      onSelect: actions.newTab,
    },
    { key: 'sep1', separator: true },
    {
      key: 'reload',
      label: (
        <>
          <RotateCw size={14} /> {t('Reload')}
        </>
      ),
      disabled: !tab.inputReady,
      onSelect: () => actions.reload(tab),
    },
    {
      key: 'duplicate',
      label: (
        <>
          <CopyPlus size={14} /> {t('Duplicate')}
        </>
      ),
      onSelect: () => actions.duplicate(tab),
    },
    { key: 'sep2', separator: true },
    {
      key: 'copy',
      label: (
        <>
          <Copy size={14} /> {t('Copy address')}
        </>
      ),
      onSelect: () => void copyText(tab.url).catch(() => {}),
    },
    {
      key: 'external',
      label: (
        <>
          <ExternalLink size={14} /> {t('Open in system browser')}
        </>
      ),
      onSelect: () => actions.openExternal(tab),
    },
    { key: 'sep3', separator: true },
    {
      key: 'close',
      label: (
        <>
          <X size={14} /> {t('Close tab')}
        </>
      ),
      onSelect: () => actions.close(tab),
    },
    {
      key: 'close-others',
      label: (
        <>
          <XCircle size={14} /> {t('Close other tabs')}
        </>
      ),
      disabled: count < 2,
      onSelect: () => actions.closeOthers(tab),
    },
    {
      key: 'close-right',
      label: (
        <>
          <XCircle size={14} /> {t('Close tabs to the right')}
        </>
      ),
      disabled: index >= count - 1,
      onSelect: () => actions.closeToRight(tab),
    },
  ]
  const menu = useContextMenu(`${tab.title || tab.url} actions`, items)
  const title = tab.title || tab.url
  const icon = browserFaviconFrom(tab.url, tab.faviconUrl)
  const [failedIcon, setFailedIcon] = useState<string | null>(null)
  return (
    <div
      className={`flex min-w-0 max-w-44 flex-none items-center rounded-(--radius-s) text-caption ${active ? 'bg-hover text-foreground' : 'text-muted-foreground hover:bg-hover'}`}
      onContextMenu={menu.onContextMenu}
      onKeyDown={menu.onKeyDown}
      // Middle-click closes, as in a browser.
      onAuxClick={(event) => {
        if (event.button !== 1 || disabled) return
        event.preventDefault()
        actions.close(tab)
      }}
      onMouseDown={(event) => {
        if (event.button === 1) event.preventDefault()
      }}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        disabled={disabled}
        title={title}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 border-0 bg-transparent px-2 py-1 text-left text-inherit"
        onClick={() => actions.select(tab)}
      >
        {icon && failedIcon !== icon ? (
          <img
            src={icon}
            alt=""
            aria-hidden="true"
            width={14}
            height={14}
            className="size-3.5 flex-none object-contain"
            referrerPolicy="no-referrer"
            onError={() => setFailedIcon(icon)}
          />
        ) : (
          <Globe size={14} className="flex-none" aria-hidden="true" />
        )}
        <span className="min-w-0 truncate">{title}</span>
      </button>
      <button
        type="button"
        aria-label={t('Close tab')}
        disabled={disabled}
        className="flex-none cursor-pointer border-0 bg-transparent px-1 py-1 text-inherit"
        onClick={() => actions.close(tab)}
      >
        <X size={12} />
      </button>
      {menu.menu}
    </div>
  )
}
