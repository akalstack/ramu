import { SettingsFieldContext } from '../settings/settingsField'
import type { ComponentProps } from 'react'
import { cn } from 'cn'
import { Button } from './desktop-button'

/**
 * Text that acts, inside a sentence: it takes the sentence's size, line and baseline, and no state (open, pressed,
 * hovered) gives it a box or a fill, which a button's own styles would otherwise add, such as the tint an open
 * disclosure gets from aria-expanded.
 */
const INLINE =
  'inline cursor-pointer no-underline h-auto min-h-0 rounded-(--radius-xs) border-0 bg-transparent p-0 align-baseline text-[length:inherit] leading-[inherit] font-normal underline-offset-2 shadow-none hover:bg-transparent hover:underline aria-expanded:bg-transparent aria-[pressed=true]:bg-transparent active:translate-y-0 focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring focus-visible:outline-offset-2'

/** An action embedded in prose; host mutations retain the enclosing Settings field's disabled state. */
export function InlineAction({
  className,
  tone = 'accent',
  ...props
}: Omit<ComponentProps<typeof Button>, 'variant' | 'size'> & { tone?: 'accent' | 'muted' }) {
  return (
    <Button
      {...props}
      type="button"
      variant="link"
      className={cn(
        INLINE,
        tone === 'accent'
          ? 'text-brand aria-expanded:text-brand'
          : 'text-muted-foreground hover:text-foreground aria-expanded:text-foreground',
        className,
      )}
    />
  )
}

/** External destinations keep native link semantics and remain independent of host-write permissions. */
export function InlineLink({ className, ...props }: ComponentProps<'a'>) {
  return <a {...props} className={cn(INLINE, 'text-brand', className)} />
}

/** Local draft/disclosure changes remain available when a host field is unavailable. */
export function LocalInlineAction(props: ComponentProps<typeof InlineAction>) {
  return (
    <SettingsFieldContext.Provider value={null}>
      <InlineAction {...props} />
    </SettingsFieldContext.Provider>
  )
}
