import { useSettingsField } from '../settings/settingsField'
import type { ComponentProps } from 'react'
import { cn } from 'cn'
import { Button as NativeButton } from '@/components/ui/button'

/** Teach the class merger that Ramu's semantic text aliases are font sizes, not text colors. */
function textSizes(className: string) {
  return className.replace(/\S+/g, (token) =>
    token.replace(/(^|:)text-(caption|control|body|chat|heading|hero)$/, '$1text-[length:var(--font-$2)]'),
  )
}

/**
 * Ghost buttons fill on hover, in every theme and on every surface. The registry's own hover is a half-strength muted
 * fill in dark mode that beats a caller's `hover:bg-*`, so it reads as no hover at all on cards and dialogs. A button
 * that sets `hover:bg-transparent` has its own hover treatment and keeps it.
 */
function ghostHover(className: unknown) {
  return typeof className === 'string' && /(^|\s)hover:bg-transparent(\s|$)/.test(className)
    ? 'dark:hover:bg-transparent'
    : 'hover:bg-fill-hover dark:hover:bg-fill-hover aria-expanded:bg-fill-hover'
}

/** Keep desktop density and the user's font size while composing the registry Button. */
export function Button({ className, size, variant = 'secondary', ...props }: ComponentProps<typeof NativeButton>) {
  const field = useSettingsField()
  return (
    <NativeButton
      variant={variant}
      size={size}
      className={cn(
        'text-[length:var(--font-body)] font-normal whitespace-inherit disabled:opacity-40',
        size?.startsWith('icon') ? 'min-h-0' : 'h-auto min-h-[26px]',
        variant === 'secondary' && 'bg-fill hover:bg-fill-hover',
        typeof className === 'string' ? textSizes(className) : className,
        variant === 'ghost' && ghostHover(className),
      )}
      {...props}
      disabled={props.disabled || field?.disabled}
    />
  )
}
