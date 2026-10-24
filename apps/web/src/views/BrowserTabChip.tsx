import { BrowserTabFrame, BrowserTabButton, BrowserTabCloseButton } from '@/components/browser-tab-controls'
import { Copy, CopyPlus, ExternalLink, Globe, Plus, RotateCw, X, XCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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
  const identity = JSON.stringify([tab.hostId, tab.threadId, tab.id])
  const latest = useRef({ identity, disabled, tab, actions, index, count })
  latest.current = { identity, disabled, tab, actions, index, count }
  const canAct = () => latest.current.identity === identity && !latest.current.disabled
  const act = (
    action: 'select' | 'close' | 'closeOthers' | 'closeToRight' | 'duplicate' | 'reload' | 'openExternal',
  ) => {
    if (!canAct()) return
    if (action === 'reload' && !latest.current.tab.inputReady) return
    if (action === 'closeOthers' && latest.current.count < 2) return
    if (action === 'closeToRight' && latest.current.index >= latest.current.count - 1) return
    latest.current.actions[action](latest.current.tab)
  }
  useEffect(
    () => () => {
      if (latest.current.identity === identity) latest.current.disabled = true
    },
    [identity],
  )
  const items: MenuEntry[] = [
    {
      key: 'new',
      label: (
        <>
          <Plus size={14} /> {t('New tab')}
        </>
      ),
      disabled,
      onSelect: () => {
        if (canAct()) latest.current.actions.newTab()
      },
    },
    { key: 'sep1', separator: true },
    {
      key: 'reload',
      label: (
        <>
          <RotateCw size={14} /> {t('Reload')}
        </>
      ),
      disabled: disabled || !tab.inputReady,
      onSelect: () => act('reload'),
    },
    {
      key: 'duplicate',
      disabled,
      label: (
        <>
          <CopyPlus size={14} /> {t('Duplicate')}
        </>
      ),
      onSelect: () => act('duplicate'),
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
      disabled,
      label: (
        <>
          <ExternalLink size={14} /> {t('Open in system browser')}
        </>
      ),
      onSelect: () => act('openExternal'),
    },
    { key: 'sep3', separator: true },
    {
      key: 'close',
      disabled,
      label: (
        <>
          <X size={14} /> {t('Close tab')}
        </>
      ),
      onSelect: () => act('close'),
    },
    {
      key: 'close-others',
      label: (
        <>
          <XCircle size={14} /> {t('Close other tabs')}
        </>
      ),
      disabled: disabled || count < 2,
      onSelect: () => act('closeOthers'),
    },
    {
      key: 'close-right',
      label: (
        <>
          <XCircle size={14} /> {t('Close tabs to the right')}
        </>
      ),
      disabled: disabled || index >= count - 1,
      onSelect: () => act('closeToRight'),
    },
  ]
  const menu = useContextMenu(`${tab.title || tab.url} actions`, items)
  const title = tab.title || tab.url
  const icon = browserFaviconFrom(tab.url, tab.faviconUrl)
  const [failedIcon, setFailedIcon] = useState<string | null>(null)
  return (
    <BrowserTabFrame
      active={active}
      onContextMenu={menu.onContextMenu}
      onKeyDown={menu.onKeyDown}
      // Middle-click closes, as in a browser.
      onAuxClick={(event) => {
        if (event.button !== 1 || !canAct()) return
        event.preventDefault()
        act('close')
      }}
      onMouseDown={(event) => {
        if (event.button === 1) event.preventDefault()
      }}
    >
      <BrowserTabButton aria-selected={active} disabled={disabled} title={title} onClick={() => act('select')}>
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
      </BrowserTabButton>
      <BrowserTabCloseButton aria-label={t('Close tab')} disabled={disabled} onClick={() => act('close')}>
        <X size={12} />
      </BrowserTabCloseButton>
      {menu.menu}
    </BrowserTabFrame>
  )
}
