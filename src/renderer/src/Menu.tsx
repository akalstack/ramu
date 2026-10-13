import { t, useLanguage, formatLocale } from './i18n'
import { Separator } from '@/components/ui/separator'
import { Dialog as ShadcnDialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectGroup, SelectItem } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/desktop-button'
import { Button as NativeButton } from '@/components/ui/button'
import { ChevronRight } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export type MenuEntry =
  | { key: string; heading: string; separator?: undefined }
  | { key: string; separator: true }
  | { key: string; label: ReactNode; title?: string; searchChoice?: boolean; onSelect?: () => void; submenu?: MenuEntry[]; danger?: boolean; disabled?: boolean; selected?: boolean; heading?: undefined; separator?: undefined }

/**
 * Popover menu rendered at the document root, so scrolling strips and sidebars never clip it.
 * Closes on outside click, Escape, resize or selection.
 */
export function Menu({ standard = false, label, icon, items, className = 'ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center', align = 'start', header, disabled = false, menuClassName = '', onOpen }: {
  standard?: boolean; label: string; icon: ReactNode; items: MenuEntry[]; className?: string; align?: 'start' | 'end'; header?: ReactNode | ((close: () => void) => ReactNode); disabled?: boolean; menuClassName?: string; onOpen?: () => void
}) {
  useLanguage()
  const [open, setOpen] = useState(false)
  const change = (next: boolean) => { setOpen(next); if (next) onOpen?.() }
  useEffect(() => { const close = () => setOpen(false); window.addEventListener('ramu:settings', close); window.addEventListener('resize', close); return () => { window.removeEventListener('ramu:settings', close); window.removeEventListener('resize', close) } }, [])
  const popup = useRef<HTMLDivElement>(null)
  const TriggerButton = standard ? NativeButton : Button
  const trigger = <TriggerButton variant={standard ? "ghost" : "secondary"} disabled={disabled} className={`${className}${open ? ' on' : ''}`} aria-label={label} title={label} onClick={(e) => e.stopPropagation()}>{icon}</TriggerButton>
  if (header) return <Popover open={open} onOpenChange={change}><PopoverTrigger render={trigger} /><PopoverContent align={align} sideOffset={4} className={`menu [&[data-slot='popover-content']]:relative [&[data-slot='popover-content']]:top-auto [&[data-slot='popover-content']]:left-auto [&[data-slot='popover-content']]:w-[max-content] [&[data-slot='popover-content']]:max-w-[min(420px,_calc(100vw_-_16px))] [&[data-slot='popover-content']]:z-1100 [&[data-slot='popover-content']]:[animation:none] [&[data-slot='popover-content']]:gap-0.5 [background:var(--float-bg)] [-webkit-backdrop-filter:var(--float-blur)] [backdrop-filter:var(--float-blur)] [border:1px_solid_var(--edge)] [box-shadow:0_18px_48px_rgba(0,_0,_0,_0.45),_0_2px_8px_rgba(0,_0,_0,_0.25),_inset_0_1px_0_rgba(255,_255,_255,_0.07)] [&[data-slot='popover-content'].model-controls-menu]:w-[340px] [&[data-slot='popover-content'].model-controls-menu]:max-w-[calc(100vw_-_16px)] [&[data-slot='popover-content'].model-controls-menu]:[scale:1] [&[data-slot='popover-content'].model-controls-menu]:[transform:none] [&[data-slot='popover-content'].model-controls-menu]:[transition:opacity_150ms_var(--ease)] [&[data-slot='popover-content']_>_.menu-sep]:m-[2px_4px] fixed w-[max-content] min-w-[160px] max-w-[min(280px,_calc(100vw_-_16px))] bg-raised [border:1px_solid_var(--edge)] rounded-(--radius-row) p-1 [box-shadow:0_18px_48px_rgba(0,_0,_0,_0.5),_0_2px_8px_rgba(0,_0,_0,_0.3)] z-60 [animation:pop_0.12s_var(--ease)] search-menu ${menuClassName}`} role="menu" aria-label={label} onKeyDown={navigateMenu} initialFocus={() => popup.current?.querySelector<HTMLElement>('input, button[aria-checked="true"], button:not(:disabled)') ?? true} ref={popup}>
    {typeof header === 'function' ? header(() => setOpen(false)) : header}<MenuItems items={items} close={() => setOpen(false)} />
  </PopoverContent></Popover>
  return <DropdownMenu open={open} onOpenChange={change}><DropdownMenuTrigger render={trigger} /><DropdownMenuContent align={align} className={menuClassName} aria-label={label}><StandardMenuItems items={items} /></DropdownMenuContent></DropdownMenu>
}
function StandardMenuItems({ items }: { items: MenuEntry[] }) {
  useLanguage()
  return <DropdownMenuRadioGroup value={items.find((i) => 'selected' in i && i.selected)?.key}>{items.map((it) => {
    if (it.separator) return <DropdownMenuSeparator key={it.key} />
    if (it.heading !== undefined) return <DropdownMenuLabel key={it.key}>{it.heading}</DropdownMenuLabel>
    if (it.submenu?.length) return <DropdownMenuSub key={it.key}><DropdownMenuSubTrigger disabled={it.disabled}>{it.label}</DropdownMenuSubTrigger><DropdownMenuSubContent><StandardMenuItems items={it.submenu} /></DropdownMenuSubContent></DropdownMenuSub>
    if (it.selected !== undefined) return <DropdownMenuRadioItem key={it.key} value={it.key} closeOnClick disabled={it.disabled} title={it.title} onClick={() => it.onSelect?.()}>{it.label}</DropdownMenuRadioItem>
    return <DropdownMenuItem key={it.key} disabled={it.disabled} title={it.title} variant={it.danger ? 'destructive' : 'default'} onClick={() => it.onSelect?.()}>{it.label}</DropdownMenuItem>
  })}</DropdownMenuRadioGroup>
}

/** Context actions for a row, without a separate three-dot button. */
export function useContextMenu(label: string, items: MenuEntry[]) {
  useLanguage()
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const target = useRef<HTMLElement | null>(null)
  const onContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    // Rename inputs nested in rows still need the native text editing menu.
    if (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable="true"]')) { event.stopPropagation(); return }
    event.preventDefault(); event.stopPropagation(); target.current = event.currentTarget; setPosition({ x: event.clientX, y: event.clientY })
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
    if (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable="true"]')) { event.stopPropagation(); return }
    event.preventDefault(); target.current = event.currentTarget; const rect = event.currentTarget.getBoundingClientRect(); setPosition({ x: rect.left + 12, y: rect.bottom + 4 })
  }
  useEffect(() => { if (!position) return; const close = () => setPosition(null); window.addEventListener('resize', close); return () => window.removeEventListener('resize', close) }, [position])
  const menu = position && createPortal(<DropdownMenu open onOpenChange={(open) => { if (!open) setPosition(null) }}><DropdownMenuTrigger render={<span style={{ position: 'fixed', left: position.x, top: position.y, width: 1, height: 1 }} />} /><DropdownMenuContent aria-label={label} align="start" sideOffset={0} finalFocus={() => { target.current?.focus(); return false }} onContextMenu={(e) => e.preventDefault()}><StandardMenuItems items={items} /></DropdownMenuContent></DropdownMenu>, document.body)
  return { onContextMenu, onKeyDown, menu }
}

function navigateMenu(event: React.KeyboardEvent) {
  const current = document.activeElement as HTMLElement
  const container = current.closest('[role="menu"]')
  const buttons = Array.from(container?.querySelectorAll<HTMLButtonElement>(':scope > .menu-item-wrap > button:not(:disabled)') ?? [])
  const index = buttons.indexOf(current as HTMLButtonElement)
  const selected = buttons.findIndex((button) => button.getAttribute('aria-checked') === 'true')
  if (event.key === 'Enter' && current.matches('input')) {
    event.preventDefault()
    const choices = buttons.filter((button) => button.dataset.searchChoice !== 'false')
    const target = choices.find((button) => button.getAttribute('aria-checked') === 'true') ?? choices[0]
    target?.click()
    return
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    buttons[index < 0 ? selected >= 0 ? selected : event.key === 'ArrowDown' ? 0 : buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
  } else if (event.key === 'Home' || event.key === 'End') {
    if (current.matches('input, textarea')) return
    event.preventDefault()
    const destination = event.key === 'Home' ? buttons[0] : buttons.at(-1)
    destination?.focus()
  } else if (event.key === 'ArrowRight' && current.getAttribute('aria-haspopup') === 'menu') {
    event.preventDefault(); current.click()
    requestAnimationFrame(() => current.parentElement?.querySelector<HTMLButtonElement>('.submenu button:not(:disabled)')?.focus())
  } else if (event.key === 'ArrowLeft' && container?.classList.contains('submenu')) {
    event.preventDefault()
    container.parentElement?.querySelector<HTMLButtonElement>(':scope > button')?.focus()
  }
}

export function MenuItems({ items, close }: { items: MenuEntry[]; close: () => void }) {
  useLanguage()
  const [openSub, setOpenSub] = useState<string | null>(null)
  return (
    <>
      {items.map((it) => {
        if (it.separator) return <Separator key={it.key} className="menu-sep [.project-switch-menu_&]:m-[4px_0] h-px [background:var(--line-strong)] m-[4px_6px]" />
        if (it.heading !== undefined)
          return (
            <div key={it.key} className="menu-title [.chat-switch-menu_&]:pt-[7px] text-caption text-muted-foreground p-[4px_7px_2px]">
              {it.heading}
            </div>
          )
        const hasSub = !!it.submenu?.length
        return (
          <div key={it.key} className="menu-item-wrap [.project-switch-menu_&]:block [.chat-switch-menu_&]:block relative" onMouseEnter={() => setOpenSub(hasSub ? it.key : null)}>
            <Button variant="secondary"
              role={it.selected !== undefined ? 'menuitemradio' : 'menuitem'}
              aria-checked={it.selected}
              title={it.title}
              data-search-choice={it.searchChoice === false ? 'false' : undefined}
              aria-haspopup={hasSub ? 'menu' : undefined}
              disabled={it.disabled}
              className={`menu-item [&_svg]:w-3.5 [&_svg]:h-3.5 [&_svg]:[stroke-width:1.6] [&_svg]:flex-none [&_svg]:text-soft [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:[border:none] [&:focus-visible]:bg-hover [&:focus-visible]:[border:none] [&:disabled]:[opacity:0.4] [&_.muted]:ml-auto [&_.muted]:text-caption [&_.muted]:pl-2.5 [&_.block]:text-caption [&_.block]:leading-[16px] [&_.block]:font-normal [&_.block]:m-[1px_0_0] [&_.block]:pl-0 [&_.block]:whitespace-normal [&_.block]:max-w-[225px] [&.danger]:text-bad [&.danger_svg]:text-bad [.model-menu_&]:whitespace-normal [.dropdown-menu_&]:gap-2 [&.selected]:bg-accent [&.selected:hover:not(:disabled)]:bg-accent [&.selected:focus-visible]:bg-accent [.access-menu_&]:p-2 [.access-menu_&]:whitespace-normal [.access-menu_&_.block]:max-w-[none] [.access-menu_&_.block]:m-0 [.access-menu_&_.block]:leading-[18px] [.project-switch-menu_&]:min-h-[30px] [.project-switch-menu_&]:p-[6px_8px] [.project-switch-menu_&]:gap-2.5 [.project-switch-menu_&]:items-center [.chat-switch-menu_&]:min-h-[30px] [.chat-switch-menu_&]:p-[6px_8px] [.chat-switch-menu_&]:gap-2.5 [.chat-switch-menu_&]:items-center [.project-switch-menu_&:has(.block)]:items-start [.project-switch-menu_&:has(.block)]:min-h-[44px] [.chat-switch-menu_&:has(.block)]:items-start [.chat-switch-menu_&:has(.block)]:min-h-[44px] [.project-switch-menu_&:has(.block)_>_svg]:mt-0.5 [.chat-switch-menu_&:has(.block)_>_svg]:mt-0.5 [.project-switch-menu_&_>_svg:last-child:not(:first-child)]:ml-auto [.project-switch-menu_&_>_svg:last-child:not(:first-child)]:text-soft [.chat-switch-menu_&_>_svg:last-child:not(:first-child)]:ml-auto [.chat-switch-menu_&_>_svg:last-child:not(:first-child)]:text-soft [.project-switch-menu_&.selected]:bg-accent [.chat-switch-menu_&.selected]:bg-accent [.project-switch-menu_&:hover:not(:disabled,_.selected)]:bg-hover [.chat-switch-menu_&:hover:not(:disabled,_.selected)]:bg-hover rounded-(--radius-s) w-full flex items-center gap-2 bg-transparent [border:none] p-[4px_8px] min-h-7 rounded-(--radius-s) text-foreground text-control leading-[20px] font-normal tracking-[-0.006em] whitespace-nowrap text-left justify-start${it.danger ? ' danger' : ''}${it.selected ? ' selected' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                if (hasSub) return setOpenSub(it.key)
                close()
                it.onSelect?.()
              }}
            >
              {it.label}
              {hasSub && <ChevronRight size={15} className="menu-chevron ml-auto text-muted-foreground! w-3.5! h-3.5!" />}
            </Button>
            {hasSub && openSub === it.key && (
              <Submenu items={it.submenu!} close={close} />
            )}
          </div>
        )
      })}
    </>
  )
}

function Submenu({ items, close }: { items: MenuEntry[]; close: () => void }) {
  useLanguage()
  const host = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = host.current
    const row = element?.parentElement?.getBoundingClientRect()
    if (!element || !row) return
    const width = element.offsetWidth, height = element.offsetHeight
    const left = row.right + width + 4 <= window.innerWidth - 8 ? row.right + 4 : row.left - width - 4
    element.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`
    element.style.top = `${Math.max(8, Math.min(row.top - 4, window.innerHeight - height - 8))}px`
    element.style.visibility = 'visible'
  }, [items])
  return <div ref={host} className="menu [&[data-slot='popover-content']]:relative [&[data-slot='popover-content']]:top-auto [&[data-slot='popover-content']]:left-auto [&[data-slot='popover-content']]:w-[max-content] [&[data-slot='popover-content']]:max-w-[min(420px,_calc(100vw_-_16px))] [&[data-slot='popover-content']]:z-1100 [&[data-slot='popover-content']]:[animation:none] [&[data-slot='popover-content']]:gap-0.5 [background:var(--float-bg)] [-webkit-backdrop-filter:var(--float-blur)] [backdrop-filter:var(--float-blur)] [border:1px_solid_var(--edge)] [box-shadow:0_18px_48px_rgba(0,_0,_0,_0.45),_0_2px_8px_rgba(0,_0,_0,_0.25),_inset_0_1px_0_rgba(255,_255,_255,_0.07)] [&[data-slot='popover-content'].model-controls-menu]:w-[340px] [&[data-slot='popover-content'].model-controls-menu]:max-w-[calc(100vw_-_16px)] [&[data-slot='popover-content'].model-controls-menu]:[scale:1] [&[data-slot='popover-content'].model-controls-menu]:[transform:none] [&[data-slot='popover-content'].model-controls-menu]:[transition:opacity_150ms_var(--ease)] [&[data-slot='popover-content']_>_.menu-sep]:m-[2px_4px] fixed w-[max-content] min-w-[160px] max-w-[min(280px,_calc(100vw_-_16px))] bg-raised [border:1px_solid_var(--edge)] rounded-(--radius-row) p-1 [box-shadow:0_18px_48px_rgba(0,_0,_0,_0.5),_0_2px_8px_rgba(0,_0,_0,_0.3)] z-60 [animation:pop_0.12s_var(--ease)] submenu absolute left-[calc(100%_+_6px)] top-[-4px] z-61" role="menu" style={{ position: 'fixed', visibility: 'hidden', maxHeight: 'calc(100vh - 16px)', overflowY: 'auto' }}><MenuItems items={items} close={close} /></div>
}

/** Modal confirmation; resolves through onConfirm/onCancel. */
export function Dialog({
  title,
  children,
  confirmLabel,
  extraActions,
  footerLeading,
  confirmDisabled = false,
  danger,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  title: string
  children?: ReactNode
  confirmLabel: string
  extraActions?: ReactNode
  footerLeading?: ReactNode
  confirmDisabled?: boolean
  danger?: boolean
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  useLanguage()
  return <ShadcnDialog open disablePointerDismissal={busy} onOpenChange={(open, details) => { if (open) return; if (busy) details.cancel(); else onCancel() }}>
    <DialogContent className="dialog [&_h3]:m-[0_0_8px] [&_h3]:text-heading [&_h3]:font-semibold [&_h3]:tracking-[-0.01em] [&:has(.model-settings)]:w-[min(640px,_calc(100vw_-_40px))] [&:has(.model-settings)]:max-h-[calc(100vh_-_40px)] [&:has(.model-settings)]:flex [&:has(.model-settings)]:flex-col [&:has(.model-settings)_>_.dialog-body]:overflow-auto [&:has(.model-settings)_>_.dialog-body]:min-h-0 [&:has(.model-settings)_>_h3]:flex-none [&:has(.model-settings)_>_.dialog-actions]:flex-none [&:has(.undo-preview)]:w-[min(1000px,_calc(100vw_-_48px))] [&:has(.undo-preview)]:max-w-[none] [&:has(.undo-preview)]:max-h-[calc(100vh_-_48px)] [&:has(.undo-preview)]:flex [&:has(.undo-preview)]:flex-col [&:has(.undo-preview)_.dialog-body]:min-h-0 [&:has(.undo-preview)_.dialog-body]:overflow-auto [[data-slot='dialog-content']&]:block [[data-slot='dialog-content']&]:max-w-[none] [[data-slot='dialog-content']&]:max-h-[calc(100vh_-_48px)] [[data-slot='dialog-content']&]:overflow-y-auto [background:var(--float-bg)] [-webkit-backdrop-filter:var(--float-blur)] [backdrop-filter:var(--float-blur)] [border:1px_solid_var(--edge)] [box-shadow:0_18px_48px_rgba(0,_0,_0,_0.45),_0_2px_8px_rgba(0,_0,_0,_0.25),_inset_0_1px_0_rgba(255,_255,_255,_0.07)] [&:has(.workspace-sync)]:w-[min(680px,_calc(100vw_-_48px))] w-[min(440px,_calc(100vw_-_48px))] bg-card [border:1px_solid_var(--edge)] rounded-(--radius-l) p-[18px_20px_16px] [box-shadow:0_24px_64px_rgba(0,_0,_0,_0.55)] [animation:pop_0.14s_var(--ease)]" role="alertdialog" showCloseButton={false} aria-describedby={undefined}>
      <DialogTitle>{title}</DialogTitle><div className="dialog-body [&_p]:m-[0_0_8px] text-soft text-[length:var(--ui-font-size)]">{children}</div>
      {error && <div className="error text-bad small text-caption" role="alert">{error}</div>}
      <div className="dialog-actions [&_button]:p-[5px_14px] flex flex-wrap items-center justify-end gap-2 mt-3.5">{footerLeading}<Button variant="outline" className="whitespace-nowrap" onClick={onCancel} disabled={busy}>{t("Cancel")}</Button>{extraActions}<Button variant={danger ? 'destructive' : 'default'} className={danger ? 'danger-btn whitespace-nowrap' : 'whitespace-nowrap primary bg-primary text-primary-foreground border-transparent font-semibold justify-center hover:bg-primary-hover disabled:bg-raised disabled:text-muted-foreground disabled:opacity-100'} onClick={onConfirm} disabled={busy || confirmDisabled}>{confirmLabel}</Button></div>
    </DialogContent>
  </ShadcnDialog>
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return t('now')
  if (s < 3600) return t('{count}m', { count: Math.floor(s / 60) })
  if (s < 86400) return t('{count}h', { count: Math.floor(s / 3600) })
  if (s < 86400 * 7) return t('{count}d', { count: Math.floor(s / 86400) })
  return new Date(ts).toLocaleDateString(formatLocale(), { month: 'short', day: 'numeric' })
}

/** Every value picker uses the same compact menu, selection mark and trigger. */
export function Dropdown({ label, value, options, onChange, icon, placeholder = t('Select…'), className = '', disabled = false, title }: {
  label: string
  value: string
  options: { value: string; label: string; disabled?: boolean }[]
  onChange: (value: string) => void
  icon?: ReactNode
  placeholder?: string
  className?: string
  disabled?: boolean
  title?: string
}) {
  useLanguage()
  // Base UI Select treats null as unselected, so an empty option needs a sentinel value.
  const emptyValue = '__ramu_empty_option__'
  return <Select value={value || (options.some((o) => o.value === '') ? emptyValue : '')} items={options.map((o) => ({ value: o.value || emptyValue, label: o.label }))} onValueChange={(next) => { if (next !== null) onChange(next === emptyValue ? '' : next) }} disabled={disabled || !options.length}>
    <SelectTrigger className={`dropdown-trigger [&_>_svg]:flex-none [&_>_svg]:w-3.5 [&_>_svg]:h-3.5 [&_>_svg]:text-soft [&_>_svg:last-child]:w-3 [&_>_svg:last-child]:h-3 [&_>_svg:last-child]:ml-auto [&_>_svg:last-child]:text-muted-foreground [&:hover]:bg-hover [&.on]:bg-hover [&.control-btn]:min-h-6 [&.control-btn]:p-[3px_4px] [&.control-btn]:[border:0] [&.control-btn]:bg-transparent [&.control-btn]:text-caption [&.control-btn]:leading-[18px] [&.control-btn]:gap-[5px] [&.control-btn:hover]:bg-hover [&.control-btn.on]:bg-hover [.sidebar-scope_&_>_svg:last-child]:ml-auto [.sidebar-scope_&_>_svg:last-child]:text-muted-foreground [:is(.settings-page-content,_.schedule-editor,_.schedule-card,_.changes-page,_.home-page,_.dialog,_.model-settings)_&_>_svg:last-child]:text-muted-foreground flex items-center gap-2 min-h-[30px] p-[5px_10px] [border:1px_solid_transparent] rounded-(--radius-s) text-[length:var(--ui-font-size)] leading-[18px] text-left bg-fill ${className}`} aria-label={label} title={title}>{icon}<SelectValue placeholder={placeholder} /></SelectTrigger>
    <SelectContent alignItemWithTrigger={false} align="start"><SelectGroup className="p-0">{options.map((option) => <SelectItem key={option.value || emptyValue} value={option.value || emptyValue} disabled={option.disabled}>{option.label}</SelectItem>)}</SelectGroup></SelectContent>
  </Select>
}
