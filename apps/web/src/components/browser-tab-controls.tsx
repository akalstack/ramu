import type { ComponentProps, KeyboardEvent } from 'react'
import { cn } from 'cn'
import { Button } from './desktop-button'
import './browser-tab-controls.css'

/** Arrow keys wrap between enabled tabs; Home/End reach the first/last without visiting close buttons. */
export function navigateBrowserTabs(event: KeyboardEvent<HTMLButtonElement>) {
  if (
    event.defaultPrevented ||
    ('baseUIHandlerPrevented' in event && event.baseUIHandlerPrevented) ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  )
    return
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  const root = event.currentTarget.closest('[role="tablist"]')
  if (!root) return
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')].filter(
    (tab) => !tab.disabled && tab.getAttribute('aria-disabled') !== 'true' && !tab.closest('[hidden], [inert]'),
  )
  const index = tabs.indexOf(event.currentTarget)
  if (index < 0 || !tabs.length) return
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
  event.preventDefault()
  tabs[next]!.focus()
  tabs[next]!.click()
}

export function BrowserTabFrame({ active, className, ...props }: ComponentProps<'div'> & { active: boolean }) {
  return <div {...props} data-active={active || undefined} className={cn('browser-tab-frame', className)} />
}
export function BrowserTabButton({ className, onKeyDown, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      {...props}
      type="button"
      role="tab"
      variant="ghost"
      className={cn('browser-tab-button', className)}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        navigateBrowserTabs(event)
      }}
    />
  )
}
export function BrowserTabCloseButton({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button {...props} type="button" variant="ghost" size="icon-xs" className={cn('browser-tab-close', className)} />
  )
}
