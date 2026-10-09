import { Separator } from '@/components/ui/separator'
import { Dialog as ShadcnDialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
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
export function Menu({ label, icon, items, className = 'ghost icon', align = 'start', header, disabled = false, menuClassName = '', onOpen }: {
  label: string; icon: ReactNode; items: MenuEntry[]; className?: string; align?: 'start' | 'end'; header?: ReactNode | ((close: () => void) => ReactNode); disabled?: boolean; menuClassName?: string; onOpen?: () => void
}) {
  const [open, setOpen] = useState(false)
  const change = (next: boolean) => { setOpen(next); if (next) onOpen?.() }
  useEffect(() => { const close = () => setOpen(false); window.addEventListener('ramu:settings', close); window.addEventListener('resize', close); return () => { window.removeEventListener('ramu:settings', close); window.removeEventListener('resize', close) } }, [])
  const popup = useRef<HTMLDivElement>(null)
  const trigger = <Button disabled={disabled} className={`${className}${open ? ' on' : ''}`} aria-label={label} title={label} onClick={(e) => e.stopPropagation()}>{icon}</Button>
  if (header) return <Popover open={open} onOpenChange={change}><PopoverTrigger render={trigger} /><PopoverContent align={align} sideOffset={4} className={`menu search-menu ${menuClassName}`} role="menu" aria-label={label} onKeyDown={navigateMenu} initialFocus={() => popup.current?.querySelector<HTMLElement>('input, button[aria-checked="true"], button:not(:disabled)') ?? true} ref={popup}>
    {typeof header === 'function' ? header(() => setOpen(false)) : header}<MenuItems items={items} close={() => setOpen(false)} />
  </PopoverContent></Popover>
  return <DropdownMenu open={open} onOpenChange={change}><DropdownMenuTrigger render={trigger} /><DropdownMenuContent align={align} className={menuClassName} aria-label={label}><StandardMenuItems items={items} /></DropdownMenuContent></DropdownMenu>
}
function StandardMenuItems({ items }: { items: MenuEntry[] }) {
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
  const [openSub, setOpenSub] = useState<string | null>(null)
  return (
    <>
      {items.map((it) => {
        if (it.separator) return <Separator key={it.key} className="menu-sep" />
        if (it.heading !== undefined)
          return (
            <div key={it.key} className="menu-title">
              {it.heading}
            </div>
          )
        const hasSub = !!it.submenu?.length
        return (
          <div key={it.key} className="menu-item-wrap" onMouseEnter={() => setOpenSub(hasSub ? it.key : null)}>
            <Button
              role={it.selected !== undefined ? 'menuitemradio' : 'menuitem'}
              aria-checked={it.selected}
              title={it.title}
              data-search-choice={it.searchChoice === false ? 'false' : undefined}
              aria-haspopup={hasSub ? 'menu' : undefined}
              disabled={it.disabled}
              className={`menu-item${it.danger ? ' danger' : ''}${it.selected ? ' selected' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                if (hasSub) return setOpenSub(it.key)
                close()
                it.onSelect?.()
              }}
            >
              {it.label}
              {hasSub && <ChevronRight size={15} className="menu-chevron" />}
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
  return <div ref={host} className="menu submenu" role="menu" style={{ position: 'fixed', visibility: 'hidden', maxHeight: 'calc(100vh - 16px)', overflowY: 'auto' }}><MenuItems items={items} close={close} /></div>
}

/** Modal confirmation; resolves through onConfirm/onCancel. */
export function Dialog({
  title,
  children,
  confirmLabel,
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
  confirmDisabled?: boolean
  danger?: boolean
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  return <ShadcnDialog open disablePointerDismissal={busy} onOpenChange={(open, details) => { if (open) return; if (busy) details.cancel(); else onCancel() }}>
    <DialogContent className="dialog" role="alertdialog" showCloseButton={false} aria-describedby={undefined}>
      <DialogTitle>{title}</DialogTitle><div className="dialog-body">{children}</div>
      {error && <div className="error small" role="alert">{error}</div>}
      <div className="dialog-actions"><Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button><Button variant={danger ? 'destructive' : 'default'} className={danger ? 'danger-btn' : 'primary'} onClick={onConfirm} disabled={busy || confirmDisabled}>{confirmLabel}</Button></div>
    </DialogContent>
  </ShadcnDialog>
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Every value picker uses the same compact menu, selection mark and trigger. */
export function Dropdown({ label, value, options, onChange, icon, placeholder = 'Select…', className = '', disabled = false }: {
  label: string
  value: string
  options: { value: string; label: string; disabled?: boolean }[]
  onChange: (value: string) => void
  icon?: ReactNode
  placeholder?: string
  className?: string
  disabled?: boolean
}) {
  // Base UI Select treats null as unselected, so an empty option needs a sentinel value.
  const emptyValue = '__ramu_empty_option__'
  return <Select value={value || (options.some((o) => o.value === '') ? emptyValue : '')} items={options.map((o) => ({ value: o.value || emptyValue, label: o.label }))} onValueChange={(next) => { if (next !== null) onChange(next === emptyValue ? '' : next) }} disabled={disabled || !options.length}>
    <SelectTrigger className={`dropdown-trigger ${className}`} aria-label={label}>{icon}<SelectValue placeholder={placeholder} /></SelectTrigger>
    <SelectContent alignItemWithTrigger={false} align="start">{options.map((option) => <SelectItem key={option.value || emptyValue} value={option.value || emptyValue} disabled={option.disabled}>{option.label}</SelectItem>)}</SelectContent>
  </Select>
}
