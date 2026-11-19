import { SettingsFieldContext } from '../settings/settingsField'
import type { ComponentProps } from 'react'
import { cn } from 'cn'
import { Button } from './desktop-button'

const INLINE =
  'inline cursor-pointer no-underline h-auto min-h-0 rounded-(--radius-xs) border-0 bg-transparent p-0 text-[length:var(--font-caption)] font-normal underline-offset-2 hover:underline active:translate-y-0 focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring focus-visible:outline-offset-2'

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
        tone === 'accent' ? 'text-brand' : 'text-muted-foreground hover:text-foreground',
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
